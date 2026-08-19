/**
 * Google Ads executor for the Marketing Action Engine.
 *
 * Supported action_types (target/proposed_value shapes documented per case):
 *  - budget_change            target{customer_id, campaign_id} proposed{daily_budget}
 *  - campaign_pause / campaign_enable
 *  - negative_keyword_add     proposed{negative_keyword, match_type}
 *  - keyword_add              target{ad_group_id} proposed{keyword, match_type, cpc_bid?}
 *  - keyword_pause / keyword_enable  target{ad_group_id, criterion_id}
 *  - keyword_match_type_change target{ad_group_id, criterion_id} proposed{keyword, match_type}
 *      (Google Ads cannot edit match type in place — creates the new criterion
 *       first, then pauses the old one; rollback re-enables old + removes new)
 *  - bid_adjust               target{ad_group_id} proposed{cpc_bid}
 *  - negative_keyword_remove  target{campaign_id, criterion_id} (undo of add)
 *
 * Honesty: EXECUTED only on API-confirmed resource names; VERIFIED only after
 * a fresh GAQL read-back shows the new state. Rollback payloads capture the
 * pre-mutation value read live from the API, not from cached tables.
 */
import {
  registerMarketingExecutor,
  type MarketingExecutor,
  type MarketingExecuteResult,
  type MarketingVerifyResult,
  type CreateMarketingActionInput,
} from "../action-engine.server";
import type { MarketingActionRecord } from "../action-engine.shared";
import { gaqlSearch } from "@/lib/growthmind/gads-live-core.server";
import {
  gadsMutate,
  budgetUpdateOp,
  campaignStatusOp,
  keywordCreateOp,
  adGroupCriterionStatusOp,
  adGroupCriterionRemoveOp,
  campaignNegativeKeywordOp,
  campaignCriterionRemoveOp,
  adGroupCpcBidOp,
  fromMicros,
} from "@/lib/growthmind/gads-mutate.server";

export const GADS_PLATFORM = "google_ads";

const num = (v: any): number | null => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: any): string | null => (typeof v === "string" && v.trim() ? v.trim() : v != null && v !== "" ? String(v) : null);
const MATCH_TYPES = new Set(["EXACT", "PHRASE", "BROAD"]);
const asMatch = (v: any): "EXACT" | "PHRASE" | "BROAD" =>
  MATCH_TYPES.has(String(v ?? "").toUpperCase()) ? (String(v).toUpperCase() as any) : "EXACT";

interface Ctx {
  workspaceId: string;
  customerId: string;
  loginCustomerId: string | null;
}

function ctxOf(action: MarketingActionRecord): Ctx | { error: string } {
  const t = action.target ?? {};
  const customerId = str(t.customer_id);
  if (!customerId) return { error: "target.customer_id missing — cannot address a Google Ads account." };
  return {
    workspaceId: action.workspace_id,
    customerId,
    loginCustomerId: str(t.login_customer_id),
  };
}

const gaqlOpts = (c: Ctx) => ({ workspaceId: c.workspaceId, customerId: c.customerId, loginCustomerId: c.loginCustomerId });

/**
 * Parse a criterion resource name into its parent (campaign/ad group) and
 * criterion ids. Handles `customers/{cid}/adGroupCriteria/{agid}~{critId}`
 * and `customers/{cid}/campaignCriteria/{campId}~{critId}`. Exported for tests.
 */
export function parseCriterionResource(resource: string | null | undefined): { parentId: string; criterionId: string } | null {
  const m = String(resource ?? "").match(/\/(?:adGroupCriteria|campaignCriteria)\/(\d+)~(\d+)$/);
  return m ? { parentId: m[1], criterionId: m[2] } : null;
}
const fail = (error: string): MarketingExecuteResult => ({ confirmed: false, error });

// ── Live pre-reads (rollback truth comes from the API, not cached tables) ────

async function readCampaign(c: Ctx, campaignId: string) {
  const rows = await gaqlSearch(gaqlOpts(c), `
    SELECT campaign.id, campaign.name, campaign.status, campaign.campaign_budget,
           campaign_budget.resource_name, campaign_budget.amount_micros
    FROM campaign WHERE campaign.id = ${Number(campaignId)}
  `.trim());
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.campaign?.id ?? ""),
    name: r.campaign?.name ?? null,
    status: String(r.campaign?.status ?? ""),
    budgetResourceName: r.campaignBudget?.resourceName ?? r.campaign?.campaignBudget ?? null,
    dailyBudget: fromMicros(r.campaignBudget?.amountMicros),
  };
}

