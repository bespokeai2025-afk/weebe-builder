/**
 * GrowthMind Google Ads — MUTATION client (SERVER ONLY).
 *
 * The only module allowed to WRITE to Google Ads. Mirrors the read client's
 * auth (OAuth refresh token + developer token from provider_settings) and
 * honesty rules:
 *  - A mutation is CONFIRMED only when the API responds 200 with resource
 *    names / results — never assumed.
 *  - Missing write access (dev-token level, permissions, scopes) is reported
 *    explicitly with the exact missing piece; never a fake success.
 *  - All errors surface parsed GoogleAdsFailure codes.
 *
 * NOTE: alias-free relative imports — this module can be reached from the
 * marketing engine which may be loaded outside Vite alias resolution.
 */
import {
  GADS_BASE,
  loadGadsCreds,
  getGadsAccessToken,
  normalizeGadsCustomerId,
  parseGoogleAdsFailure,
  type GadsCreds,
} from "./gads-live-core.server";

export interface GadsMutateOptions {
  workspaceId: string;
  customerId: string;
  loginCustomerId?: string | null;
  creds?: GadsCreds;
  /** Google-side dry run: full validation, no change applied. */
  validateOnly?: boolean;
}

export interface GadsMutateResult {
  ok: boolean;
  /** resourceNames returned by the API (confirmation of the write). */
  resourceNames: string[];
  results: any[];
  error?: string;
  errorCodes?: string[];
  requestId?: string | null;
}