async function readKeyword(c: Ctx, adGroupId: string, criterionId: string) {
  const rows = await gaqlSearch(gaqlOpts(c), `
    SELECT ad_group_criterion.criterion_id, ad_group_criterion.status,
           ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
           ad_group_criterion.cpc_bid_micros, ad_group.id
    FROM ad_group_criterion
    WHERE ad_group.id = ${Number(adGroupId)} AND ad_group_criterion.criterion_id = ${Number(criterionId)}
  `.trim());
  const r = rows[0];
  if (!r) return null;
  const cr = r.adGroupCriterion ?? {};
  return {
    criterionId: String(cr.criterionId ?? ""),
    status: String(cr.status ?? ""),
    keyword: cr.keyword?.text ?? null,
    matchType: cr.keyword?.matchType ?? null,
    cpcBid: fromMicros(cr.cpcBidMicros),
  };
}

async function readCampaignNegative(c: Ctx, campaignId: string, keyword: string, matchType: string) {
  const rows = await gaqlSearch(gaqlOpts(c), `
    SELECT campaign_criterion.criterion_id, campaign_criterion.keyword.text,
           campaign_criterion.keyword.match_type, campaign_criterion.negative
    FROM campaign_criterion
    WHERE campaign.id = ${Number(campaignId)} AND campaign_criterion.negative = TRUE
      AND campaign_criterion.type = KEYWORD
  `.trim());
  return rows.find((r: any) =>
    String(r.campaignCriterion?.keyword?.text ?? "").toLowerCase() === keyword.toLowerCase() &&
    String(r.campaignCriterion?.keyword?.matchType ?? "") === matchType) ?? null;
}

async function readAdGroup(c: Ctx, adGroupId: string) {
  const rows = await gaqlSearch(gaqlOpts(c), `
    SELECT ad_group.id, ad_group.status, ad_group.cpc_bid_micros
    FROM ad_group WHERE ad_group.id = ${Number(adGroupId)}
  `.trim());
  const r = rows[0];
  if (!r) return null;
  return { id: String(r.adGroup?.id ?? ""), status: String(r.adGroup?.status ?? ""), cpcBid: fromMicros(r.adGroup?.cpcBidMicros) };
}

// ── execute ──────────────────────────────────────────────────────────────────

async function execute(action: MarketingActionRecord): Promise<MarketingExecuteResult> {
  const c = ctxOf(action);
  if ("error" in c) return fail(c.error);
  const t = action.target ?? {};
  const p = action.proposed_value ?? {};

  try {
    switch (action.action_type) {
      case "budget_change": {
        const campaignId = str(t.campaign_id);
        const newBudget = num(p.daily_budget);
        if (!campaignId || newBudget == null || newBudget <= 0) return fail("budget_change needs target.campaign_id and proposed.daily_budget > 0.");
        const camp = await readCampaign(c, campaignId);
        if (!camp) return fail(`Campaign ${campaignId} not found in account ${c.customerId}.`);
        if (!camp.budgetResourceName) return fail(`Campaign ${campaignId} has no addressable budget resource.`);
        const res = await gadsMutate(c, "campaignBudgets", [budgetUpdateOp(camp.budgetResourceName, newBudget)]);
        if (!res.ok) return fail(res.error ?? "Budget mutation failed.");
        return {
          confirmed: true, apiResponse: { resourceNames: res.resourceNames },
          externalResourceId: camp.budgetResourceName,
          rollbackPayload: { kind: "budget_change", campaign_id: campaignId, budget_resource_name: camp.budgetResourceName, previous_daily_budget: camp.dailyBudget },
        };
      }

      case "campaign_pause":
      case "campaign_enable": {
        const campaignId = str(t.campaign_id);
        if (!campaignId) return fail("target.campaign_id missing.");
        const desired = action.action_type === "campaign_pause" ? "PAUSED" : "ENABLED";
        const camp = await readCampaign(c, campaignId);
        if (!camp) return fail(`Campaign ${campaignId} not found in account ${c.customerId}.`);
        if (camp.status === desired) return fail(`Campaign is already ${desired} — nothing to change.`);
        const res = await gadsMutate(c, "campaigns", [campaignStatusOp(c.customerId, campaignId, desired)]);
        if (!res.ok) return fail(res.error ?? "Campaign status mutation failed.");
        return {
          confirmed: true, apiResponse: { resourceNames: res.resourceNames },
          externalResourceId: res.resourceNames[0] ?? null,
          rollbackPayload: { kind: "campaign_status", campaign_id: campaignId, previous_status: camp.status },
        };
      }

      case "negative_keyword_add": {
        const campaignId = str(t.campaign_id);
        const kw = str(p.negative_keyword ?? p.keyword);
        const mt = asMatch(p.match_type);
        if (!campaignId || !kw) return fail("negative_keyword_add needs target.campaign_id and proposed.negative_keyword.");
        const existing = await readCampaignNegative(c, campaignId, kw, mt);
        if (existing) return fail(`"${kw}" [${mt}] is already a negative keyword on this campaign.`);
        const res = await gadsMutate(c, "campaignCriteria", [campaignNegativeKeywordOp(c.customerId, campaignId, kw, mt)]);
        if (!res.ok) return fail(res.error ?? "Negative keyword mutation failed.");
        return {
          confirmed: true, apiResponse: { resourceNames: res.resourceNames },
          externalResourceId: res.resourceNames[0] ?? null,
          rollbackPayload: { kind: "negative_keyword_remove", campaign_id: campaignId, criterion_resource_name: res.resourceNames[0] ?? null, keyword: kw, match_type: mt },
        };
      }

      case "negative_keyword_remove": {
        const resource = str(t.criterion_resource_name ?? action.rollback_payload?.criterion_resource_name);
        if (!resource) return fail("negative_keyword_remove needs target.criterion_resource_name.");
        const res = await gadsMutate(c, "campaignCriteria", [{ remove: resource }]);
        if (!res.ok) return fail(res.error ?? "Negative keyword removal failed.");
        return { confirmed: true, apiResponse: { resourceNames: res.resourceNames }, externalResourceId: resource, rollbackPayload: null };
      }

      case "keyword_add": {
        const adGroupId = str(t.ad_group_id);
        const kw = str(p.keyword);
        const mt = asMatch(p.match_type);
        if (!adGroupId || !kw) return fail("keyword_add needs target.ad_group_id and proposed.keyword.");
        const res = await gadsMutate(c, "adGroupCriteria", [keywordCreateOp(c.customerId, adGroupId, kw, mt, num(p.cpc_bid))]);
        if (!res.ok) return fail(res.error ?? "Keyword creation failed.");
        return {
          confirmed: true, apiResponse: { resourceNames: res.resourceNames },
          externalResourceId: res.resourceNames[0] ?? null,
          rollbackPayload: { kind: "keyword_remove", criterion_resource_name: res.resourceNames[0] ?? null, ad_group_id: adGroupId, keyword: kw, match_type: mt },
        };
      }

      case "keyword_pause":
      case "keyword_enable": {
        const adGroupId = str(t.ad_group_id);
        const criterionId = str(t.criterion_id);
        if (!adGroupId || !criterionId) return fail("keyword status change needs target.ad_group_id and target.criterion_id.");
        const desired = action.action_type === "keyword_pause" ? "PAUSED" : "ENABLED";
        const before = await readKeyword(c, adGroupId, criterionId);
        if (!before) return fail(`Keyword criterion ${criterionId} not found in ad group ${adGroupId}.`);
        if (before.status === desired) return fail(`Keyword is already ${desired} — nothing to change.`);
        const res = await gadsMutate(c, "adGroupCriteria", [adGroupCriterionStatusOp(c.customerId, adGroupId, criterionId, desired)]);
        if (!res.ok) return fail(res.error ?? "Keyword status mutation failed.");
        return {
          confirmed: true, apiResponse: { resourceNames: res.resourceNames },
          externalResourceId: res.resourceNames[0] ?? null,
          rollbackPayload: { kind: "keyword_status", ad_group_id: adGroupId, criterion_id: criterionId, previous_status: before.status, keyword: before.keyword },
        };
      }

      case "keyword_remove": {
        // Compensating action for keyword_add.
        const resource = str(t.criterion_resource_name);
        if (!resource) return fail("keyword_remove needs target.criterion_resource_name.");
        const res = await gadsMutate(c, "adGroupCriteria", [{ remove: resource }]);
        if (!res.ok) return fail(res.error ?? "Keyword removal failed.");
        return { confirmed: true, apiResponse: { resourceNames: res.resourceNames }, externalResourceId: resource, rollbackPayload: null };
      }

      case "keyword_match_type_change": {
        // Google Ads cannot edit match type in place: create new, pause old.
        const adGroupId = str(t.ad_group_id);
        const criterionId = str(t.criterion_id);
        const mt = asMatch(p.match_type);
        if (!adGroupId || !criterionId) return fail("match type change needs target.ad_group_id and target.criterion_id.");
        const before = await readKeyword(c, adGroupId, criterionId);
        if (!before || !before.keyword) return fail(`Keyword criterion ${criterionId} not found in ad group ${adGroupId}.`);
        if (String(before.matchType) === mt) return fail(`Keyword already has match type ${mt}.`);
        const created = await gadsMutate(c, "adGroupCriteria", [keywordCreateOp(c.customerId, adGroupId, before.keyword, mt, before.cpcBid)]);
        if (!created.ok) return fail(created.error ?? "New-match-type keyword creation failed.");
        const paused = await gadsMutate(c, "adGroupCriteria", [adGroupCriterionStatusOp(c.customerId, adGroupId, criterionId, "PAUSED")]);
        if (!paused.ok) {
          // Step 2 failed — try to compensate immediately by removing the new
          // criterion so no partial change is left behind.
          const newResource = created.resourceNames[0] ?? null;
          const undoRemove = newResource
            ? await gadsMutate(c, "adGroupCriteria", [{ remove: newResource }])
            : { ok: false, error: "no resource name returned for the new criterion" } as const;
          if (undoRemove.ok) {
            // Fully compensated: account is back to its original state.
            return fail(`Old keyword could not be paused (${paused.error}); the new ${mt} keyword was removed again — no change applied.`);
          }
          // Partial mutation persists: BOTH keywords are live. Report as a
          // confirmed-but-broken write; verify() below requires the old
          // criterion to be PAUSED, so this can never reach "verified".
          return {
            confirmed: true,
            apiResponse: { created: created.resourceNames, pauseError: paused.error, compensationError: (undoRemove as any).error },
            externalResourceId: newResource,
            rollbackPayload: { kind: "match_type_revert", new_criterion_resource_name: newResource, ad_group_id: adGroupId, old_criterion_id: criterionId, old_paused: false },
            error: `PARTIAL: new ${mt} keyword created but the old criterion is still ENABLED (pause failed: ${paused.error}; compensating removal also failed: ${(undoRemove as any).error}). Both keywords are live — use Undo or fix manually.`,
          };
        }
        return {
          confirmed: true,
          apiResponse: { created: created.resourceNames, pausedOld: paused.resourceNames },
          externalResourceId: created.resourceNames[0] ?? null,
          rollbackPayload: { kind: "match_type_revert", new_criterion_resource_name: created.resourceNames[0] ?? null, ad_group_id: adGroupId, old_criterion_id: criterionId, old_paused: true, previous_status: before.status },
        };
      }

      case "match_type_revert": {
        // Compensating action for keyword_match_type_change.
        const newResource = str(t.new_criterion_resource_name);
        const adGroupId = str(t.ad_group_id);
        const oldCriterionId = str(t.old_criterion_id);
        if (!newResource || !adGroupId || !oldCriterionId) return fail("match_type_revert needs new_criterion_resource_name, ad_group_id and old_criterion_id.");
        const removed = await gadsMutate(c, "adGroupCriteria", [{ remove: newResource }]);
        if (!removed.ok) return fail(removed.error ?? "Could not remove the new-match-type keyword.");
        if (t.old_paused) {
          const re = await gadsMutate(c, "adGroupCriteria", [adGroupCriterionStatusOp(c.customerId, adGroupId, oldCriterionId, "ENABLED")]);
          if (!re.ok) return { confirmed: true, apiResponse: { removed: removed.resourceNames, reEnableError: re.error }, externalResourceId: newResource, rollbackPayload: null, error: `New keyword removed but old could not be re-enabled: ${re.error}` };
        }
        return { confirmed: true, apiResponse: { removed: removed.resourceNames }, externalResourceId: newResource, rollbackPayload: null };
      }

      case "bid_adjust": {
        const adGroupId = str(t.ad_group_id);
        const newBid = num(p.cpc_bid);
        if (!adGroupId || newBid == null || newBid <= 0) return fail("bid_adjust needs target.ad_group_id and proposed.cpc_bid > 0.");
        const before = await readAdGroup(c, adGroupId);
        if (!before) return fail(`Ad group ${adGroupId} not found.`);
        const res = await gadsMutate(c, "adGroups", [adGroupCpcBidOp(c.customerId, adGroupId, newBid)]);
        if (!res.ok) return fail(res.error ?? "Bid mutation failed.");
        return {
          confirmed: true, apiResponse: { resourceNames: res.resourceNames },
          externalResourceId: res.resourceNames[0] ?? null,
          rollbackPayload: { kind: "bid_adjust", ad_group_id: adGroupId, previous_cpc_bid: before.cpcBid },
        };
      }

      default:
        return fail(`Google Ads executor does not support action type "${action.action_type}".`);
    }
  } catch (e: any) {
    return fail(e?.message ?? "Google Ads execution error.");
  }
}