/** Classify an API failure into an actionable "what's missing" message. */
export function explainGadsWriteFailure(status: number, body: string): { message: string; codes: string[]; requestId: string | null } {
  const parsed = parseGoogleAdsFailure(body);
  const codes = parsed.codes;
  const first = parsed.messages[0] ?? "";
  const has = (frag: string) => codes.some((c) => c.includes(frag)) || body.includes(frag);
  let message: string;
  if (has("DEVELOPER_TOKEN_NOT_APPROVED")) {
    message = "Write blocked: the Google Ads developer token is not approved for this account level (Basic/Standard access required — test tokens can only mutate test accounts). Apply for Basic access in the Google Ads API Center.";
  } else if (has("DEVELOPER_TOKEN_PROHIBITED")) {
    message = "Write blocked: this developer token is prohibited from accessing the account.";
  } else if (has("USER_PERMISSION_DENIED")) {
    message = "Write blocked: the connected Google user has read-only or no access to this Google Ads account. Grant the user Standard (edit) access in Google Ads account settings.";
  } else if (has("ACTION_NOT_PERMITTED")) {
    message = `Write blocked: Google Ads refused this operation for the account (${first || "action not permitted"}).`;
  } else if (has("insufficient authentication scopes") || has("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) {
    message = "Write blocked: the OAuth grant is missing the https://www.googleapis.com/auth/adwords scope — reconnect with Google to re-consent.";
  } else if (status === 401) {
    message = "Write blocked: Google authorisation expired or revoked — reconnect with Google.";
  } else if (has("UNSUPPORTED_VERSION")) {
    message = `Write blocked: Google Ads API version in use is sunset — set GOOGLE_ADS_API_VERSION to a current version. (${first})`;
  } else {
    message = `Google Ads mutation failed [${codes.join(", ") || status}]: ${(first || body.replace(/\s+/g, " ")).slice(0, 300)}`;
  }
  return { message, codes, requestId: parsed.requestId };
}

/**
 * Low-level mutate call: POST customers/{cid}/{service}:mutate.
 * `service` e.g. "campaignBudgets", "campaigns", "adGroupCriteria",
 * "campaignCriteria", "adGroups", "adGroupAds".
 */
export async function gadsMutate(
  opts: GadsMutateOptions,
  service: string,
  operations: any[],
): Promise<GadsMutateResult> {
  if (!operations.length) return { ok: false, resourceNames: [], results: [], error: "No operations supplied" };
  const creds = opts.creds ?? await loadGadsCreds(opts.workspaceId);
  if (!creds.developerToken) {
    return { ok: false, resourceNames: [], results: [], error: "Write blocked: Google Ads developer token missing in provider settings." };
  }
  const cid = normalizeGadsCustomerId(opts.customerId);
  if (!cid) return { ok: false, resourceNames: [], results: [], error: `Invalid Google Ads customer ID "${String(opts.customerId).slice(0, 40)}".` };
  const login = normalizeGadsCustomerId(opts.loginCustomerId ?? creds.managerId) ?? "";

  let token: string;
  try { token = await getGadsAccessToken(opts.workspaceId, creds); }
  catch (e: any) { return { ok: false, resourceNames: [], results: [], error: e?.message ?? "OAuth token refresh failed" }; }

  // NO automatic retry on 5xx for mutations — a retried write is a double
  // write. Callers decide; the engine never auto-retries paid work.
  const res = await fetch(`${GADS_BASE}/customers/${cid}/${service}:mutate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": creds.developerToken,
      "Content-Type": "application/json",
      ...(login ? { "login-customer-id": login } : {}),
    },
    body: JSON.stringify({
      operations,
      partialFailure: false,
      validateOnly: !!opts.validateOnly,
    }),
  });
  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    const ex = explainGadsWriteFailure(res.status, bodyText);
    console.error("[gads-mutate] failed", JSON.stringify({ service, httpStatus: res.status, codes: ex.codes, requestId: ex.requestId }));
    return { ok: false, resourceNames: [], results: [], error: ex.message, errorCodes: ex.codes, requestId: ex.requestId };
  }
  let json: any = {};
  try { json = JSON.parse(bodyText); } catch { /* empty 200 body (validateOnly) */ }
  const results: any[] = json.results ?? [];
  const resourceNames = results.map((r: any) => String(r.resourceName ?? "")).filter(Boolean);
  if (!opts.validateOnly && resourceNames.length === 0) {
    // 200 without confirmed resources = do NOT claim success.
    return { ok: false, resourceNames: [], results, error: "Google Ads returned 200 but no mutated resource names — change not confirmed." };
  }
  return { ok: true, resourceNames, results };
}

/**
 * Probe whether this workspace's credentials can WRITE to the account.
 * Uses validateOnly on a harmless campaign-budget no-op style operation
 * (create with an obviously-invalid name is NOT used; instead we validate a
 * budget create that would never be committed).
 */
export async function checkGadsWriteAccess(
  args: { workspaceId: string; customerId: string; loginCustomerId?: string | null },
): Promise<{ canWrite: boolean; detail: string }> {
  const probe = await gadsMutate(
    { ...args, validateOnly: true },
    "campaignBudgets",
    [{ create: { name: `WEBEE write-access probe ${Date.now()}`, amountMicros: "1000000", deliveryMethod: "STANDARD" } }],
  );
  if (probe.ok || probe.error?.includes("no mutated resource names")) {
    // validateOnly success returns empty results — that IS the pass signal.
    return { canWrite: true, detail: "Google Ads write access verified (validate-only probe passed)." };
  }
  return { canWrite: false, detail: probe.error ?? "Write probe failed." };
}

// ── Typed operation builders (micros conversions centralised) ────────────────

export const toMicros = (v: number) => String(Math.round(v * 1_000_000));
export const fromMicros = (v: any) => (v != null ? Number(v) / 1_000_000 : null);

export function budgetUpdateOp(budgetResourceName: string, amount: number) {
  return {
    update: { resourceName: budgetResourceName, amountMicros: toMicros(amount) },
    updateMask: "amount_micros",
  };
}

export function campaignStatusOp(customerId: string, campaignId: string, status: "ENABLED" | "PAUSED") {
  return {
    update: { resourceName: `customers/${customerId}/campaigns/${campaignId}`, status },
    updateMask: "status",
  };
}

export function keywordCreateOp(customerId: string, adGroupId: string, keyword: string, matchType: "EXACT" | "PHRASE" | "BROAD", cpcBid?: number | null) {
  return {
    create: {
      adGroup: `customers/${customerId}/adGroups/${adGroupId}`,
      status: "ENABLED",
      keyword: { text: keyword, matchType },
      ...(cpcBid != null && cpcBid > 0 ? { cpcBidMicros: toMicros(cpcBid) } : {}),
    },
  };
}

export function adGroupCriterionStatusOp(customerId: string, adGroupId: string, criterionId: string, status: "ENABLED" | "PAUSED") {
  return {
    update: { resourceName: `customers/${customerId}/adGroupCriteria/${adGroupId}~${criterionId}`, status },
    updateMask: "status",
  };
}

export function adGroupCriterionRemoveOp(customerId: string, adGroupId: string, criterionId: string) {
  return { remove: `customers/${customerId}/adGroupCriteria/${adGroupId}~${criterionId}` };
}

export function campaignNegativeKeywordOp(customerId: string, campaignId: string, keyword: string, matchType: "EXACT" | "PHRASE" | "BROAD") {
  return {
    create: {
      campaign: `customers/${customerId}/campaigns/${campaignId}`,
      negative: true,
      keyword: { text: keyword, matchType },
    },
  };
}

export function campaignCriterionRemoveOp(customerId: string, campaignId: string, criterionId: string) {
  return { remove: `customers/${customerId}/campaignCriteria/${campaignId}~${criterionId}` };
}

export function adGroupCpcBidOp(customerId: string, adGroupId: string, cpcBid: number) {
  return {
    update: { resourceName: `customers/${customerId}/adGroups/${adGroupId}`, cpcBidMicros: toMicros(cpcBid) },
    updateMask: "cpc_bid_micros",
  };
}