// ── verify (independent GAQL read-back) ──────────────────────────────────────

async function verify(action: MarketingActionRecord): Promise<MarketingVerifyResult> {
  const c = ctxOf(action);
  if ("error" in c) return { verified: false, note: c.error };
  const t = action.target ?? {};
  const p = action.proposed_value ?? {};
  try {
    switch (action.action_type) {
      case "budget_change": {
        const camp = await readCampaign(c, String(t.campaign_id));
        const want = num(p.daily_budget);
        const got = camp?.dailyBudget ?? null;
        const ok = camp != null && want != null && got != null && Math.abs(got - want) < 0.01;
        return { verified: ok, observedState: { daily_budget: got }, note: ok ? undefined : `Read-back budget ${got} ≠ proposed ${want}.` };
      }
      case "campaign_pause":
      case "campaign_enable": {
        const camp = await readCampaign(c, String(t.campaign_id));
        const want = action.action_type === "campaign_pause" ? "PAUSED" : "ENABLED";
        const ok = camp?.status === want;
        return { verified: ok, observedState: { status: camp?.status ?? null }, note: ok ? undefined : `Read-back status ${camp?.status} ≠ ${want}.` };
      }
      case "negative_keyword_add": {
        const kw = str(p.negative_keyword ?? p.keyword) ?? "";
        const found = await readCampaignNegative(c, String(t.campaign_id), kw, asMatch(p.match_type));
        return { verified: !!found, observedState: { present: !!found }, note: found ? undefined : "Negative keyword not present on read-back." };
      }
      case "negative_keyword_remove": {
        const kw = str(t.keyword ?? "") ?? "";
        if (kw) {
          const found = await readCampaignNegative(c, String(t.campaign_id), kw, asMatch(t.match_type));
          return { verified: !found, observedState: { present: !!found }, note: found ? "Negative keyword still present." : undefined };
        }
        // No keyword text — read back by criterion ID parsed from the resource
        // name. Never report verified without an independent read-back.
        const ids = parseCriterionResource(str(t.criterion_resource_name));
        if (!ids) return { verified: false, note: "Cannot verify removal: no keyword text and no parseable criterion resource name." };
        const rows = await gaqlSearch(gaqlOpts(c), `
          SELECT campaign_criterion.criterion_id, campaign_criterion.status
          FROM campaign_criterion
          WHERE campaign.id = ${Number(ids.parentId)} AND campaign_criterion.criterion_id = ${Number(ids.criterionId)}
        `.trim());
        const still = rows.find((r: any) => String(r.campaignCriterion?.status ?? "") !== "REMOVED");
        return { verified: !still, observedState: { status: still ? String(still.campaignCriterion?.status) : "absent" }, note: still ? "Campaign criterion still present after removal." : undefined };
      }
      case "keyword_add": {
        const rows = await gaqlSearch(gaqlOpts(c), `
          SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
          FROM ad_group_criterion
          WHERE ad_group.id = ${Number(t.ad_group_id)} AND ad_group_criterion.type = KEYWORD
            AND ad_group_criterion.status != 'REMOVED'
        `.trim());
        const kw = (str(p.keyword) ?? "").toLowerCase();
        const mt = asMatch(p.match_type);
        const found = rows.some((r: any) =>
          String(r.adGroupCriterion?.keyword?.text ?? "").toLowerCase() === kw &&
          String(r.adGroupCriterion?.keyword?.matchType ?? "") === mt);
        return { verified: found, observedState: { present: found }, note: found ? undefined : "Keyword not present on read-back." };
      }
      case "keyword_pause":
      case "keyword_enable": {
        const k = await readKeyword(c, String(t.ad_group_id), String(t.criterion_id));
        const want = action.action_type === "keyword_pause" ? "PAUSED" : "ENABLED";
        const ok = k?.status === want;
        return { verified: ok, observedState: { status: k?.status ?? null }, note: ok ? undefined : `Read-back status ${k?.status} ≠ ${want}.` };
      }
      case "keyword_remove": {
        const rp = action.target ?? {};
        // Prefer explicit ids; fall back to ids parsed from the resource name
        // (rollback actions carry criterion_resource_name only). A removal is
        // NEVER verified without a read-back proving absence.
        const ids = rp.ad_group_id && rp.criterion_id
          ? { parentId: String(rp.ad_group_id), criterionId: String(rp.criterion_id) }
          : parseCriterionResource(str(rp.criterion_resource_name));
        if (!ids) return { verified: false, note: "Cannot verify removal: no ad_group_id/criterion_id and no parseable criterion resource name." };
        const k = await readKeyword(c, ids.parentId, ids.criterionId);
        const ok = !k || k.status === "REMOVED";
        return { verified: ok, observedState: { status: k?.status ?? "absent" }, note: ok ? undefined : `Keyword still ${k?.status} after removal.` };
      }
      case "keyword_match_type_change": {
        const rows = await gaqlSearch(gaqlOpts(c), `
          SELECT ad_group_criterion.criterion_id, ad_group_criterion.status,
                 ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
          FROM ad_group_criterion
          WHERE ad_group.id = ${Number(t.ad_group_id)} AND ad_group_criterion.type = KEYWORD
        `.trim());
        const rb = action.rollback_payload ?? {};
        const kw = rows.find((r: any) => `customers/${c.customerId}/adGroupCriteria/${t.ad_group_id}~${r.adGroupCriterion?.criterionId}` === rb.new_criterion_resource_name
          || (String(r.adGroupCriterion?.keyword?.matchType ?? "") === asMatch(p.match_type) && String(r.adGroupCriterion?.status) === "ENABLED"
              && String(r.adGroupCriterion?.keyword?.text ?? "").toLowerCase() === String(p.keyword ?? "").toLowerCase()));
        const oldRow = rows.find((r: any) => String(r.adGroupCriterion?.criterionId) === String(t.criterion_id));
        // BOTH steps must hold: new keyword present AND old keyword paused.
        // A partial mutation (old still ENABLED) must never verify.
        const ok = !!kw && String(oldRow?.adGroupCriterion?.status) === "PAUSED";
        return { verified: ok, observedState: { newPresent: !!kw, oldStatus: oldRow?.adGroupCriterion?.status ?? null }, note: ok ? undefined : "New match-type keyword or old-keyword pause not confirmed on read-back." };
      }
      case "match_type_revert": {
        // BOTH halves of the revert must hold: the newly-created criterion is
        // gone AND the old criterion is restored (re-enabled when we paused it).
        const oldK = await readKeyword(c, String(t.ad_group_id), String(t.old_criterion_id));
        const oldOk = !!oldK && (t.old_paused ? oldK.status === "ENABLED" : true);
        const newIds = parseCriterionResource(str(t.new_criterion_resource_name));
        if (!newIds) return { verified: false, observedState: { oldStatus: oldK?.status ?? null }, note: "Cannot verify revert: new criterion resource name is unparseable." };
        const newK = await readKeyword(c, newIds.parentId, newIds.criterionId);
        const newGone = !newK || newK.status === "REMOVED";
        return {
          verified: oldOk && newGone,
          observedState: { oldStatus: oldK?.status ?? null, newStatus: newK?.status ?? "absent" },
          note: oldOk && newGone ? undefined : `Revert incomplete: old=${oldK?.status ?? "absent"}, new=${newK?.status ?? "absent"}.`,
        };
      }
      case "bid_adjust": {
        const ag = await readAdGroup(c, String(t.ad_group_id));
        const want = num(p.cpc_bid);
        const ok = ag != null && want != null && ag.cpcBid != null && Math.abs(ag.cpcBid - want) < 0.01;
        return { verified: ok, observedState: { cpc_bid: ag?.cpcBid ?? null }, note: ok ? undefined : `Read-back bid ${ag?.cpcBid} ≠ proposed ${want}.` };
      }
      default:
        return { verified: false, note: `No verifier for action type "${action.action_type}".` };
    }
  } catch (e: any) {
    return { verified: false, note: e?.message ?? "Verification read-back failed." };
  }
}

// ── rollback builder ─────────────────────────────────────────────────────────

function buildRollback(action: MarketingActionRecord): CreateMarketingActionInput | null {
  const rb = action.rollback_payload ?? {};
  const t = action.target ?? {};
  const base = {
    source: "undo",
    platform: GADS_PLATFORM,
    requested_by: null,
    objective: `Undo marketing action ${action.id}`,
    risk_level: "medium" as const,
    evidence: { undo_of: action.id },
  };
  switch (rb.kind) {
    case "budget_change":
      if (rb.previous_daily_budget == null) return null;
      return { ...base, action_type: "budget_change",
        target: { ...t, campaign_id: rb.campaign_id },
        existing_value: action.proposed_value, proposed_value: { daily_budget: rb.previous_daily_budget } };
    case "campaign_status": {
      const prev = String(rb.previous_status ?? "");
      if (prev !== "ENABLED" && prev !== "PAUSED") return null;
      return { ...base, action_type: prev === "PAUSED" ? "campaign_pause" : "campaign_enable",
        target: { ...t, campaign_id: rb.campaign_id }, existing_value: action.proposed_value, proposed_value: { status: prev } };
    }
    case "negative_keyword_remove":
      if (!rb.criterion_resource_name) return null;
      return { ...base, action_type: "negative_keyword_remove",
        target: { ...t, campaign_id: rb.campaign_id, criterion_resource_name: rb.criterion_resource_name, keyword: rb.keyword, match_type: rb.match_type },
        existing_value: { negative_keyword: rb.keyword }, proposed_value: { removed: true } };
    case "keyword_remove":
      if (!rb.criterion_resource_name) return null;
      return { ...base, action_type: "keyword_remove",
        target: { ...t, criterion_resource_name: rb.criterion_resource_name, ad_group_id: rb.ad_group_id },
        existing_value: { keyword: rb.keyword }, proposed_value: { removed: true } };
    case "keyword_status": {
      const prev = String(rb.previous_status ?? "");
      if (prev !== "ENABLED" && prev !== "PAUSED") return null;
      return { ...base, action_type: prev === "PAUSED" ? "keyword_pause" : "keyword_enable",
        target: { ...t, ad_group_id: rb.ad_group_id, criterion_id: rb.criterion_id },
        existing_value: action.proposed_value, proposed_value: { status: prev } };
    }
    case "match_type_revert":
      if (!rb.new_criterion_resource_name) return null;
      return { ...base, action_type: "match_type_revert",
        target: { ...t, new_criterion_resource_name: rb.new_criterion_resource_name, ad_group_id: rb.ad_group_id, old_criterion_id: rb.old_criterion_id, old_paused: !!rb.old_paused },
        existing_value: action.proposed_value, proposed_value: { reverted: true } };
    case "bid_adjust":
      if (rb.previous_cpc_bid == null) return null;
      return { ...base, action_type: "bid_adjust",
        target: { ...t, ad_group_id: rb.ad_group_id },
        existing_value: action.proposed_value, proposed_value: { cpc_bid: rb.previous_cpc_bid } };
    default:
      return null;
  }
}

export const googleAdsExecutor: MarketingExecutor = {
  platform: GADS_PLATFORM,
  // Autopilot allowlist is deliberately narrow: only campaign-level negative
  // keywords (which themselves are gated to IRRELEVANT-classified terms and
  // logged in the Negative Keyword Decision Log). Everything else — budgets,
  // statuses, keywords, bids — always requires human approval.
  autoExecutableActionTypes: ["negative_keyword_add"],
  execute,
  verify,
  buildRollback,
};

registerMarketingExecutor(googleAdsExecutor);
