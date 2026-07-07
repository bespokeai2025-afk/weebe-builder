/**
 * Webuyanyhouse Workspace — campaign server functions.
 *
 * These are the only WeeBespoke API calls that still exist as separate
 * server functions. All other data (leads, CRM contacts) is synced into
 * the WEBEE database via wbah.functions.ts and served by standard WEBEE
 * page server functions.
 *
 * Campaigns from WeeBespoke cannot be stored in the WEBEE campaigns table
 * (different schema), so they are fetched live and displayed as an extra
 * tab in the existing Campaigns page — only for webuyanyhouse workspace users.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { enrichWbahCallRowsWithBookings, findWbahBookingCall, resolveWbahBookingFields, phoneDigits, isWbahRecordBooked } from "@/lib/dashboard/wbah-booking-meta";
import { getWbahCallsAggregate } from "./wbah-leads.server";
import { recordSyncState } from "@/lib/sync-state/sync-state.server";
import { cacheWrap, cacheGet, cacheSet } from "@/lib/cache/redis.server";
import * as api from "./client.server";
import { wbahCallsParamTest, wbahCallsPostPage, wbahLeadsParamTest } from "./client.server";
import { getCampaignData } from "@/lib/api-engine/data-source-router.server";

// ── Internal: require webuyanyhouse membership + get API token callbacks ───────

// Module-level cache: only proactively relogin once every 30 minutes
let _wbahReloginAt = 0;
const RELOGIN_TTL_MS = 30 * 60 * 1000;

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [profileRes, roleRes] = await Promise.all([
    (supabaseAdmin as any).from("profiles").select("user_type").eq("user_id", userId).maybeSingle(),
    (supabaseAdmin as any).from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
  ]);
  return profileRes.data?.user_type === "admin" || !!roleRes.data;
}

async function requireWbahCbs(userId: string) {
  if (!userId) throw new Error("Unauthorized");

  // Platform admins bypass workspace membership check
  const admin = await isPlatformAdmin(userId);
  if (!admin) {
    const { data: memberships } = await (supabaseAdmin as any)
      .from("workspace_members")
      .select("workspace_id, workspaces(slug)")
      .eq("user_id", userId);

    const wbahMembership = (memberships ?? []).find(
      (m: any) => m.workspaces?.slug === "webuyanyhouse",
    );

    if (!wbahMembership) {
      throw new Error("Access denied — not a member of the Webuyanyhouse workspace");
    }
  }

  const { data: integration } = await (supabaseAdmin as any)
    .from("enterprise_integrations")
    .select("access_token, refresh_token, status, user_payload")
    .eq("integration_key", "webespoke_enterprise")
    .eq("client_name", "Webuyanyhouse")
    .maybeSingle();

  if (!integration?.access_token || integration.status !== "connected") {
    throw new Error("WeeBespoke API not connected — contact your administrator");
  }

  let currentAccessToken  = integration.access_token as string;
  let currentRefreshToken = (integration.refresh_token ?? "") as string;

  const password = process.env.WEBESPOKE_ADMIN_PASSWORD;
  const email    = (integration.user_payload as any)?.email
                ?? process.env.WEBESPOKE_ADMIN_EMAIL;

  // Full re-login with the stored admin credentials, minting a brand-new session
  // and persisting it for every caller. WeeBespoke allows only ONE active session
  // per account and the token is short-lived, so a token can be silently
  // invalidated by a concurrent background sync logging into the same account.
  // Passing this as the 401 fallback (reloginFn) lets a live call recover a dead
  // token inline instead of surfacing "Token expired — reconnect required".
  const reloginFn = async (): Promise<{ accessToken: string } | null> => {
    if (!password || !email) return null;
    try {
      const loginRes = await api.loginWithPassword(email, password);
      if (!loginRes.ok || !loginRes.data) return null;
      const d = loginRes.data as any;
      const at = d.accessToken ?? d.token ?? d.access_token ?? d.jwt ??
                 d.data?.accessToken ?? d.data?.token ?? d.data?.access_token ??
                 d.result?.accessToken ?? d.result?.token ??
                 d.auth?.accessToken ?? d.auth?.token ?? d.user?.token ?? null;
      const rt = d.refreshToken ?? d.refresh_token ?? d.data?.refreshToken ??
                 d.data?.refresh_token ?? d.result?.refreshToken ?? currentRefreshToken;
      if (!at) return null;
      await (supabaseAdmin as any)
        .from("enterprise_integrations")
        .update({ access_token: at, refresh_token: rt, status: "connected" })
        .eq("integration_key", "webespoke_enterprise")
        .eq("client_name", "Webuyanyhouse");
      currentAccessToken  = at;
      currentRefreshToken = rt;
      _wbahReloginAt = Date.now();
      return { accessToken: at };
    } catch {
      // Ignore relogin errors — caller keeps the existing token.
      return null;
    }
  };

  // Proactively relogin using stored credentials when the cache has expired.
  // This prevents "token expired" errors without adding latency to every call.
  if (password && email && Date.now() - _wbahReloginAt > RELOGIN_TTL_MS) {
    await reloginFn();
  }

  const getTokens = async () => ({
    accessToken:  currentAccessToken,
    refreshToken: currentRefreshToken,
  });

  const saveNewAccessToken = async (token: string) => {
    await (supabaseAdmin as any)
      .from("enterprise_integrations")
      .update({ access_token: token, status: "connected" })
      .eq("integration_key", "webespoke_enterprise")
      .eq("client_name", "Webuyanyhouse");
    currentAccessToken = token;
  };

  return { getTokens, saveNewAccessToken, reloginFn };
}

// ── Comprehensive endpoint audit — classifies every call-output-data endpoint ──
//
// Run this from the WBAH admin page → "Run Probe" button.
// Results appear both in the return value (displayed as JSON in admin page)
// and in the server console as [WBAH-AUDIT] log lines.

export const wbahProbeApi = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
    const gt = cbs.getTokens;
    const st = cbs.saveNewAccessToken;

    // ── Helper: extract records array from any known response shape ────────────
    function extractArr(raw: any): any[] | null {
      if (Array.isArray(raw))            return raw;
      if (Array.isArray(raw?.data))      return raw.data;
      if (Array.isArray(raw?.calls))     return raw.calls;
      if (Array.isArray(raw?.leads))     return raw.leads;
      if (Array.isArray(raw?.records))   return raw.records;
      if (Array.isArray(raw?.result))    return raw.result;
      if (Array.isArray(raw?.items))     return raw.items;
      if (Array.isArray(raw?.contacts))  return raw.contacts;
      if (Array.isArray(raw?.output))    return raw.output;
      return null;
    }

    // ── Helper: inspect one record for field types ─────────────────────────────
    function inspectRecord(r: any) {
      if (!r || typeof r !== "object") return null;
      const k = Object.keys(r);
      const has = (patterns: string[]) =>
        patterns.some(p => k.some(key => key.toLowerCase().includes(p.toLowerCase())));
      return {
        allKeys:          k,
        hasDuration:      has(["duration", "callduration", "call_duration", "length"]),
        hasRecordingUrl:  has(["recording", "recordurl", "record_url", "audio", "audiourl"]),
        hasTranscript:    has(["transcript", "transcription", "summary"]),
        hasSentiment:     has(["sentiment", "score", "mood"]),
        hasCallStatus:    has(["callstatus", "call_status", "status", "outcome", "disposition"]),
        hasCallOutcome:   has(["outcome", "result", "disposition"]),
        hasPhoneNumber:   has(["phone", "mobile", "tel", "number", "contact"]),
        hasName:          has(["name", "fullname", "firstname", "lastname"]),
        hasAddress:       has(["address", "postcode", "zip", "city", "street"]),
        hasEmail:         has(["email"]),
        hasLeadId:        has(["leadid", "lead_id", "userid", "user_id", "contactid"]),
        hasCallId:        has(["callid", "call_id", "retellcallid", "retell_call"]),
        hasTimestamp:     has(["date", "time", "createdat", "created_at", "calledat", "called_at", "startedat"]),
        hasAppointment:   has(["appointment", "booked", "slot", "meeting"]),
        sampleValues: Object.fromEntries(
          k.slice(0, 12).map(key => [key, typeof r[key] === "string" ? r[key].slice(0, 80) : r[key]])
        ),
      };
    }

    // ── Helper: classify endpoint based on first-record inspection ─────────────
    function classify(inspection: ReturnType<typeof inspectRecord>, recordCount: number | "N/A"): string {
      if (!inspection) return "6-Unknown (no records returned)";
      const { hasDuration, hasRecordingUrl, hasTranscript, hasSentiment,
              hasCallStatus, hasAddress, hasPhoneNumber, hasCallId } = inspection;

      // Strong completed-call signals
      if ((hasDuration || hasRecordingUrl || hasTranscript) && hasSentiment) return "2-Completed call log ✓";
      if (hasDuration && hasCallId) return "2-Completed call log ✓";
      if (hasTranscript && hasCallStatus) return "2-Completed call log ✓";
      if (hasSentiment && hasCallId) return "2-Completed call log ✓";
      if (hasSentiment && hasCallStatus && !hasAddress) return "2-Completed call log (likely) ✓";

      // CRM / leads-to-call signals
      if (hasAddress && hasPhoneNumber && !hasDuration && !hasCallId) return "1-CRM contact / lead to call";
      if (hasAddress && !hasDuration && !hasSentiment) return "1-CRM contact / lead to call (likely)";

      // Callback queue
      if (inspection.hasAppointment && hasPhoneNumber) return "4-Callback queue";

      // Generic per-person history
      if (hasCallId && hasTimestamp(inspection)) return "3-Per-person call history";

      if (recordCount === "N/A" || recordCount === 0) return "5-Dashboard metric / empty";
      return "6-Unknown — see allKeys";
    }
    function hasTimestamp(ins: any) { return ins?.hasTimestamp ?? false; }

    // ── Round 1: hit all call-output-data endpoints in parallel ───────────────
    console.log("[WBAH-AUDIT] ▶ Starting comprehensive endpoint audit…");

    const [
      callsP1Res,
      callCountRes,
      leadsP1Res,
      callsAllRes,
      callbacksRes,
      crmRes,
      callsBulkRes,
      leadsBulkRes,
    ] = await Promise.all([
      api.wbahGetAllCallDataPaged(1,   gt, st),   // GET /get-all-calldata?currentPage=1
      api.wbahGetCallCount(            gt, st),   // GET /get-call-count
      api.wbahGetUserCallLeadPaged(1,  gt, st),   // GET /get-userCall-lead?currentPage=1
      api.wbahGetAllCallOutput(        gt, st),   // GET /all
      api.wbahGetPendingCallbacks(     gt, st),   // GET /callbacks/pending
      api.wbahGetCrmData(              gt, st),   // GET /crm-data/get-crm-data
      api.wbahGetAllCallDataAll(       gt, st),   // GET /get-all-calldata?limit=10000
      api.wbahGetUserCallLeadAll(      gt, st),   // GET /get-userCall-lead?limit=10000
    ]);

    // ── Round 2: POST /get-user-history — page 1 variants + explicit page 2 ─────
    const [
      histEmpty, histLimit100, histLimitBig, histLeadId, histPage1, histPage2,
    ] = await Promise.all([
      api.wbahGetUserHistory({},                                  gt, st),
      api.wbahGetUserHistory({ limit: 100 },                     gt, st),
      api.wbahGetUserHistory({ limit: 10000 },                   gt, st),
      api.wbahGetUserHistory({ page: 1, limit: 50 },             gt, st),
      api.wbahGetUserHistory({ currentPage: 1, pageSize: 50 },   gt, st),
      api.wbahGetUserHistory({ currentPage: 2 },                 gt, st),  // ← KEY: pagination validation
    ]);

    // ── Round 3: page-2 of /get-all-calldata to find pagination key ───────────
    const [
      callsPage2Param, callsPage2Num, callsPage2PageNo,
    ] = await Promise.all([
      wbahCallsParamTest("currentPage", 2, gt, st),
      wbahCallsParamTest("pageNumber",  2, gt, st),
      wbahCallsParamTest("pageNo",      2, gt, st),
    ]);

    // ── Analyse each response ──────────────────────────────────────────────────
    function analyseEndpoint(
      res: any,
      endpoint: string,
      method: "GET" | "POST",
      payloadNote?: string,
    ) {
      const raw = res.data as any;
      const arr = extractArr(raw);
      const recordCount: number | "N/A" = arr ? arr.length : "N/A";
      const topLevelKeys = raw && typeof raw === "object" && !Array.isArray(raw)
        ? Object.keys(raw)
        : Array.isArray(raw) ? ["(bare array)"] : [];
      const pagination = raw?.pagination ?? raw?.meta ?? null;
      const totalItems = pagination?.totalItems ?? pagination?.total ?? pagination?.count ?? null;
      const inspection = arr && arr.length > 0 ? inspectRecord(arr[0]) : null;
      const classification = classify(inspection, recordCount);

      const report = {
        endpoint,
        method,
        payloadNote:      payloadNote ?? null,
        httpStatus:       res.status,
        ok:               res.ok,
        classification,
        recordCountInPage: recordCount,
        totalItemsReported: totalItems,
        pagination,
        topLevelKeys,
        firstRecordAllKeys: inspection?.allKeys ?? null,
        // Field presence flags
        hasDuration:      inspection?.hasDuration      ?? false,
        hasRecordingUrl:  inspection?.hasRecordingUrl  ?? false,
        hasTranscript:    inspection?.hasTranscript    ?? false,
        hasSentiment:     inspection?.hasSentiment     ?? false,
        hasCallStatus:    inspection?.hasCallStatus    ?? false,
        hasPhoneNumber:   inspection?.hasPhoneNumber   ?? false,
        hasName:          inspection?.hasName          ?? false,
        hasAddress:       inspection?.hasAddress       ?? false,
        hasCallId:        inspection?.hasCallId        ?? false,
        hasLeadId:        inspection?.hasLeadId        ?? false,
        hasTimestamp:     inspection?.hasTimestamp     ?? false,
        hasAppointment:   inspection?.hasAppointment   ?? false,
        // Sample first record
        sampleRecord:     inspection?.sampleValues     ?? null,
        // Raw when no records
        rawResponseWhenEmpty: (!arr || arr.length === 0) ? raw : undefined,
      };

      console.log(
        `[WBAH-AUDIT] ${method} ${endpoint}${payloadNote ? " " + payloadNote : ""}` +
        ` → HTTP ${res.status} | records=${recordCount} | total=${totalItems ?? "?"} | ${classification}`
      );
      if (inspection?.allKeys) {
        console.log(`[WBAH-AUDIT]   first record keys: ${inspection.allKeys.join(", ")}`);
      }
      if (!arr) {
        console.log(`[WBAH-AUDIT]   raw (no array found): ${JSON.stringify(raw).slice(0, 200)}`);
      }

      return report;
    }

    const results = {
      "GET /call-output-data/get-all-calldata (page 1)":
        analyseEndpoint(callsP1Res,    "/call-output-data/get-all-calldata",          "GET", "?currentPage=1"),

      "GET /call-output-data/get-all-calldata (limit=10000)":
        analyseEndpoint(callsBulkRes,  "/call-output-data/get-all-calldata",          "GET", "?limit=10000"),

      "GET /call-output-data/get-all-calldata (page 2 ?currentPage=2)":
        analyseEndpoint(callsPage2Param, "/call-output-data/get-all-calldata",        "GET", "?currentPage=2"),

      "GET /call-output-data/get-all-calldata (page 2 ?pageNumber=2)":
        analyseEndpoint(callsPage2Num,  "/call-output-data/get-all-calldata",         "GET", "?pageNumber=2"),

      "GET /call-output-data/get-all-calldata (page 2 ?pageNo=2)":
        analyseEndpoint(callsPage2PageNo, "/call-output-data/get-all-calldata",       "GET", "?pageNo=2"),

      "GET /call-output-data/get-call-count":
        analyseEndpoint(callCountRes,  "/call-output-data/get-call-count",            "GET"),

      "POST /call-output-data/get-user-history (empty body)":
        analyseEndpoint(histEmpty,     "/call-output-data/get-user-history",          "POST", "body={}"),

      "POST /call-output-data/get-user-history (limit:100)":
        analyseEndpoint(histLimit100,  "/call-output-data/get-user-history",          "POST", "body={limit:100}"),

      "POST /call-output-data/get-user-history (limit:10000)":
        analyseEndpoint(histLimitBig,  "/call-output-data/get-user-history",          "POST", "body={limit:10000}"),

      "POST /call-output-data/get-user-history (page:1 limit:50)":
        analyseEndpoint(histPage1,     "/call-output-data/get-user-history",          "POST", "body={page:1,limit:50}"),

      "POST /call-output-data/get-user-history (currentPage:1 pageSize:50)":
        analyseEndpoint(histLeadId,    "/call-output-data/get-user-history",          "POST", "body={currentPage:1,pageSize:50}"),

      "POST /call-output-data/get-user-history (currentPage:2 — pagination test)":
        analyseEndpoint(histPage2,     "/call-output-data/get-user-history",          "POST", "body={currentPage:2}"),

      "GET /call-output-data/get-userCall-lead (page 1)":
        analyseEndpoint(leadsP1Res,    "/call-output-data/get-userCall-lead",         "GET", "?currentPage=1"),

      "GET /call-output-data/get-userCall-lead (limit=10000)":
        analyseEndpoint(leadsBulkRes,  "/call-output-data/get-userCall-lead",         "GET", "?limit=10000"),

      "GET /call-output-data/all":
        analyseEndpoint(callsAllRes,   "/call-output-data/all",                       "GET"),

      "GET /call-output-data/callbacks/pending":
        analyseEndpoint(callbacksRes,  "/call-output-data/callbacks/pending",         "GET"),

      "GET /crm-data/get-crm-data":
        analyseEndpoint(crmRes,        "/crm-data/get-crm-data",                      "GET"),
    };

    // ── Summary table ──────────────────────────────────────────────────────────
    console.log("\n[WBAH-AUDIT] ══════════════════════ SUMMARY TABLE ══════════════════════");
    console.log("[WBAH-AUDIT] endpoint | classification | records in page | total reported");
    for (const [key, r] of Object.entries(results)) {
      console.log(
        `[WBAH-AUDIT] ${r.endpoint}${r.payloadNote ? " " + r.payloadNote : ""}` +
        ` | ${r.classification}` +
        ` | records=${r.recordCountInPage}` +
        ` | total=${r.totalItemsReported ?? "?"}`
      );
    }
    console.log("[WBAH-AUDIT] ════════════════════════════════════════════════════════════\n");

    return { audit: results };
  });

// ── Campaigns (live from WeeBespoke API — shown as a tab in /campaigns) ────────

// The WeeBespoke API wraps every list response as
//   { result, statuscode, message, data: [...] }
// so the array we want is nested one level down (res.data.data), never the
// top-level res.data. Reading res.data directly always yielded [] — that was
// why campaigns never pulled through. This helper finds the array in that shape.
function extractWbahArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.data))      return raw.data;
    if (Array.isArray(raw.result))    return raw.result;
    if (Array.isArray(raw.rows))      return raw.rows;
    if (Array.isArray(raw.campaigns)) return raw.campaigns;
  }
  return [];
}

// Map the raw WeeBespoke campaign shape onto the field names the UI expects.
// The API returns call_hour/call_minute (not call_time), frequency (not
// frequency_type), createdAt (not created_at) and a capitalised status
// ("Active"/"Custom"). Every original field is kept; we only add derived ones.
function normalizeWbahCampaign(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;
  const out: Record<string, unknown> = { ...raw };
  if (out.call_time == null && raw.call_hour != null) {
    const hh = String(raw.call_hour).padStart(2, "0");
    const mm = String(raw.call_minute ?? 0).padStart(2, "0");
    out.call_time = `${hh}:${mm}`;
  }
  if (out.frequency_type == null && raw.frequency != null) {
    out.frequency_type = String(raw.frequency).toLowerCase() === "custom" ? "custom" : "daily";
  }
  if (out.created_at == null && raw.createdAt != null) out.created_at = raw.createdAt;
  if (typeof raw.status === "string") out.status = raw.status.toLowerCase();
  return out;
}

export const getWbahCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Enforce WBAH membership / platform-admin BEFORE any data path (engine or
    // direct) so engine-routed campaign rows can never leak to a non-member.
    const cbs = await requireWbahCbs(context.userId);

    // Try DataSourceRouter first — routes through engine if a profile is configured
    try {
      const routed = await getCampaignData(WBAH_WORKSPACE_ID);
      if (routed.source === "engine") {
        return Array.isArray(routed.rows) ? routed.rows.map(normalizeWbahCampaign) : [];
      }
    } catch { /* fall through to direct call */ }

    // Fallback: direct WeeBespoke API call. The campaign array is nested at
    // res.data.data because of the API's { result, statuscode, message, data }
    // envelope — see extractWbahArray above.
    const res = await api.wbahGetCampaigns(cbs.getTokens, cbs.saveNewAccessToken, cbs.reloginFn);
    // Surface a real failure instead of silently returning an empty list — a 401
    // with a dead refresh token would otherwise look like "no campaigns" in the UI.
    if (!res.ok) throw new Error(res.error ?? "Failed to load campaigns from WeeBespoke");
    return extractWbahArray(res.data).map(normalizeWbahCampaign);
  });

// ── Credits / Minute Allocation Dashboard ─────────────────────────────────────
// Powers the Analytics → Credits tab. Fetches the WeeBespoke credit summary,
// monthly consumption trend, recharge history and Retell billing usage in
// parallel and normalizes them for the UI (matches the WeeBespoke Credit
// Dashboard: Total Allocated, Minutes Used, Remaining Balance, Usage %).
export const getWbahCredits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
    const gt = cbs.getTokens;
    const st = cbs.saveNewAccessToken;
    const rl = cbs.reloginFn;

    // The credit summary is the authoritative source for the tiles. Fetch it
    // FIRST with the relogin fallback so a stale single-session token self-heals
    // (WeeBespoke allows one active session and expires tokens quickly — every
    // other WBAH read passes reloginFn for exactly this reason). Doing it first
    // also lets the remaining three calls reuse the refreshed token instead of
    // racing four parallel 401→relogin attempts against the single-session limit.
    const summaryR = await api.wbahGetCreditSummary(gt, st, rl);
    if (!summaryR.ok) {
      // Surface the failure instead of silently returning a null summary, which
      // rendered every tile as 0 with no error (the original bug).
      console.error(
        `[wbah-credits] summary fetch failed status=${summaryR.status} err=${summaryR.error ?? "?"}`,
      );
      throw new Error(summaryR.error ?? "Failed to load credit summary from WeeBespoke");
    }

    const [monthlyR, historyR, retellR] = await Promise.all([
      api.wbahGetMonthlyUsage(gt, st, rl),
      api.wbahGetCreditHistory(gt, st, rl),
      api.wbahGetRetellUsage(gt, st, rl),
    ]);

    // summary / monthly / retell are objects nested under the API's
    // { result, statuscode, message, data } envelope; history is an array.
    const unwrap = (raw: any) =>
      raw && typeof raw === "object" && !Array.isArray(raw) && "data" in raw ? raw.data : raw;

    const rawSummary = (unwrap(summaryR.data) ?? null) as Record<string, unknown> | null;
    const monthlyObj = unwrap(monthlyR.data) as any;
    const months = Array.isArray(monthlyObj)
      ? monthlyObj
      : Array.isArray(monthlyObj?.months)
        ? monthlyObj.months
        : Array.isArray(monthlyObj?.monthly_usage)
          ? monthlyObj.monthly_usage
          : [];
    const rawRetell = (unwrap(retellR.data) ?? null) as Record<string, unknown> | null;
    const history = extractWbahArray(historyR.data);

    // Normalize the credit KPIs to the canonical field names the UI reads
    // (allocated_minutes / used_minutes / remaining_minutes / percent_used).
    // WeeBespoke's payload key naming/casing isn't contractually guaranteed, so
    // we tolerate common variants and draw from the summary first, then the
    // retell-usage object as a fallback — otherwise a single renamed key would
    // silently render every tile as 0 (the class of bug this task fixes).
    const num = (...vals: unknown[]): number | undefined => {
      for (const v of vals) {
        if (v == null) continue;
        const n = typeof v === "string" ? Number(v) : (v as number);
        if (typeof n === "number" && Number.isFinite(n)) return n;
      }
      return undefined;
    };
    const pick = (keys: string[]): number | undefined => {
      const a = rawSummary ?? {};
      const b = rawRetell ?? {};
      // Strict precedence: exhaust ALL summary variants before falling back to
      // any retell-usage variant, so the authoritative summary always wins even
      // when the two sources spell the same KPI differently.
      return num(...keys.map((k) => a[k]), ...keys.map((k) => b[k]));
    };
    const allocated = pick([
      "allocated_minutes", "allocatedMinutes", "total_allocated_minutes",
      "total_allocated", "totalAllocated", "minutes_allocated", "allocated",
      "credits_allocated",
    ]);
    const used = pick([
      "used_minutes", "usedMinutes", "total_used_minutes", "minutes_used",
      "total_used", "used", "consumed_minutes", "credits_used",
    ]);
    let remaining = pick([
      "remaining_minutes", "remainingMinutes", "minutes_remaining",
      "available_minutes", "balance_minutes", "remaining", "balance",
      "credits_remaining",
    ]);
    let percent = pick([
      "percent_used", "percentUsed", "usage_percent", "usagePercent",
      "percentage_used", "percentage", "percent",
    ]);
    const carried = pick([
      "carried_over_minutes", "carriedOverMinutes", "carryover_minutes",
      "carried_over", "carryover",
    ]);
    // Derive anything the API didn't send directly.
    if (remaining == null && allocated != null && used != null) {
      remaining = Math.max(0, allocated - used);
    }
    if (percent == null && allocated != null && allocated > 0 && used != null) {
      percent = (used / allocated) * 100;
    }
    const summary =
      rawSummary || rawRetell
        ? {
            ...(rawSummary ?? {}),
            allocated_minutes: allocated ?? 0,
            used_minutes: used ?? 0,
            remaining_minutes: remaining ?? 0,
            percent_used: percent ?? 0,
            ...(carried != null ? { carried_over_minutes: carried } : {}),
          }
        : null;

    return { summary, months, retell: rawRetell, history };
  });

export const createWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahCreateCampaign(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken, cbs.reloginFn);
    if (!res.ok) throw new Error(res.error ?? "Failed to create campaign");
    return res.data;
  });

export const pauseWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahPauseCampaign(data.id, cbs.getTokens, cbs.saveNewAccessToken, cbs.reloginFn);
    if (!res.ok) throw new Error(res.error ?? "Failed to pause campaign");
    return res.data;
  });

export const resumeWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahResumeCampaign(data.id, cbs.getTokens, cbs.saveNewAccessToken, cbs.reloginFn);
    if (!res.ok) throw new Error(res.error ?? "Failed to resume campaign");
    return res.data;
  });

export const deleteWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahDeleteCampaign(data.id, cbs.getTokens, cbs.saveNewAccessToken, cbs.reloginFn);
    if (!res.ok) throw new Error(res.error ?? "Failed to delete campaign");
    return res.data;
  });

export const updateWbahCampaignSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      id: z.string(),
      campaign_name: z.string().min(1).max(120),
      agent_id: z.string().nullable().optional(),
      lead_status: z.string().nullable().optional(),
      call_time: z.string().default("09:00"),
      timezone: z.string().default("Europe/London"),
      frequency_type: z.enum(["daily", "custom"]).default("daily"),
      interval_days: z.number().int().min(1).max(365).optional(),
      voicemail_enabled: z.boolean().optional(),
    }).parse(i ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { id, ...payload } = data;
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahUpdateCampaign(id, payload as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken, cbs.reloginFn);
    if (!res.ok) throw new Error(res.error ?? "Failed to update campaign");
    return res.data;
  });

export const toggleWbahCampaignVoicemailSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ id: z.string(), voicemail_enabled: z.boolean() }).parse(i ?? {}),
  )
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahCampaignVoicemail(
      data.id,
      { voicemail_enabled: data.voicemail_enabled },
      cbs.getTokens,
      cbs.saveNewAccessToken,
      cbs.reloginFn,
    );
    if (!res.ok) throw new Error(res.error ?? "Failed to update voicemail setting");
    return res.data;
  });

export const getWbahAgentsForCampaign = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
    const gt = cbs.getTokens;
    const st = cbs.saveNewAccessToken;
    const rl = cbs.reloginFn;

    const normalize = (raw: any) => ({
      id:                raw._id ?? raw.id ?? raw.agent_id ?? "",
      name:              raw.agent_name ?? raw.name ?? raw.agentName ?? raw._id ?? raw.id ?? "Unknown Agent",
      status:            raw.status ?? "active",
      voicemail_enabled: raw.voicemail_enabled ?? raw.voicemailEnabled ?? false,
      phone_number:      raw.phone_number ?? raw.phoneNumber ?? null,
    });

    const extractArr = (raw: any): any[] =>
      Array.isArray(raw) ? raw
      : Array.isArray(raw?.data)    ? raw.data
      : Array.isArray(raw?.agents)  ? raw.agents
      : Array.isArray(raw?.result)  ? raw.result
      : [];

    const campaignOnlyRes = await api.wbahGetAgents(gt, st, rl);
    const campaignArr = extractArr(campaignOnlyRes.data);
    if (campaignArr.length > 0) return campaignArr.map(normalize);

    const allRes = await api.wbahGetAgents(gt, st, rl);
    return extractArr(allRes.data).map(normalize);
  });

// ── Leads — self-healing paginated fetch (same pattern as listWbahCalls) ───────

export const listWbahLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Try DataSourceRouter first — routes through engine when a profile is configured
    try {
      const { getPeopleData } = await import("@/lib/api-engine/data-source-router.server");
      const routed = await getPeopleData(WBAH_WORKSPACE_ID);
      if (routed.source === "engine") return routed.rows;
    } catch { /* fall through to direct call */ }

    const cbs = await requireWbahCbs(context.userId);
    const gt  = cbs.getTokens;
    const st  = cbs.saveNewAccessToken;

    // ── Pages 1 & 2 in parallel — validates that ?currentPage=N advances ──
    const [p1Res, p2Res] = await Promise.all([
      api.wbahGetUserCallLeadPaged(1, gt, st),
      api.wbahGetUserCallLeadPaged(2, gt, st),
    ]);
    if (!p1Res.ok) throw new Error(p1Res.error ?? "Failed to fetch leads from WeeBespoke");

    const p1Raw      = p1Res.data as any;
    const p2Raw      = p2Res.ok ? p2Res.data as any : null;
    const p1Recs     = extractRecords(p1Raw);
    const p2Recs     = p2Raw ? extractRecords(p2Raw) : [];
    // Log the raw shape of both pages so we know the record key, pagination, and whether page 2 differs
    console.log(`[WBAH leads] p1 raw top-level keys: ${p1Raw && typeof p1Raw === "object" ? Object.keys(p1Raw).join(",") : typeof p1Raw}`);
    console.log(`[WBAH leads] p1 sample record keys: ${p1Recs[0] ? Object.keys(p1Recs[0]).join(",") : "no records"}`);
    console.log(`[WBAH leads] p1 pagination object: ${JSON.stringify(p1Raw?.pagination ?? null)}`);
    console.log(`[WBAH leads] p2 ok=${p2Res.ok} status=${p2Res.status} raw keys: ${p2Raw && typeof p2Raw === "object" ? Object.keys(p2Raw).join(",") : typeof p2Raw} records=${p2Recs.length}`);
    const pagination = p1Raw?.pagination;
    const totalItems = pagination?.totalItems ?? pagination?.totalRecords ?? pagination?.total_count ?? pagination?.count ?? 0;
    const pageSize   = pagination?.pageSize ?? pagination?.page_size ?? pagination?.limit ?? pagination?.perPage ?? (p1Recs.length || 50);
    const totalPages = totalItems > 0 ? Math.ceil(totalItems / pageSize) : (pagination?.totalPages ?? 1);

    // Detect pagination advance by comparing a stable unique key from the first record of each page.
    // Falls back through several fields so we don't get tripped up if _id is absent.
    const recordKey = (r: any): string | null =>
      r?._id ?? r?.id ?? (r?.srNo != null ? String(r.srNo) : null) ?? r?.toNumber ?? r?.mobile_number ?? null;
    const p1FirstId = recordKey(p1Recs[0]);
    const p2FirstId = recordKey(p2Recs[0]);
    const paginationWorks = p2FirstId !== null && p2FirstId !== p1FirstId;
    console.log(
      `[WBAH leads] page1: records=${p1Recs.length} totalItems=${totalItems} pageSize=${pageSize} totalPages=${totalPages}` +
      ` | page2: records=${p2Recs.length} firstId=${p2FirstId} | paginationWorks=${paginationWorks}`,
    );

    // ── If ?currentPage=N didn't advance, probe alternative GET/POST param names ──
    // Probe fires when: pagination doesn't advance AND either (a) we know there are
    // more pages, OR (b) pagination metadata is absent (pagination==null) and page1
    // returned a full page (suggesting more pages exist).
    type PageFn = (page: number) => Promise<any>;
    let pageFn: PageFn = (p) => api.wbahGetUserCallLeadPaged(p, gt, st);
    const unknownTotal  = !pagination || totalItems === 0;
    const likelyHasMore = unknownTotal ? (p1Recs.length >= pageSize) : (totalPages > 1);

    if (!paginationWorks && likelyHasMore) {
      console.log(`[WBAH leads] ⚠ ?currentPage=2 did not advance — probing alternative pagination keys… (unknownTotal=${unknownTotal} totalPages=${totalPages})`);
      const LEAD_BASE = "/call-output-data/get-userCall-lead";
      const candidates: Array<{ label: string; fn: PageFn }> = [
        { label: "?page=N",        fn: (p) => api.authenticatedFetch(`${LEAD_BASE}?page=${p}`,        { method: "GET" }, gt, st) },
        { label: "?pageNumber=N",  fn: (p) => api.authenticatedFetch(`${LEAD_BASE}?pageNumber=${p}`,  { method: "GET" }, gt, st) },
        { label: "?pageNo=N",      fn: (p) => api.authenticatedFetch(`${LEAD_BASE}?pageNo=${p}`,      { method: "GET" }, gt, st) },
        { label: "?offset=N*ps",   fn: (p) => api.authenticatedFetch(`${LEAD_BASE}?offset=${(p - 1) * pageSize}&limit=${pageSize}`, { method: "GET" }, gt, st) },
        { label: "POST?curPage=N", fn: (p) => api.authenticatedFetch(`${LEAD_BASE}?currentPage=${p}`, { method: "POST", body: "{}" }, gt, st) },
        { label: "POST?page=N",    fn: (p) => api.authenticatedFetch(`${LEAD_BASE}?page=${p}`,        { method: "POST", body: "{}" }, gt, st) },
      ];

      const probeResults = await Promise.all(candidates.map((c) => c.fn(2)));
      let foundKey: typeof candidates[number] | null = null;

      for (let i = 0; i < candidates.length; i++) {
        const res   = probeResults[i];
        const recs  = res?.ok ? extractRecords(res.data) : [];
        const first = recs[0]?._id ?? recs[0]?.id ?? null;
        console.log(`[WBAH leads] probe ${candidates[i].label} → ok=${res?.ok} records=${recs.length} firstId=${first}`);
        if (first && first !== p1FirstId) {
          foundKey = candidates[i];
          p2Recs.length = 0;
          p2Recs.push(...recs);
          break;
        }
      }

      if (foundKey) {
        console.log(`[WBAH leads] ✓ working pagination key: ${foundKey.label}`);
        pageFn = foundKey.fn;
      } else {
        console.log(`[WBAH leads] ✗ no key advanced — will try fetch-until-empty with ?currentPage=N`);
      }
    }

    // ── Fetch remaining pages ──────────────────────────────────────────────
    const effectivelyWorks = paginationWorks || (p2Recs.length > 0 && (p2Recs[0]?._id ?? p2Recs[0]?.id) !== p1FirstId);
    const allRecs: any[] = effectivelyWorks ? [...p1Recs, ...p2Recs] : [...p1Recs];
    const BATCH = 20;

    if (effectivelyWorks && totalPages > 2) {
      // Known total — fetch remaining pages by count
      const remaining = Array.from({ length: totalPages - 2 }, (_, i) => i + 3);
      let firstEmptyLogged = false;
      for (let i = 0; i < remaining.length; i += BATCH) {
        const batch   = remaining.slice(i, i + BATCH);
        const results = await Promise.all(batch.map((p) => pageFn(p)));
        let   found   = 0;
        for (const res of results) {
          if (res?.ok) { const recs = extractRecords(res.data); allRecs.push(...recs); found += recs.length; }
        }
        console.log(`[WBAH leads] batch pages ${batch[0]}-${batch[batch.length - 1]} → +${found} (total: ${allRecs.length})`);
        if (found === 0 && !firstEmptyLogged) {
          firstEmptyLogged = true;
          const diag = results.slice(0, 3).map((r, ri) => `p${batch[ri]}:HTTP${r?.status}ok=${r?.ok}recs=${r?.ok ? extractRecords(r.data).length : "FAIL"}`).join(" | ");
          console.log(`[WBAH leads] ⚠ FIRST EMPTY BATCH: ${diag} | raw: ${JSON.stringify((results[0]?.data as any) ?? results[0]?.error).slice(0, 300)}`);
        }
        if (found === 0 && allRecs.length > 0) { console.log(`[WBAH leads] ℹ stopping early at page ${batch[0]}.`); break; }
      }
    } else if (effectivelyWorks || likelyHasMore) {
      // Unknown total OR pagination works but totalPages ≤ 2 — fetch until empty / no new records
      console.log(`[WBAH leads] using fetch-until-empty (effectivelyWorks=${effectivelyWorks} likelyHasMore=${likelyHasMore})`);
      const seenIds = new Set(allRecs.map((r: any) => r._id ?? r.id ?? ""));
      let page = effectivelyWorks ? 3 : 2;
      while (page <= 500) {
        const batch   = Array.from({ length: BATCH }, (_, i) => page + i);
        const results = await Promise.all(batch.map((p) => pageFn(p)));
        let   newFound = 0;
        for (const res of results) {
          if (res?.ok) {
            for (const r of extractRecords(res.data)) {
              const rid = r._id ?? r.id ?? "";
              if (!seenIds.has(rid)) { seenIds.add(rid); allRecs.push(r); newFound++; }
            }
          }
        }
        console.log(`[WBAH leads] fetch-until-empty pages ${batch[0]}-${batch[batch.length - 1]} → +${newFound} new (total: ${allRecs.length})`);
        if (newFound === 0) { console.log(`[WBAH leads] ℹ no new records in batch — done.`); break; }
        page += BATCH;
      }
    }

    console.log(`[WBAH leads] final total: ${allRecs.length} records`);
    const leads = allRecs.map((r: any, idx: number) => normaliseLeadRecord(r, idx));

    // Count how many times each phone number appears (for "Times Called" column).
    // Do NOT deduplicate — show every raw record so the count matches WeeBespoke.
    const phoneCounts = new Map<string, number>();
    for (const lead of leads) {
      const phone = (lead.contact as string | null) ?? "";
      if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1);
    }

    const annotated = leads.map(lead => ({
      ...lead,
      callCount: phoneCounts.get((lead.contact as string | null) ?? "") ?? 1,
    }));

    annotated.sort((a, b) => {
      const ta = a.lastCalledAt ? new Date(a.lastCalledAt as string).getTime() : 0;
      const tb = b.lastCalledAt ? new Date(b.lastCalledAt as string).getTime() : 0;
      return tb - ta;
    });
    return annotated;
  });

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseLeadRecord(r: any, idx: number) {
  return {
    id:                 String(r._id ?? r.id ?? idx),
    srNo:               r.srNo ?? r.sr_no ?? null,
    name:               r.name ?? r.fullName ?? r.full_name ?? r.contactName ?? null,
    contact:            r.toNumber ?? r.mobile_number ?? r.phone ?? r.contact ?? null,
    type:               r.type ?? r.leadType ?? "Lead",
    lastCalledAt:       r.lastCalledAt ?? r.last_called_at ?? r.calledAt ?? r.created_at ?? null,
    callStatus:         r.callStatus ?? r.call_status ?? r.status ?? null,
    callDuration:       r.callDuration ?? r.call_duration ?? r.duration ?? null,
    recordingUrl:       r.recordingUrl ?? r.recording_url ?? r.recordingLink ?? null,
    transcript:         r.transcript ?? r.callTranscript ?? null,
    sentiment:          r.sentimentAnalysis ?? r.sentiment ?? null,
    direction:          r.direction ?? r.callDirection ?? null,
    appointmentDate:    r.appointmentDate ?? r.appointment_date ?? null,
    appointmentTime:    r.appointmentTime ?? r.appointment_time ?? null,
    bookingStatus:      r.bookingStatus ?? r.booking_status ?? null,
    calendlyBookingUrl: r.calendlyBookingUrl ?? r.calendly_booking_url ?? r.calendlyUrl ?? null,
    endReason:          r.endReason ?? r.end_reason ?? null,
    disconnectionReason:r.disconnectionReason ?? r.disconnection_reason ?? null,
    agentName:          r.agentName ?? r.agent_name ?? r.assignedAgent ?? r.agent ?? null,
    callSummary:        r.callSummary ?? r.call_summary ?? r.summary ?? null,
  };
}

function extractRecords(raw: any): any[] {
  if (Array.isArray(raw))                 return raw;
  if (Array.isArray(raw?.data))           return raw.data;
  if (Array.isArray(raw?.calls))          return raw.calls;
  if (Array.isArray(raw?.records))        return raw.records;
  if (Array.isArray(raw?.leads))          return raw.leads;
  if (Array.isArray(raw?.result))         return raw.result;
  if (Array.isArray(raw?.items))          return raw.items;
  // Additional keys seen in WeeBespoke lead/call endpoints
  if (Array.isArray(raw?.callLeads))      return raw.callLeads;
  if (Array.isArray(raw?.callData))       return raw.callData;
  if (Array.isArray(raw?.userCallLeads))  return raw.userCallLeads;
  if (Array.isArray(raw?.list))           return raw.list;
  if (Array.isArray(raw?.rows))           return raw.rows;
  if (Array.isArray(raw?.docs))           return raw.docs;
  if (Array.isArray(raw?.payload))        return raw.payload;
  if (Array.isArray(raw?.response))       return raw.response;
  // Last-resort: find the first array-valued property on the object
  if (raw && typeof raw === "object") {
    for (const v of Object.values(raw)) {
      if (Array.isArray(v) && (v as any[]).length > 0) return v as any[];
    }
  }
  return [];
}

/** Read totalPages from WeeBespoke pagination object. Returns null if unknown.
 *
 * IMPORTANT: the WeeBespoke API's `totalPages` field is known to be wrong
 * (e.g. it may say 13 when there are actually 203 pages worth of data).
 * We therefore ALWAYS prefer computing the page count from totalItems ÷ pageSize,
 * and only fall back to the API-provided `totalPages` if we have nothing better.
 */
function extractTotalPages(raw: any): number | null {
  const p = raw?.pagination;
  if (!p) return null;

  // ONLY trust a computed value from totalItems ÷ pageSize.
  // The API's own totalPages field is known to be wrong (e.g. returns 13 when
  // there are really 203 pages for calls). Never fall back to it.
  const totalItems = p.totalItems ?? p.totalRecords ?? p.total_records ?? p.total_count ?? p.count ?? p.total;
  const pageSize   = p.pageSize ?? p.page_size ?? p.limit ?? p.perPage ?? p.per_page;
  if (typeof totalItems === "number" && typeof pageSize === "number" && pageSize > 0) {
    return Math.ceil(totalItems / pageSize);
  }

  // Cannot determine page count reliably — caller will use "fetch until empty" fallback.
  return null;
}

/** Fetch every page of a paginated WeeBespoke endpoint in parallel batches. */
async function fetchAllPages(
  fetchPage: (page: number) => Promise<any>,
  firstRaw: any,
  label = "endpoint",
): Promise<any[]> {
  const firstRecs  = extractRecords(firstRaw);
  const totalPages = extractTotalPages(firstRaw) ?? null;
  console.log(`[WBAH fetchAllPages:${label}] page1.records=${firstRecs.length} totalPages=${totalPages} pagination=${JSON.stringify(firstRaw?.pagination ?? null)}`);

  // If we know total pages, fetch all remaining in parallel batches of 20
  if (totalPages && totalPages > 1) {
    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const BATCH = 20;
    const allRecs = [...firstRecs];
    for (let i = 0; i < remaining.length; i += BATCH) {
      const batch   = remaining.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((p) => fetchPage(p)));
      let batchFound = 0;
      for (const res of results) {
        if (res?.ok && res?.data) {
          const recs = extractRecords(res.data);
          allRecs.push(...recs);
          batchFound += recs.length;
        }
      }
      console.log(`[WBAH fetchAllPages:${label}] batch pages ${batch[0]}-${batch[batch.length - 1]} → +${batchFound} records (running total: ${allRecs.length})`);
    }
    return allRecs;
  }

  // Fallback: fetch until we get an empty batch (unknown total pages)
  console.log(`[WBAH fetchAllPages:${label}] no totalPages from API — using "fetch until empty" fallback`);
  const BATCH   = 20;
  const allRecs = [...firstRecs];
  let   page    = 2;
  while (page <= 500) {
    const batch   = Array.from({ length: BATCH }, (_, i) => page + i);
    const results = await Promise.all(batch.map((p) => fetchPage(p)));
    let   found   = 0;
    for (const res of results) {
      if (res?.ok && res?.data) {
        const recs = extractRecords(res.data);
        allRecs.push(...recs);
        found += recs.length;
      }
    }
    console.log(`[WBAH fetchAllPages:${label}] fallback batch pages ${batch[0]}-${batch[batch.length - 1]} → +${found} records (running total: ${allRecs.length})`);
    if (found === 0) break;
    page += BATCH;
  }
  return allRecs;
}

function extractCountFromResponse(raw: any, fallback: number): number {
  return raw?.total ?? raw?.totalCount ?? raw?.count ?? raw?.pagination?.total ?? fallback;
}

function formatDurationMs(ms: number | null | undefined): string | null {
  if (!ms || ms <= 0) return null;
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}s`;
  return `${m}m ${sec}s`;
}

// ── All WeeBespoke calls — POST /get-user-history, all 10,149 records ──────────
//
// Endpoint audit confirmed:
//   POST /call-output-data/get-user-history → totalItems=10,149, pageSize=10 (hardcoded)
//   Pagination key: { currentPage: N }
//   Fields: snake_case (call_id, customer_name, to_number, duration_ms, etc.)
//
// GET /get-all-calldata (609 records) = CRM contacts-to-call, NOT completed calls.
// GET /get-userCall-lead (1,201 records) = analyzed/qualified leads (contacts page).

export const listWbahCalls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Try DataSourceRouter first — routes through engine when a profile is configured
    try {
      const { getCallsData } = await import("@/lib/api-engine/data-source-router.server");
      const routed = await getCallsData(WBAH_WORKSPACE_ID);
      if (routed.source === "engine") return routed.rows;
    } catch { /* fall through to direct call */ }

    const cbs = await requireWbahCbs(context.userId);
    const gt = cbs.getTokens;
    const st = cbs.saveNewAccessToken;

    // ── Pages 1 & 2 in parallel — validates pagination key works ─────────
    const [p1Res, p2Res] = await Promise.all([
      api.wbahGetUserHistoryPaged(1, gt, st),
      api.wbahGetUserHistoryPaged(2, gt, st),
    ]);
    if (!p1Res.ok) {
      console.log(`[WBAH calls] get-user-history page1 failed: status=${p1Res.status} err=${p1Res.error}`);
      throw new Error(p1Res.error ?? "Failed to fetch calls from WeeBespoke");
    }
    const p1Raw        = p1Res.data as any;
    const p1Recs       = Array.isArray(p1Raw?.data) ? p1Raw.data : [];
    const p2Recs       = (p2Res.ok && Array.isArray((p2Res.data as any)?.data)) ? (p2Res.data as any).data : [];
    const pagination   = p1Raw?.pagination;
    const totalItems   = pagination?.totalItems ?? 0;
    // pageSize is hardcoded to 10 by the API regardless of payload
    const totalPages   = pagination?.totalPages ?? Math.ceil(totalItems / 10);

    // Detect whether pagination is advancing — compare first call_id of each page
    const p1FirstId = p1Recs[0]?.call_id ?? null;
    const p2FirstId = p2Recs[0]?.call_id ?? null;
    const paginationWorks = p2FirstId !== null && p2FirstId !== p1FirstId;
    console.log(
      `[WBAH calls] get-user-history page1: records=${p1Recs.length} totalItems=${totalItems} totalPages=${totalPages}` +
      ` | page2: records=${p2Recs.length} firstId=${p2FirstId} | paginationWorks=${paginationWorks}`,
    );

    // ── If currentPage didn't advance, discover the real pagination key ──
    type PageFn = (page: number) => Promise<any>;
    let pageFn: PageFn = (p) => api.wbahGetUserHistoryPaged(p, gt, st);

    if (!paginationWorks && totalPages > 1) {
      console.log(`[WBAH calls] ⚠ { currentPage: 2 } did not advance — probing alternative pagination keys…`);

      // Try URL query-param variants (body params are ignored by this endpoint)
      // Note: ?currentPage=N is already tried via wbahGetUserHistoryPaged above
      const candidates: Array<{ label: string; fn: PageFn }> = [
        { label: "?page=N",       fn: (p) => api.authenticatedFetch(`/call-output-data/get-user-history?page=${p}`,       { method: "POST", body: "{}" }, gt, st) },
        { label: "?pageNumber=N", fn: (p) => api.authenticatedFetch(`/call-output-data/get-user-history?pageNumber=${p}`, { method: "POST", body: "{}" }, gt, st) },
        { label: "?pageNo=N",     fn: (p) => api.authenticatedFetch(`/call-output-data/get-user-history?pageNo=${p}`,     { method: "POST", body: "{}" }, gt, st) },
        { label: "?offset=N*10",  fn: (p) => api.authenticatedFetch(`/call-output-data/get-user-history?offset=${(p-1)*10}`, { method: "POST", body: "{}" }, gt, st) },
        { label: "body{page:N}",  fn: (p) => api.wbahGetUserHistory({ page: p }, gt, st) },
      ];

      const probeResults = await Promise.all(candidates.map((c) => c.fn(2)));
      let foundKey: typeof candidates[number] | null = null;

      for (let i = 0; i < candidates.length; i++) {
        const res = probeResults[i];
        if (res?.ok) {
          const recs = Array.isArray((res.data as any)?.data) ? (res.data as any).data : [];
          const firstId = recs[0]?.call_id ?? null;
          console.log(`[WBAH calls] probe ${candidates[i].label} → records=${recs.length} firstId=${firstId}`);
          if (firstId && firstId !== p1FirstId) {
            foundKey = candidates[i];
            // Add the page-2 results we already have
            p2Recs.length = 0;
            p2Recs.push(...recs);
            break;
          }
        }
      }

      if (foundKey) {
        console.log(`[WBAH calls] ✓ working pagination key: ${foundKey.label}`);
        pageFn = foundKey.fn;
      } else {
        console.log(`[WBAH calls] ✗ no pagination key advanced the page — will return page1 only (${p1Recs.length} records)`);
      }
    }

    // ── Fetch remaining pages in parallel batches of 20 ──────────────────
    const effectivePaginationWorks = paginationWorks || (p2Recs.length > 0 && p2Recs[0]?.call_id !== p1FirstId);
    const allRecs: any[] = effectivePaginationWorks ? [...p1Recs, ...p2Recs] : [...p1Recs];

    if (effectivePaginationWorks && totalPages > 2) {
      const remaining = Array.from({ length: totalPages - 2 }, (_, i) => i + 3);
      const BATCH = 20;
      let   firstEmptyBatchLogged = false;
      for (let i = 0; i < remaining.length; i += BATCH) {
        const batch   = remaining.slice(i, i + BATCH);
        const results = await Promise.all(batch.map((p) => pageFn(p)));
        let   found   = 0;
        for (const res of results) {
          if (res?.ok) {
            const recs = Array.isArray((res.data as any)?.data) ? (res.data as any).data : [];
            allRecs.push(...recs);
            found += recs.length;
          }
        }
        console.log(`[WBAH calls] get-user-history batch pages ${batch[0]}-${batch[batch.length - 1]} → +${found} (total: ${allRecs.length})`);

        // On the first batch that returns zero — log HTTP statuses + raw data to diagnose the cause
        if (found === 0 && !firstEmptyBatchLogged) {
          firstEmptyBatchLogged = true;
          const statusSummary = results.slice(0, 3).map((r, ri) => {
            const recs = r?.ok ? (Array.isArray((r.data as any)?.data) ? (r.data as any).data?.length : "non-array") : "FAIL";
            return `p${batch[ri]}: HTTP${r?.status} ok=${r?.ok} recs=${recs}`;
          }).join(" | ");
          const rawSample = JSON.stringify((results[0]?.data as any) ?? results[0]?.error).slice(0, 400);
          console.log(`[WBAH calls] ⚠ FIRST EMPTY BATCH diagnosis: ${statusSummary}`);
          console.log(`[WBAH calls] ⚠ raw response sample: ${rawSample}`);
        }

        // Stop early if many consecutive empty batches — no more data on the server
        if (found === 0 && i > 0 && allRecs.length > 0) {
          const prevBatchStart = remaining[i - BATCH] ?? 3;
          const prevBatchEnd   = remaining[Math.min(i - 1, remaining.length - 1)];
          console.log(`[WBAH calls] ℹ all-zero batches starting at page ${batch[0]} — likely server max. Stopping early.`);
          break;
        }
      }
    }

    // ── Deduplicate by call_id (safety net for overlapping pages) ─────────
    const seenIds = new Set<string>();
    const deduped: any[] = [];
    for (const r of allRecs) {
      const key = r.call_id ?? r._id ?? r.id;
      if (key === undefined || key === null || !seenIds.has(String(key))) {
        if (key !== undefined && key !== null) seenIds.add(String(key));
        deduped.push(r);
      }
    }
    if (deduped.length !== allRecs.length) {
      console.log(`[WBAH calls] dedup: ${allRecs.length} raw → ${deduped.length} unique records`);
    }

    console.log(`[WBAH calls] get-user-history COMPLETE: unique=${deduped.length} of totalItems=${totalItems}`);

    const calls = deduped.map((r: any, idx: number) => normaliseWbahCall(r, idx));

    // Count how many times each phone number appears across all call records
    const phoneCounts = new Map<string, number>();
    for (const c of calls) {
      const phone = (c.wbah_contact ?? "") as string;
      if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1);
    }
    for (const c of calls) {
      const phone = (c.wbah_contact ?? "") as string;
      (c as any).call_count = phone ? (phoneCounts.get(phone) ?? 1) : 1;
    }

    calls.sort((a, b) => {
      const ta = a.started_at ? new Date(a.started_at as string).getTime() : 0;
      const tb = b.started_at ? new Date(b.started_at as string).getTime() : 0;
      return tb - ta;
    });
    return calls;
  });

// ── Latest 10 calls — page 1 of get-user-history — used for incremental polling ─

export const listWbahLatestCalls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetUserHistoryPaged(1, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) return [];
    const recs  = Array.isArray((res.data as any)?.data) ? (res.data as any).data : [];
    const calls = recs.map((r: any, idx: number) => normaliseWbahCall(r, idx));
    calls.sort((a: any, b: any) => {
      const ta = a.started_at ? new Date(a.started_at as string).getTime() : 0;
      const tb = b.started_at ? new Date(b.started_at as string).getTime() : 0;
      return tb - ta;
    });
    return calls;
  });

// ── CRM Contacts — single call returns all 3,720 records (no pagination) ──────

export const listWbahCrmContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Try DataSourceRouter first — routes through engine when a profile is configured
    try {
      const { getCRMData } = await import("@/lib/api-engine/data-source-router.server");
      const routed = await getCRMData(WBAH_WORKSPACE_ID);
      if (routed.source === "engine") return routed.rows;
    } catch { /* fall through to direct call */ }

    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetCrmData(cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to fetch CRM contacts");
    const recs = extractRecords(res.data as any);
    return recs.map((r: any, idx: number) => ({
      id:        String(r._id ?? r.id ?? idx),
      name:      r.name ?? r.fullName ?? r.full_name ?? null,
      contact:   r.mobile_number ?? r.phone ?? r.toNumber ?? null,
      email:     r.email ?? null,
      type:      r.type ?? r.leadType ?? "Contact",
      status:    r.status ?? r.callStatus ?? null,
      srNo:      r.srNo ?? r.sr_no ?? null,
      agentName: r.agentName ?? r.agent_name ?? null,
      createdAt: r.createdAt ?? r.created_at ?? null,
    }));
  });

// ── All-call-data — GET /get-all-calldata (386 records, 8 pages) ──────────────
//
// CRM contacts-to-call. Includes records where callId === null (not yet called).
// Used to populate the People tab in Data Records for the WBAH workspace.

export const listWbahAllCallData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
    const gt  = cbs.getTokens;
    const st  = cbs.saveNewAccessToken;
    const rl  = cbs.reloginFn;

    function extractRecs(raw: any): any[] {
      return Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
    }

    const p1Res = await api.wbahGetAllCallDataPaged(1, gt, st, rl);
    if (!p1Res.ok) throw new Error(p1Res.error ?? "Failed to fetch call data from WeeBespoke");

    const p1Raw    = p1Res.data as any;
    const pagination = p1Raw?.pagination;
    const totalPages = pagination?.totalPages ?? 1;
    const allRecs: any[] = [...extractRecs(p1Raw)];

    for (let page = 2; page <= totalPages; page += 8) {
      const batch = Array.from({ length: Math.min(8, totalPages - page + 1) }, (_, i) => page + i);
      const settled = await Promise.allSettled(batch.map(p => api.wbahGetAllCallDataPaged(p, gt, st, rl)));
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value.ok) allRecs.push(...extractRecs(r.value.data as any));
      }
    }

    return allRecs.map((r: any, idx: number) => ({
      id:                  String(r.id ?? r._id ?? idx),
      srNo:                idx + 1,
      name:                r.name ?? r.fullName ?? null,
      contact:             r.toNumber ?? r.fromNumber ?? r.phone ?? null,
      callType:            r.callType ?? "Lead",
      callId:              r.callId ?? null,
      agentName:           r.agentName ?? null,
      callStatus:          r.callStatus ?? null,
      startTimestamp:      r.startTimestamp ? Number(r.startTimestamp) : null,
      durationMs:          r.durationMs    ? Number(r.durationMs)    : null,
      recordingUrl:        r.recordingUrl  ?? null,
      transcript:          r.transcript    ?? null,
      sentimentAnalysis:   r.sentimentAnalysis ?? null,
      endReason:           r.endReason           ?? null,
      disconnectionReason: r.disconnectionReason ?? null,
      email:               r.email    ?? null,
      leadId:              r.lead_id  ?? null,
      appointmentDate:     r.appointment_date  ?? null,
      appointmentTime:     r.appointment_time  ?? null,
      bookingStatus:       r.booking_status    ?? null,
      calendlyBookingUrl:  r.calendly_booking_url ?? null,
    }));
  });

function normaliseWbahCall(r: any, idx: number): Record<string, unknown> {
  // ── Identity ──────────────────────────────────────────────────────────────
  // get-user-history uses call_id; get-userCall-lead uses id
  const id    = String(r.call_id ?? r._id ?? r.id ?? `wbah-${idx}`);
  // get-user-history uses customer_name; get-userCall-lead uses name
  const name  = r.customer_name ?? r.name ?? r.fullName ?? r.full_name ?? r.contactName ?? null;
  // get-user-history uses to_number (snake); get-userCall-lead uses toNumber (camel)
  const phone = r.to_number ?? r.toNumber ?? r.mobile_number ?? r.phone ?? r.phoneNumber ?? null;
  const agentName = r.agentName ?? r.agent_name ?? r.assignedAgent ?? null;

  // ── Call status ───────────────────────────────────────────────────────────
  // get-user-history uses call_status; get-userCall-lead uses callStatus
  const rawStatus = (r.call_status ?? r.callStatus ?? r.status ?? "").toLowerCase();
  let callStatus: string;
  if (rawStatus === "ended" || rawStatus === "call_analyzed" || rawStatus === "completed") {
    callStatus = "completed";
  } else if (["not_connected","voicemail","voicemail_reached","no_answer","missed"].includes(rawStatus)) {
    callStatus = "no_answer";
  } else if (rawStatus === "failed") {
    callStatus = "failed";
  } else {
    callStatus = rawStatus || "completed";
  }

  // ── Sentiment ─────────────────────────────────────────────────────────────
  // get-user-history: sentiment_analysis (string or object)
  // get-userCall-lead: sentimentAnalysis (string or object)
  const sentVal = r.sentiment_analysis ?? r.sentimentAnalysis ?? r.sentiment ?? "";
  const rawSentiment = (() => {
    if (typeof sentVal === "string") return sentVal.toLowerCase();
    if (sentVal && typeof sentVal === "object") {
      return String(sentVal.overall ?? sentVal.label ?? sentVal.score ?? "").toLowerCase();
    }
    return "";
  })();
  let sentiment: string | null = null;
  if (/positive/.test(rawSentiment))       sentiment = "positive";
  else if (/neutral/.test(rawSentiment))   sentiment = "neutral";
  else if (/negative/.test(rawSentiment))  sentiment = "negative";

  // ── Duration ──────────────────────────────────────────────────────────────
  // get-user-history: duration_ms (snake), duration (string seconds?)
  // get-userCall-lead: durationMs (camel)
  let durationSeconds: number | null = null;
  const dmsRaw = r.duration_ms ?? r.durationMs;
  if (dmsRaw && Number(dmsRaw) > 0) {
    durationSeconds = Math.round(Number(dmsRaw) / 1000);
  } else if (r.callDuration) {
    durationSeconds = Number(r.callDuration) || null;
  } else if (r.duration) {
    // get-user-history "duration" field — could be seconds or ms; treat as seconds if <10000
    const d = Number(r.duration);
    if (d > 0) durationSeconds = d > 10_000 ? Math.round(d / 1000) : d;
  }

  // ── Timestamps ────────────────────────────────────────────────────────────
  // get-user-history: call_updatedat; get-userCall-lead: startTimestamp / createdAt
  const startedAt =
    r.startTimestamp
      ? new Date(Number(r.startTimestamp)).toISOString()
      : r.call_updatedat ?? r.lastCalledAt ?? r.last_called_at ?? r.calledAt
        ?? r.createdAt ?? r.created_at ?? null;

  // ── Direction ─────────────────────────────────────────────────────────────
  const dir = (r.direction ?? r.callDirection ?? r.call_type ?? r.callType ?? r.type ?? "outbound").toLowerCase();
  const callType = dir.includes("inbound") ? "inbound" : "outbound";

  return {
    id,
    agent_id:              null,
    agent_name:            agentName,
    call_status:           callStatus,
    call_type:             callType,
    duration_seconds:      durationSeconds,
    started_at:            startedAt,
    ended_at:              null,
    recording_url:         r.recording_url ?? r.recordingUrl ?? null,
    transcript:            r.transcript ?? r.callTranscript ?? null,
    call_summary:          r.transcript ?? r.callTranscript ?? r.callSummary ?? null,
    from_number:           callType === "inbound"  ? phone : null,
    to_number:             callType === "outbound" ? phone : null,
    sentiment,
    disconnection_reason:  r.disconnection_reason ?? r.disconnectionReason ?? null,
    cost_cents:            null,
    retell_call_id:        null,
    lead:                  name ? { id, full_name: name, phone: phone ?? "" } : null,
    // WeeBespoke-specific extras
    wbah_name:             name,
    wbah_contact:          phone,
    appointment_date:      r.call_appointment_date ?? r.appointmentDate ?? r.appointment_date ?? null,
    appointment_time:      r.call_appointment_time ?? r.appointmentTime ?? r.appointment_time ?? null,
    booking_status:        r.call_booking_status ?? r.bookingStatus ?? r.booking_status ?? null,
    calendly_booking_url:  r.call_calendly_booking_url ?? r.calendlyBookingUrl ?? r.calendly_booking_url ?? r.calendlyUrl ?? null,
    end_reason:            r.end_reason ?? r.endReason ?? null,
  };
}

// ── Read WBAH calls from DB (synced by wbah-calls-sync.plugin) ───────────────

// Plain DB read of wbah_calls (paginated + shaped to the calls-table contract).
// Kept OUTSIDE any cacheWrap so the "live" path can refresh THEN read without a
// stale cached payload masking the just-upserted rows.
// `lite` excludes the heavy transcript/call_summary fields so the full list
// stays well under Upstash/browser limits (transcripts load on demand via
// getWbahCallDetail). KPIs, filters and search do not need those fields.
async function readWbahCallsRows(supabase: any, workspaceId: string, opts?: { lite?: boolean }) {
  const sb = supabase as any;
  const lite = opts?.lite ?? false;
  const cols = lite
    ? "id, customer_name, phone, agent_name, call_status, call_type, sentiment, duration_seconds, started_at, recording_url, disconnection_reason, end_reason, appointment_date, appointment_time, booking_status, calendly_booking_url, call_count, transcript"
    : "*";
  // Supabase PostgREST caps rows at 1000 by default — paginate to fetch all.
  const PAGE = 1000;
  const allRows: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("wbah_calls")
      .select(cols)
      .eq("workspace_id", workspaceId)
      .order("started_at", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  const mapped = allRows.map((r: any) => ({
    id:                   r.id,
    agent_id:             null,
    agent_name:           r.agent_name,
    call_status:          r.call_status,
    call_type:            r.call_type ?? "outbound",
    duration_seconds:     r.duration_seconds,
    started_at:           r.started_at,
    ended_at:             null,
    recording_url:        r.recording_url,
    // In lite mode the transcript text is dropped from the payload; the client
    // fetches it on demand. `hasTranscript` still drives the "View" button.
    transcript:           lite ? null : r.transcript,
    hasTranscript:        !!(r.transcript && String(r.transcript).trim()),
    call_summary:         lite ? null : r.call_summary,
    from_number:          r.call_type === "inbound"  ? r.phone : null,
    to_number:            r.call_type === "outbound" ? r.phone : null,
    sentiment:            r.sentiment,
    disconnection_reason: r.disconnection_reason,
    cost_cents:           null,
    retell_call_id:       null,
    lead:                 r.customer_name ? { id: r.id, full_name: r.customer_name, phone: r.phone ?? "" } : null,
    wbah_name:            r.customer_name,
    wbah_contact:         r.phone,
    appointment_date:     r.appointment_date,
    appointment_time:     r.appointment_time,
    booking_status:       r.booking_status,
    calendly_booking_url: r.calendly_booking_url,
    end_reason:           r.end_reason,
    call_count:           r.call_count ?? 1,
  }));
  return enrichWbahCallRowsWithBookings(supabaseAdmin, workspaceId, mapped);
}

// NOTE: the full WBAH calls list is ~20MB (15k+ rows with transcripts) — far
// over Upstash's 10MB request limit and against the "no full lists in Redis"
// policy. Supabase is the source of truth and is read directly (indexed,
// paginated). We do NOT cacheWrap the whole list.
export const listWbahCallsFromDb = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    return readWbahCallsRows(supabase, workspaceId);
  });

// Live variant: pulls the newest calls from WeeBespoke on open (incremental,
// stored-token, capped), upserts them, then reads the freshly-updated table
// straight from Supabase. The incremental refresh has its own module-level
// throttle; the full list is never cached in Redis (too large).
export const listWbahCallsLive = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    void refreshWbahLiveData(workspaceId, { lightBackfill: true });
    return cacheWrap(`webee:wbah-calls-live-lite:v1:${workspaceId}`, 180, async () => {
      const rows = await readWbahCallsRows(supabase, workspaceId, { lite: true });
      logWbahResponse("listWbahCallsLive", workspaceId, rows.length, rows);
      return rows;
    });
  });

// Lightweight count for the Calls sub-tab badge — avoids downloading all
// 11k+ call rows (with transcripts) just to show a number on the People page.
export const listWbahCallsCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    return cacheWrap(`webee:wbah-calls-count:${workspaceId}`, 2 * 60, async () => {
      const sb = supabase as any;
      const { count, error } = await sb
        .from("wbah_calls")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return { count: count ?? 0 };
    });
  });

// ── Server-side paginated WBAH Calls ──────────────────────────────────────────
// Returns ONE lightweight page of calls (no transcripts / summaries) so the
// browser never receives the full ~20MB list. Supabase is the source of truth;
// only the small page response is cached in Redis (short TTL, paginated key).

function logWbahResponse(fn: string, workspaceId: string, rows: number, payload: unknown, extra?: Record<string, unknown>) {
  let bytes = 0;
  try { bytes = JSON.stringify(payload)?.length ?? 0; } catch { bytes = 0; }
  console.log(
    `[wbah-response] fn=${fn} workspace_id=${workspaceId} rows=${rows} bytes=${bytes} ` +
    `sizeKB=${(bytes / 1024).toFixed(1)} sizeMB=${(bytes / 1_000_000).toFixed(2)}` +
    (extra ? " " + Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(" ") : ""),
  );
}

// UI status buckets → raw wbah_calls.call_status values.
const WBAH_CALL_STATUS_FILTER: Record<string, string[]> = {
  completed:     ["completed", "ended", "call_analyzed", "analyzed"],
  not_connected: ["no_answer", "not_connected", "voicemail", "voicemail_reached", "missed"],
  need_to_call:  ["need_to_call"],
  failed:        ["failed", "error", "call_failed"],
};

export const listWbahCallsPaged = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      page:      z.coerce.number().int().min(1).default(1),
      pageSize:  z.coerce.number().int().min(1).max(100).default(50),
      search:    z.string().trim().max(120).optional(),
      dateFrom:  z.string().optional(),
      dateTo:    z.string().optional(),
      status:    z.string().optional(),
      sentiment: z.string().optional(),
      refresh:   z.coerce.boolean().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    // Optional live refresh (throttled internally) — only worth doing on the
    // first page of an unfiltered view so opening the tab shows fresh data.
    if (data.refresh && workspaceId === WBAH_WORKSPACE_ID) {
      try {
        const { refreshWbahCallsFromRetell } = await import("./wbah-retell-calls-sync");
        await refreshWbahCallsFromRetell();
      } catch (e: any) {
        console.warn("[wbah-calls-paged] incremental refresh failed:", e?.message ?? e);
      }
    }

    const { page, pageSize, search, dateFrom, dateTo, status, sentiment } = data;
    const filtersHash = Buffer.from(
      JSON.stringify({ q: search ?? "", f: dateFrom ?? "", t: dateTo ?? "", s: status ?? "", se: sentiment ?? "" }),
    ).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);

    const key = `webee:wbah-calls-page:${workspaceId}:p${page}:ps${pageSize}:${filtersHash}`;
    return cacheWrap(key, 60, async () => {
      const sb = supabase as any;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let q = sb
        .from("wbah_calls")
        // transcript is selected only to derive `hasTranscript`; it is NOT
        // returned in the response (fetched on demand via getWbahCallDetail).
        .select(
          "id, customer_name, phone, agent_name, call_status, call_type, sentiment, duration_seconds, started_at, recording_url, transcript, disconnection_reason, end_reason, appointment_date, appointment_time, booking_status, calendly_booking_url, call_count",
          { count: "exact" },
        )
        .eq("workspace_id", workspaceId);

      if (search) q = q.or(`customer_name.ilike.%${search}%,phone.ilike.%${search}%`);
      if (dateFrom) q = q.gte("started_at", dateFrom);
      if (dateTo) q = q.lte("started_at", dateTo);
      if (sentiment && sentiment !== "all") q = q.eq("sentiment", sentiment);
      if (status && status !== "all" && WBAH_CALL_STATUS_FILTER[status]) {
        q = q.in("call_status", WBAH_CALL_STATUS_FILTER[status]);
      }
      q = q.order("started_at", { ascending: false, nullsFirst: false }).range(from, to);

      const { data: rows, count, error } = await q;
      if (error) throw new Error(error.message);

      const mapped = (rows ?? []).map((r: any, i: number) => ({
        id:                  r.id,
        srNo:                from + i + 1,
        name:                r.customer_name ?? null,
        contact:             r.phone ?? null,
        email:               null,
        callType:            r.call_type ?? "outbound",
        callStatus:          r.call_status,
        sentimentAnalysis:   r.sentiment,
        disconnectionReason: r.disconnection_reason,
        appointmentDate:     r.appointment_date ?? null,
        appointmentTime:     r.appointment_time ?? null,
        bookingStatus:       r.booking_status ?? null,
        calendlyBookingUrl:  r.calendly_booking_url ?? null,
        agentName:           r.agent_name ?? null,
        startTimestamp:      r.started_at ? new Date(r.started_at).getTime() : null,
        durationMs:          r.duration_seconds ? r.duration_seconds * 1000 : null,
        recordingUrl:        r.recording_url ?? null,
        endReason:           r.end_reason ?? null,
        hasTranscript:       !!(r.transcript && String(r.transcript).trim()),
      }));

      const result = { rows: mapped, total: count ?? 0, page, pageSize };
      logWbahResponse("listWbahCallsPaged", workspaceId, mapped.length, result, {
        page, pageSize, filters: filtersHash,
      });
      return result;
    });
  });

// ── Contact call history (drill-down) ─────────────────────────────────────────
// All calls for one phone number, newest first (lightweight — transcript loaded
// on demand via getWbahCallDetail). Powers the "N calls" drill-down on the Leads
// and Qualified pages.
export const getWbahContactCallHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ phone: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { data: rows, error } = await (supabase as any)
      .from("wbah_calls")
      .select("id, customer_name, phone, agent_name, call_status, sentiment, duration_seconds, started_at, recording_url, transcript, call_summary, disconnection_reason, end_reason, appointment_date, appointment_time, booking_status")
      .eq("workspace_id", workspaceId)
      .eq("phone", data.phone)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const calls = (rows ?? []).map((r: any) => ({
      id:                  r.id,
      name:                r.customer_name ?? null,
      agentName:           r.agent_name ?? null,
      callStatus:          r.call_status ?? null,
      sentiment:           r.sentiment ?? null,
      durationSeconds:     r.duration_seconds ?? null,
      startedAt:           r.started_at ?? null,
      recordingUrl:        r.recording_url ?? null,
      callSummary:         r.call_summary ?? null,
      disconnectionReason: r.disconnection_reason ?? null,
      endReason:           r.end_reason ?? null,
      appointmentDate:     r.appointment_date ?? null,
      bookingStatus:       r.booking_status ?? null,
      hasTranscript:       !!(r.transcript && String(r.transcript).trim()),
    }));
    return { phone: data.phone, calls };
  });

// ── Single-call detail (full transcript / summary / recording) ────────────────
// Loaded on demand when a user opens a call — never included in the list page.
export const getWbahCallDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { data: row, error } = await sb
      .from("wbah_calls")
      .select("id, transcript, call_summary, recording_url, disconnection_reason, end_reason, sentiment, started_at, duration_seconds")
      .eq("workspace_id", workspaceId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      id:           data.id,
      transcript:   row?.transcript ?? null,
      callSummary:  row?.call_summary ?? null,
      recordingUrl: row?.recording_url ?? null,
    };
  });

// ── Retell helper — get WBAH workspace's Retell API key ───────────────────────

const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";

let _liveRefreshInflight: Promise<void> | null = null;

async function refreshWbahLiveData(
  workspaceId: string,
  opts?: { awaitResult?: boolean; lightBackfill?: boolean },
): Promise<void> {
  if (workspaceId !== WBAH_WORKSPACE_ID) return;

  const run = async () => {
    try {
      const { refreshWbahCallsFromRetell } = await import("./wbah-retell-calls-sync");
      await refreshWbahCallsFromRetell();
    } catch (e: any) {
      console.warn("[wbah-live] retell refresh failed:", e?.message ?? e);
    }
    try {
      const { refreshWbahAppointmentBackfill, syncWbahBookedContactsFromCrm } = await import("./wbah-leads-sync-tick");
      const booked = await syncWbahBookedContactsFromCrm();
      if (booked.rows > 0) {
        const { cacheDel } = await import("@/lib/cache/redis.server");
        await cacheDel(`webee:wbah-calls-aggregate:v3:${workspaceId}`);
      }
      await refreshWbahAppointmentBackfill(
        opts?.lightBackfill ? { maxPages: 3 } : undefined,
      );
    } catch (e: any) {
      console.warn("[wbah-live] appointment backfill failed:", e?.message ?? e);
    }
  };

  if (opts?.awaitResult) {
    return run();
  }

  if (!_liveRefreshInflight) {
    _liveRefreshInflight = run().finally(() => { _liveRefreshInflight = null; });
  }
  void _liveRefreshInflight;
}

async function requireWbahRetellKey(userId: string): Promise<string> {
  if (!userId) throw new Error("Unauthorized");

  // Platform admins bypass workspace membership check
  const admin = await isPlatformAdmin(userId);
  if (!admin) {
    const { data: memberships } = await (supabaseAdmin as any)
      .from("workspace_members")
      .select("workspace_id, workspaces(slug)")
      .eq("user_id", userId);

    const wbahMembership = (memberships ?? []).find(
      (m: any) => m.workspaces?.slug === "webuyanyhouse",
    );
    if (!wbahMembership) {
      throw new Error("Access denied — not a member of the Webuyanyhouse workspace");
    }
  }

  const { data: ws } = await (supabaseAdmin as any)
    .from("workspace_settings")
    .select("retell_workspace_id")
    .eq("workspace_id", WBAH_WORKSPACE_ID)
    .maybeSingle();

  const apiKey = (ws?.retell_workspace_id as string | undefined)?.trim();
  if (!apiKey) {
    throw new Error("Retell not connected for WeeBespoke workspace — add API key in Settings → Providers");
  }
  return apiKey;
}

// ── Call Logs — live from Retell API with cursor pagination ──────────────────

export const getWbahRetellCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      paginationKey: z.string().nullable().default(null),
    }).parse(i ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { retellFetch } = await import("@/lib/providers/retell/client.server");
    const apiKey = await requireWbahRetellKey(context.userId);

    // Fetch agents + calls in parallel
    const [agentList, callRes] = await Promise.all([
      retellFetch<any[]>("/list-agents", null, "GET", apiKey).catch(() => []),
      retellFetch<any>(
        "/v2/list-calls",
        {
          limit: 50,
          sort_order: "descending",
          ...(data.paginationKey ? { pagination_key: data.paginationKey } : {}),
        },
        "POST",
        apiKey,
      ),
    ]);

    const agentNames: Record<string, string> = {};
    for (const a of agentList ?? []) {
      if (a.agent_id) agentNames[a.agent_id] = a.agent_name ?? a.agent_id;
    }

    const calls: any[] = Array.isArray(callRes) ? callRes : (callRes?.calls ?? []);
    const nextPaginationKey: string | null = callRes?.pagination_key ?? null;

    const records = calls.map((c: any) => ({
      id:           String(c.call_id ?? Math.random()),
      agentName:    agentNames[c.agent_id] ?? c.agent_id ?? null,
      from:         c.from_number ?? null,
      to:           c.to_number ?? null,
      type:         c.call_type ?? "phone_call",
      direction:    c.direction ?? (c.call_type === "phone_call" ? "outbound" : "web"),
      lastCalledAt: c.start_timestamp ? new Date(c.start_timestamp).toISOString() : null,
      status:       c.call_status ?? null,
      duration:     formatDurationMs(c.duration_ms),
      recordingUrl: c.recording_url ?? null,
      transcript:   typeof c.transcript === "string" ? c.transcript
                  : Array.isArray(c.transcript)
                    ? c.transcript.map((t: any) => `${t.role}: ${t.content}`).join("\n")
                    : null,
      sentiment:    c.call_analysis?.user_sentiment ?? null,
      callSummary:  c.call_analysis?.call_summary ?? null,
    }));

    return {
      records,
      hasMore:          !!nextPaginationKey,
      nextPaginationKey,
    };
  });

// ── Agents — list Retell agents for WBAH workspace with live status ───────────

export const getWbahRetellAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { retellFetch } = await import("@/lib/providers/retell/client.server");
    const apiKey = await requireWbahRetellKey(context.userId);

    const [agentList, liveRes] = await Promise.all([
      retellFetch<any[]>("/list-agents", null, "GET", apiKey).catch(() => []),
      retellFetch<any>(
        "/v2/list-calls",
        { filter_criteria: { call_status: ["ongoing"] }, limit: 20 },
        "POST",
        apiKey,
      ).catch(() => null),
    ]);

    const liveCallAgentIds = new Set<string>(
      (Array.isArray(liveRes) ? liveRes : (liveRes?.calls ?? []))
        .map((c: any) => c.agent_id)
        .filter(Boolean),
    );

    return (agentList ?? []).map((a: any) => ({
      id:        a.agent_id,
      name:      a.agent_name ?? a.agent_id,
      voiceId:   a.voice_id ?? null,
      isLive:    liveCallAgentIds.has(a.agent_id),
    }));
  });

// ── Reconcile WeBee agents ↔ Retell (WBAH workspace) ──────────────────────────
// Cross-references the WBAH `agents` rows against the live Retell agent list
// (deduped — Retell's /list-agents returns one row per agent version) and, when
// `apply` is set, heals the mismatch non-destructively:
//   • imports Retell agents that are missing from WeBee (so they're selectable)
//   • clears stale `retell_agent_id`s on WeBee agents whose Retell agent no
//     longer exists (prevents calls/deploys firing at a dead agent). The row and
//     its builder `flow_data` are preserved so it can simply be re-deployed.

// Fine-grained dashboard type stored in settings.dashboardAgentType (drives the
// qualification agent picker). The `agent_type` enum column only has coarse
// values ('lead_gen' | 'receptionist').
function inferWbahDashboardType(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("qualif") || n.includes("rebook")) return "client_qualification";
  return "lead_generation";
}

export const reconcileWbahRetellAgents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ apply: z.coerce.boolean().default(false) }),
  )
  .handler(async ({ context, data }) => {
    const { retellFetch } = await import("@/lib/providers/retell/client.server");
    const apiKey = await requireWbahRetellKey(context.userId);
    const isAdmin = await isPlatformAdmin(context.userId);
    if (data.apply && !isAdmin) throw new Error("Admin access required to apply changes");

    // Live Retell agents (dedupe versions by agent_id).
    const agentList = await retellFetch<any[]>("/list-agents", null, "GET", apiKey).catch(() => []);
    const retellById = new Map<string, string>();
    for (const a of agentList ?? []) {
      if (a?.agent_id && !retellById.has(a.agent_id)) retellById.set(a.agent_id, a.agent_name ?? a.agent_id);
    }

    // WeBee agents for the WBAH workspace.
    const { data: dbAgents } = await (supabaseAdmin as any)
      .from("agents")
      .select("id, name, retell_agent_id, agent_type, deployment_mode, settings, created_at")
      .eq("workspace_id", WBAH_WORKSPACE_ID);

    // Ignore already-archived agents when computing the reconciliation.
    const dbRows: any[] = (dbAgents ?? []).filter((a: any) => !(a.settings?.archived));
    const dbRetellIds = new Set(dbRows.map((a) => a.retell_agent_id).filter(Boolean));

    const matched = dbRows
      .filter((a) => a.retell_agent_id && retellById.has(a.retell_agent_id))
      .map((a) => ({ id: a.id, name: a.name, retell_agent_id: a.retell_agent_id }));
    const orphaned = dbRows
      .filter((a) => a.retell_agent_id && !retellById.has(a.retell_agent_id))
      .map((a) => ({ id: a.id, name: a.name, retell_agent_id: a.retell_agent_id }));
    const missing = Array.from(retellById, ([agent_id, name]) => ({ agent_id, name }))
      .filter((m) => !dbRetellIds.has(m.agent_id));

    // Duplicate WeBee rows sharing one retell_agent_id.
    const byRetell = new Map<string, any[]>();
    for (const a of dbRows) {
      if (!a.retell_agent_id) continue;
      const arr = byRetell.get(a.retell_agent_id) ?? [];
      arr.push(a);
      byRetell.set(a.retell_agent_id, arr);
    }
    const duplicates = Array.from(byRetell.values())
      .filter((arr) => arr.length > 1)
      .map((arr) => ({ retell_agent_id: arr[0].retell_agent_id, rows: arr.map((r) => ({ id: r.id, name: r.name })) }));

    const actions = { imported: [] as any[], archivedStale: [] as any[] };

    if (data.apply) {
      // Resolve the WBAH workspace owner as the creator for imported rows.
      const { data: owner } = await (supabaseAdmin as any)
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", WBAH_WORKSPACE_ID)
        .eq("role", "owner")
        .maybeSingle();
      const ownerId = owner?.user_id ?? context.userId;

      for (const m of missing) {
        const dashType = inferWbahDashboardType(m.name);
        const enumType = dashType === "lead_generation" ? "lead_gen" : "receptionist";
        const { data: row, error } = await (supabaseAdmin as any)
          .from("agents")
          .insert({
            user_id: ownerId,
            workspace_id: WBAH_WORKSPACE_ID,
            retell_agent_id: m.agent_id,
            name: m.name,
            agent_type: enumType,
            deployment_mode: "RETELL",
            flow_data: { nodes: [], edges: [] },
            settings: { dashboardAgentType: dashType, isLive: true, liveAt: new Date().toISOString(), importedFromRetell: true },
            variables: {},
          })
          .select("id")
          .maybeSingle();
        if (!error) actions.imported.push({ id: row?.id, name: m.name, retell_agent_id: m.agent_id, agent_type: dashType });
      }

      // Archive orphaned agents whose Retell agent no longer exists — these are
      // the stale "old" agents that otherwise linger on the dashboard. A hard
      // delete cascades ON DELETE SET NULL across many large tables and hits the
      // DB statement timeout, so we soft-archive instead (cheap single-row
      // update). Archived agents are filtered out of every agent listing and
      // their builder flow_data is preserved.
      const orphanRows = dbRows.filter((a) => a.retell_agent_id && !retellById.has(a.retell_agent_id));
      for (const o of orphanRows) {
        const nextSettings = { ...(o.settings ?? {}), isLive: false, archived: true, archivedAt: new Date().toISOString() };
        const { error } = await (supabaseAdmin as any)
          .from("agents")
          .update({ retell_agent_id: null, settings: nextSettings, updated_at: new Date().toISOString() })
          .eq("id", o.id)
          .eq("workspace_id", WBAH_WORKSPACE_ID);
        if (!error) actions.archivedStale.push({ id: o.id, name: o.name, retell_agent_id: o.retell_agent_id });
      }
    }

    return {
      retellAgentCount: retellById.size,
      webeeAgentCount: dbRows.length,
      matched,
      orphaned,
      missing,
      duplicates,
      applied: data.apply,
      actions,
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// WBAH Categorized Lead Sync — server functions
// Tables: wbah_categorized_leads, wbah_category_sync_log
// ─────────────────────────────────────────────────────────────────────────────

const WBAH_CATEGORIES = ["disqualified", "tried_to_contact", "rebooking"] as const;
type WbahCat = typeof WBAH_CATEGORIES[number];

// ── triggerWbahCategorySync ───────────────────────────────────────────────────

export const triggerWbahCategorySync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      category: z.enum(["disqualified", "tried_to_contact", "rebooking", "all"]).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const isAdmin = await isPlatformAdmin(context.userId);
    if (!isAdmin) throw new Error("Admin access required");

    const { runWbahCategorySyncTick } = await import(
      "@/lib/integrations/webespokeEnterprise/wbah-category-sync"
    );

    const categoriesOnly =
      data.category && data.category !== "all"
        ? [data.category as WbahCat]
        : undefined;

    const result = await runWbahCategorySyncTick({ categoriesOnly });

    // Record the outcome for the unified sync-state panel. Best-effort only.
    try {
      const { data: wsRow } = await (supabaseAdmin as any)
        .from("workspaces").select("id").eq("slug", "webuyanyhouse").maybeSingle();
      if (wsRow?.id) {
        const cats = ["disqualified", "tried_to_contact", "rebooking"] as const;
        let created = 0, updated = 0, skipped = 0;
        for (const c of cats) {
          created += Number((result as any)?.[c]?.imported ?? 0);
          updated += Number((result as any)?.[c]?.updated ?? 0);
          skipped += Number((result as any)?.[c]?.skipped ?? 0);
        }
        const errs = Array.isArray((result as any)?.errors) ? (result as any).errors : [];
        const totalTouched = created + updated + skipped;
        const status: "success" | "partial" | "error" =
          errs.length === 0 ? "success" : totalTouched === 0 ? "error" : "partial";
        await recordSyncState({
          workspaceId: wsRow.id,
          sourceName: "webespoke_enterprise",
          module: "people",
          status,
          recordsCreated: created,
          recordsUpdated: updated,
          recordsSkipped: skipped,
          errorMessage: errs.length ? errs.join("; ") : null,
        });
      }
    } catch {
      /* sync-state recording is best-effort */
    }

    return result;
  });

// ── WBAH call-derived categories (Disqualified / Tried To Contact / Rebooking) ─
// All three People sub-tabs are derived live from the rich `wbah_calls` table.
// Every contact who has NOT yet booked an appointment "needs to be called", and
// each such contact is bucketed into exactly ONE category from their latest call
// outcome, so the three tabs are mutually exclusive (no contact appears twice):
//   • disqualified     — reached, but negative sentiment / not a viable lead
//   • tried_to_contact — never actually reached (no answer / voicemail)
//   • rebooking        — reached & warm, or has an appointment / callback to redo
// The `wbah_categorized_leads` table (fed by the call-output endpoint) cannot
// distinguish these reliably, so it is bypassed for WBAH.

type WbahDerivedCat = "disqualified" | "tried_to_contact" | "rebooking";

const WBAH_DERIVED_LABEL: Record<WbahDerivedCat, string> = {
  disqualified:     "Disqualified",
  tried_to_contact: "Tried To Contact",
  rebooking:        "Rebooking",
};

// Per WBAH, every CRM-loaded contact from the People feed (get-all-calldata) is
// treated as Disqualified. The WeeBespoke source dashboard lists them as a single
// People set (Opportunity: 0 across the board), so we mirror that one list instead
// of splitting them across Tried To Contact / Rebooking buckets.
function classifyWbahCrmContact(_r: any): WbahDerivedCat {
  return "disqualified";
}

// The WeeBespoke "Lead Filter Master" tags each loaded CRM contact with a
// `lead_status` (e.g. "Disqualified", "Tried To Contact", "Rebook Initial
// Consultation"). We surface that verbatim so the WeBee People section can split
// the combined feed back into one tab per lead-filter category.
function wbahContactLeadStatus(r: any): string {
  return String(r?.crmData?.lead_status ?? r?.lead_status ?? "").trim() || "Uncategorized";
}

// Slug used to match a category name across the old enum values and the live
// lead_status labels: "Tried To Contact" ⟺ "tried_to_contact", etc.
function wbahCatSlug(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function wbahContactMatchesCategory(c: any, category: string): boolean {
  if (!category || category === "all") return true;
  return wbahCatSlug(c.__leadStatus ?? wbahContactLeadStatus(c)) === wbahCatSlug(category);
}

// Fetch ALL CRM-loaded contacts from the live `get-all-calldata` feed — the only
// WeeBespoke source that carries not-yet-called ("need_to_call") contacts plus a
// per-record CRM load date (`createdAt`). Records are deduped by phone (latest
// load wins), already-booked contacts are dropped, and each survivor is tagged
// with its `__cat`. Cached per-workspace for 60s so the three category tabs and
// their count probes share a single fetch.
// Live fetch of all CRM-loaded contacts from get-all-calldata (14 pages), deduped
// and classified. Throws on failure/empty so the caller can fall back.
async function fetchWbahCrmLoadedContactsLive(userId: string): Promise<any[]> {
  const cbs = await requireWbahCbs(userId);
  const gt  = cbs.getTokens;
  const st  = cbs.saveNewAccessToken;
  const rl  = cbs.reloginFn;

  const extractRecs = (raw: any): any[] =>
    Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];

  const p1Res = await api.wbahGetAllCallDataPaged(1, gt, st, rl);
  if (!p1Res.ok) throw new Error(p1Res.error ?? "Failed to fetch CRM call data from WeeBespoke");

  const p1Raw      = p1Res.data as any;
  const pag        = p1Raw?.pagination ?? {};
  const totalItems = Number(pag.totalItems ?? 0);
  const pageSize   = Number(pag.pageSize ?? 50) || 50;
  const apiPages   = Number(pag.totalPages ?? 1) || 1;
  const totalPages = Math.max(apiPages, totalItems > 0 ? Math.ceil(totalItems / pageSize) : 1);

  const all: any[] = [...extractRecs(p1Raw)];
  for (let page = 2; page <= totalPages; page += 8) {
    const batch = Array.from({ length: Math.min(8, totalPages - page + 1) }, (_, i) => page + i);
    const settled = await Promise.allSettled(batch.map(p => api.wbahGetAllCallDataPaged(p, gt, st, rl)));
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === "fulfilled" && s.value.ok) {
        all.push(...extractRecs(s.value.data as any));
        continue;
      }
      const retry = await api.wbahGetAllCallDataPaged(batch[i], gt, st, rl);
      if (!retry.ok) throw new Error(retry.error ?? `Failed to fetch CRM call data page ${batch[i]}`);
      all.push(...extractRecs(retry.data as any));
    }
  }

  // Dedup by phone, keeping each contact's most-recently-loaded row.
  const byKey = new Map<string, any>();
  for (const r of all) {
    const phone = r.toNumber ?? r.fromNumber ?? r.phone ?? null;
    const key = phone && String(phone).trim()
      ? String(phone).trim()
      : `id:${r.lead_id ?? r.callId ?? r.id}`;
    const ts   = Date.parse(r.createdAt ?? r.created_at ?? "") || 0;
    const prev = byKey.get(key);
    const prevTs = prev ? (Date.parse(prev.createdAt ?? prev.created_at ?? "") || 0) : -1;
    if (!prev || ts >= prevTs) byKey.set(key, r);
  }

  const out: any[] = [];
  for (const r of byKey.values()) {
    if (String(r.booking_status ?? "").toLowerCase() === "success") continue;
    r.__cat = classifyWbahCrmContact(r);
    r.__leadStatus = wbahContactLeadStatus(r);
    out.push(r);
  }
  if (out.length === 0) throw new Error("WeeBespoke returned no CRM contacts (session may have been invalidated)");
  return out;
}

// ── Durable People contacts via Supabase (source of truth) ────────────────────
// The WeeBespoke API allows only ONE active session, so live reads blank the
// People tab whenever the session is invalidated. We persist the CRM-loaded
// contacts into `wbah_crm_contacts` and READ from Supabase; the live WeeBespoke
// feed is only touched by a throttled background sync. A Redis "last-good"
// snapshot remains as a cold-start fallback.

const WBAH_CRM_LASTGOOD_TTL = 24 * 60 * 60; // 24h Redis fallback
const WBAH_CRM_SYNC_TTL_MS  = 5 * 60 * 1000; // refresh from WeeBespoke at most every 5 min
let _wbahCrmSyncAt = 0;
let _wbahCrmSyncInflight: Promise<void> | null = null;

function crmContactToDbRow(c: any, workspaceId: string, syncTime: string) {
  const phone = c.toNumber ?? c.fromNumber ?? c.phone ?? null;
  const dedup = phone && String(phone).trim()
    ? String(phone).trim()
    : `id:${c.lead_id ?? c.callId ?? c.id}`;
  return {
    dedup_key:            dedup,
    workspace_id:         workspaceId,
    external_id:          String(c.lead_id ?? c.callId ?? c.id ?? ""),
    phone,
    name:                 c.name ?? null,
    email:                c.email ?? null,
    lead_status:          c.__leadStatus ?? wbahContactLeadStatus(c),
    call_status:          c.callStatus ?? null,
    sentiment:            c.sentimentAnalysis ?? null,
    disconnection_reason: c.disconnectionReason ?? null,
    end_reason:           c.endReason ?? null,
    agent_name:           c.agentName ?? null,
    duration_ms:          c.durationMs != null ? Number(c.durationMs) : null,
    start_timestamp:      c.startTimestamp != null ? Number(c.startTimestamp) : null,
    recording_url:        c.recordingUrl ?? null,
    transcript:           c.transcript ?? null,
    appointment_date:     c.appointment_date ?? null,
    appointment_time:     c.appointment_time ?? null,
    booking_status:       c.booking_status ?? null,
    calendly_booking_url: c.calendly_booking_url ?? null,
    crm_loaded_at:        c.createdAt ?? c.created_at ?? null,
    synced_at:            syncTime,
  };
}

function dbRowToCrmContact(row: any) {
  return {
    id:                  row.external_id || row.dedup_key,
    callId:              null,
    lead_id:             row.external_id,
    name:                row.name,
    toNumber:            row.phone,
    fromNumber:          null,
    phone:               row.phone,
    email:               row.email,
    callStatus:          row.call_status,
    sentimentAnalysis:   row.sentiment,
    disconnectionReason: row.disconnection_reason,
    endReason:           row.end_reason,
    agentName:           row.agent_name,
    durationMs:          row.duration_ms,
    startTimestamp:      row.start_timestamp,
    recordingUrl:        row.recording_url,
    transcript:          row.transcript,
    appointment_date:    row.appointment_date,
    appointment_time:    row.appointment_time,
    booking_status:      row.booking_status,
    calendly_booking_url: row.calendly_booking_url,
    createdAt:           row.crm_loaded_at,
    created_at:          row.crm_loaded_at,
    __cat:               "disqualified",
    __leadStatus:        row.lead_status || "Uncategorized",
  };
}

// Pull the live feed and replace the workspace's rows in wbah_crm_contacts.
async function syncWbahCrmContactsToDb(userId: string, workspaceId: string): Promise<void> {
  const live = await fetchWbahCrmLoadedContactsLive(userId); // non-booked, deduped; throws on failure/empty
  const syncTime = new Date().toISOString();
  const rows = live.map((c) => crmContactToDbRow(c, workspaceId, syncTime));

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await (supabaseAdmin as any)
      .from("wbah_crm_contacts")
      .upsert(chunk, { onConflict: "workspace_id,dedup_key" });
    if (error) throw new Error(error.message);
  }
  // Prune stale non-booked contacts only. Booked Calendly rows are maintained by
  // syncWbahBookedContactsFromCrm and must not be deleted here.
  await (supabaseAdmin as any)
    .from("wbah_crm_contacts")
    .delete()
    .eq("workspace_id", workspaceId)
    .lt("synced_at", syncTime)
    .or("booking_status.is.null,and(booking_status.neq.success,booking_status.neq.booked,booking_status.neq.confirmed)");

  // Keep the Redis cold-start fallback fresh too.
  await cacheSet(`webee:wbah-crm-contacts-good:${workspaceId}`, WBAH_CRM_LASTGOOD_TTL, live);
  console.log(`[wbah-crm-contacts] synced ${rows.length} contacts to Supabase`);
}

async function readWbahCrmContactsFromDb(workspaceId: string): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await (supabaseAdmin as any)
      .from("wbah_crm_contacts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .neq("booking_status", "success")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all.map(dbRowToCrmContact);
}

// Throttled background refresh (best-effort; non-blocking on warm reads).
function ensureWbahCrmSynced(userId: string, workspaceId: string): void {
  if (Date.now() - _wbahCrmSyncAt < WBAH_CRM_SYNC_TTL_MS) return;
  if (_wbahCrmSyncInflight) return;
  _wbahCrmSyncInflight = (async () => {
    try {
      await syncWbahCrmContactsToDb(userId, workspaceId);
      _wbahCrmSyncAt = Date.now();
    } catch (e: any) {
      console.warn(`[wbah-crm-contacts] background sync failed: ${e?.message}`);
    } finally {
      _wbahCrmSyncInflight = null;
    }
  })();
}

async function getWbahCrmLoadedContacts(userId: string, workspaceId: string): Promise<any[]> {
  let rows = await readWbahCrmContactsFromDb(workspaceId);

  if (rows.length === 0) {
    // Cold start — populate synchronously so the tab has data on first open.
    try {
      await syncWbahCrmContactsToDb(userId, workspaceId);
      _wbahCrmSyncAt = Date.now();
      rows = await readWbahCrmContactsFromDb(workspaceId);
    } catch (e: any) {
      // Live fetch failed on cold start — try the Redis last-good snapshot.
      const lastGood = await cacheGet<any[]>(`webee:wbah-crm-contacts-good:${workspaceId}`);
      if (Array.isArray(lastGood) && lastGood.length > 0) {
        console.warn(`[wbah-crm-contacts] cold start live fetch failed (${e?.message}); serving Redis last-good (${lastGood.length})`);
        return lastGood;
      }
      throw e;
    }
  } else {
    // Warm — refresh from WeeBespoke in the background (throttled, non-blocking).
    ensureWbahCrmSynced(userId, workspaceId);
  }
  return rows;
}

// Returns one category's page of CRM-loaded contacts, mapped to the row shape
// the UI's mapWbahCatRow expects (incl. `crm_loaded_at` for the LOADED column).
async function listWbahCrmLoadedCategory(
  userId: string,
  workspaceId: string,
  category: string,
  page: number,
  limit: number,
  search?: string,
) {
  const contacts = await getWbahCrmLoadedContacts(userId, workspaceId);
  let filtered = contacts.filter((c) => wbahContactMatchesCategory(c, category));

  // Search (name / phone).
  if (search?.trim()) {
    const s = search.trim().toLowerCase();
    filtered = filtered.filter(
      (c) =>
        String(c.name ?? "").toLowerCase().includes(s) ||
        String(c.toNumber ?? c.fromNumber ?? c.phone ?? "").toLowerCase().includes(s),
    );
  }

  const total = filtered.length;
  const start = (page - 1) * limit;
  const pageRows = filtered.slice(start, start + limit);

  const rows = pageRows.map((c) => {
    const phone    = c.toNumber ?? c.fromNumber ?? c.phone ?? null;
    const loadedAt = c.createdAt ?? c.created_at ?? null;
    const leadStatus = c.__leadStatus ?? wbahContactLeadStatus(c);
    const raw = {
      callStatus: c.callStatus ?? null,
      sentimentAnalysis: c.sentimentAnalysis ?? null,
      disconnectionReason: c.disconnectionReason ?? null,
      endReason: c.endReason ?? null,
      appointment_date: c.appointment_date ?? null,
      appointment_time: c.appointment_time ?? null,
      booking_status: c.booking_status ?? null,
      calendly_booking_url: c.calendly_booking_url ?? null,
      agentName: c.agentName ?? null,
      startTimestamp: c.startTimestamp ? String(c.startTimestamp) : null,
      durationMs: c.durationMs ? String(c.durationMs) : null,
      recordingUrl: c.recordingUrl ?? null,
      transcript: c.transcript ?? null,
    };
    return {
      id: String(c.id ?? c.callId ?? c.lead_id ?? phone ?? `${wbahCatSlug(category)}-${start}`),
      external_lead_id: phone ?? c.lead_id ?? c.id,
      external_status_code: c.callStatus ?? leadStatus,
      external_status_label: leadStatus,
      webee_category: leadStatus,
      full_name: c.name ?? "Unknown",
      first_name: null,
      last_name: null,
      phone,
      email: c.email ?? null,
      address: null,
      city: null,
      postcode: null,
      property_type: null,
      meta: {
        raw_lead: raw,
        lead_status: leadStatus,
        appointment_date: c.appointment_date ?? null,
        booking_status: c.booking_status ?? null,
        recording_url: c.recordingUrl ?? null,
        crm_loaded_at: loadedAt,
      },
      last_synced_at: loadedAt ?? new Date().toISOString(),
      created_at: loadedAt ?? new Date().toISOString(),
    };
  });

  return { rows, total, page, limit, category };
}

// Resolve the WBAH workspace id + enforce that the caller can view it. Shared by
// the People category endpoints below.
async function requireWbahView(userId: string): Promise<string> {
  const { data: ws } = await (supabaseAdmin as any)
    .from("workspaces").select("id").eq("slug", "webuyanyhouse").maybeSingle();
  if (!ws?.id) throw new Error("WBAH workspace not found");

  const isAdmin = await isPlatformAdmin(userId);
  if (!isAdmin) {
    const { data: mem } = await (supabaseAdmin as any)
      .from("workspace_members")
      .select("id")
      .eq("user_id", userId)
      .eq("workspace_id", ws.id)
      .maybeSingle();
    if (!mem) throw new Error("Access denied");
  }
  return ws.id as string;
}

// ── listWbahPeopleCategories ──────────────────────────────────────────────────
// Distinct lead-filter categories present in the loaded People feed, with counts.
// Drives the dynamic People sub-tabs so the combined get-all-calldata feed can be
// split back into one tab per WeeBespoke "Lead Filter Master" category.

export const listWbahPeopleCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = await requireWbahView(context.userId);
    const contacts = await getWbahCrmLoadedContacts(context.userId, wsId);
    const counts = new Map<string, number>();
    for (const c of contacts) {
      const name = c.__leadStatus ?? wbahContactLeadStatus(c);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const categories = Array.from(counts, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return { categories, total: contacts.length };
  });

// ── listWbahCategorizedLeads ──────────────────────────────────────────────────

export const listWbahCategorizedLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      // Accepts either the legacy enum slugs (disqualified / tried_to_contact /
      // rebooking) or a live "Lead Filter Master" category name ("Disqualified",
      // "Tried To Contact", …) or "all". Matched via slug so both forms work.
      category: z.string().min(1),
      page:     z.coerce.number().int().min(1).default(1),
      limit:    z.coerce.number().int().min(1).max(200).default(100),
      search:   z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const wsId = await requireWbahView(context.userId);
    const { category, page, limit, search } = data;

    // Categories are derived live from the CRM `get-all-calldata` feed, split by
    // each record's WeeBespoke `lead_status` (the Lead Filter Master category).
    return await listWbahCrmLoadedCategory(context.userId, wsId, category, page, limit, search);
  });

// ── getWbahCategorySyncLog ─────────────────────────────────────────────────────

export const getWbahCategorySyncLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: ws } = await (supabaseAdmin as any)
      .from("workspaces").select("id").eq("slug", "webuyanyhouse").maybeSingle();
    if (!ws?.id) throw new Error("WBAH workspace not found");

    const isAdmin = await isPlatformAdmin(context.userId);
    if (!isAdmin) {
      const { data: mem } = await (supabaseAdmin as any)
        .from("workspace_members")
        .select("id")
        .eq("user_id", context.userId)
        .eq("workspace_id", ws.id)
        .maybeSingle();
      if (!mem) throw new Error("Access denied");
    }

    const logs: Record<string, unknown> = {};
    for (const cat of WBAH_CATEGORIES) {
      const { data: row } = await (supabaseAdmin as any)
        .from("wbah_category_sync_log")
        .select("*")
        .eq("workspace_id", ws.id)
        .eq("category", cat)
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      logs[cat] = row ?? null;
    }
    return logs as Record<WbahCat, {
      id: string; synced_at: string; imported: number; updated: number;
      skipped: number; failed: number; total_records: number; duration_ms: number;
      error_message: string | null;
    } | null>;
  });

// ── getWbahCategorySyncAccess ──────────────────────────────────────────────────
// Lets the UI know whether the current user may trigger a category sync, so the
// admin-only Sync / Sync All controls can be hidden from non-admins. The real
// enforcement still lives in triggerWbahCategorySync (server-side).

export const getWbahCategorySyncAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isAdmin = await isPlatformAdmin(context.userId);
    return { canSync: isAdmin };
  });

// ── WBAH seller leads from DB (synced by wbah-leads-sync plugin) ──────────────
// Reads from the standard `leads` table filtered by source_detail="webespoke_enterprise"
// and excludes CRM contact rows (wbah_source="crm"). This gives the 1568 seller leads.

export const listWbahLeadsForPeople = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    return cacheWrap(`webee:wbah-people-leads:${workspaceId}`, 60, async () => {
    const sb   = supabase as any;
    const PAGE = 1000;
    const all: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from("leads")
        .select("id, full_name, phone, email, created_at, meta, call_summary, callback_date")
        .eq("workspace_id", workspaceId)
        .eq("source", "import")
        .eq("source_detail", "webespoke_enterprise")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows: any[] = data ?? [];
      // exclude CRM contact rows (wbah_source = "crm")
      const sellers = rows.filter((r: any) => r.meta?.wbah_source !== "crm");
      all.push(...sellers);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    console.log(`[WBAH people] leads from DB: ${all.length}`);
    return all.map((r: any, idx: number) => ({
      id:                  r.id,
      srNo:                idx + 1,
      name:                r.full_name,
      contact:             r.phone,
      email:               r.email,
      callType:            "Lead",
      callStatus:          r.meta?.call_status ?? null,
      sentimentAnalysis:   r.meta?.last_call_sentiment ?? null,
      disconnectionReason: r.meta?.disconnection_reason ?? null,
      appointmentDate:     r.meta?.appointment_date ?? null,
      appointmentTime:     r.meta?.appointment_time ?? null,
      bookingStatus:       r.meta?.booking_status ?? null,
      calendlyBookingUrl:  r.meta?.calendly_booking_url ?? null,
      agentName:           r.meta?.agent_name ?? r.meta?.assigned_agent ?? null,
      startTimestamp:      r.meta?.start_timestamp
                             ? Number(r.meta.start_timestamp)
                             : (r.meta?.last_called_at ? new Date(r.meta.last_called_at).getTime() : null),
      durationMs:          r.meta?.duration_ms ? Number(r.meta.duration_ms) : null,
      recordingUrl:        r.meta?.recording_url ?? null,
      transcript:          r.meta?.transcript ?? r.call_summary ?? null,
      endReason:           r.meta?.end_reason ?? null,
    }));
    });
  });

// ── WBAH Positive / Neutral Leads (derived live from wbah_calls) ──────────────
// The "Leads" window shows every contact who has ALREADY been called and whose
// most-recent call came back positive or neutral — one row per contact (their
// latest call), newest first. This mirrors the BeSpoke "Positive/Neutral Leads"
// screen. It is intentionally distinct from the People sub-tabs (which bucket
// the NOT-yet-booked contacts), so a warm, unbooked contact can legitimately
// appear in both this window and the Rebooking tab.

// A neutral call must last longer than this to count as "partial qualified".
const WBAH_PARTIAL_QUALIFIED_MIN_SECONDS = 5 * 60; // 5 minutes

export const listWbahPositiveNeutralLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    void refreshWbahLiveData(workspaceId, { lightBackfill: true });

    const { byPhone, crmBookingByDigits } = await getWbahCallsAggregate(workspaceId);

      const sentRank = (s: string) => (s === "positive" ? 3 : s === "neutral" ? 2 : s === "negative" ? 1 : 0);
      const posNeu: any[] = [];
      for (const calls of byPhone.values()) {
        // Latest-first (rows already ordered, but be explicit).
        calls.sort((a, b) => (Date.parse(b.started_at ?? "") || 0) - (Date.parse(a.started_at ?? "") || 0));
        // Definitive outcome = best sentiment across all the contact's calls.
        let main = calls[0];
        let best = sentRank(String(calls[0].sentiment ?? "").toLowerCase());
        for (const c of calls) {
          const r = sentRank(String(c.sentiment ?? "").toLowerCase());
          if (r > best) { best = r; main = c; } // first (latest) call at the best rank
        }
        const definitive = String(main.sentiment ?? "").toLowerCase();
        if (definitive !== "positive" && definitive !== "neutral") continue;
        main.__callCount = calls.length;
        posNeu.push(main);
      }

      // Transcripts are heavy, so pull them only for the kept contacts, chunked
      // to stay under PostgREST's row cap.
      const transcriptById = new Map<string, string | null>();
      const ids = posNeu.map((c) => c.id).filter(Boolean);
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const { data: trows } = await (supabaseAdmin as any)
          .from("wbah_calls")
          .select("id, transcript")
          .in("id", chunk);
        for (const t of (trows ?? []) as any[]) transcriptById.set(t.id, t.transcript ?? null);
      }

      console.log(`[WBAH leads] positive/neutral called contacts: ${posNeu.length}`);

      return posNeu.map((c) => {
        const phoneKey = phoneDigits(c.phone) || `id:${c.id}`;
        const calls = byPhone.get(phoneKey) ?? [c];
        const bookingCall = findWbahBookingCall(calls);
        const crm = phoneDigits(c.phone) ? crmBookingByDigits.get(phoneDigits(c.phone)) : null;
        const appt = resolveWbahBookingFields(c, bookingCall, crm);
        const startedIso: string | null = c.started_at ?? null;
        const transcript = transcriptById.get(c.id) ?? null;
        const sentiment = String(c.sentiment ?? "").toLowerCase() || null;
        const durationSec = Number(c.duration_seconds ?? 0);
        const partialQualified = sentiment === "neutral" && durationSec > WBAH_PARTIAL_QUALIFIED_MIN_SECONDS;
        return {
          id:                c.id,
          full_name:         c.customer_name ?? "Unknown",
          company_name:      null,
          phone:             c.phone ?? null,
          email:             null,
          sentiment,
          lead_score:        null,
          interest_level:    null,
          status:            null,
          call_summary:      transcript,
          next_action:       null,
          last_contacted_at: startedIso,
          created_at:        startedIso,
          meta: {
            last_called_at:       startedIso,
            call_status:          c.call_status ?? null,
            duration_ms:          c.duration_seconds != null ? Number(c.duration_seconds) * 1000 : null,
            recording_url:        c.recording_url ?? null,
            appointment_date:     appt.appointment_date ?? null,
            appointment_time:     appt.appointment_time ?? null,
            booking_status:       appt.booking_status ?? null,
            end_reason:           c.end_reason ?? null,
            disconnection_reason: c.disconnection_reason ?? null,
            calendly_booking_url: appt.calendly_booking_url ?? null,
            agent_name:           appt.agent_name ?? c.agent_name ?? null,
            partial_qualified:    partialQualified,
            call_count:           c.__callCount ?? 1,
          },
        };
      });
  });

// ── WBAH Qualified Leads (derived live from wbah_calls) ───────────────────────
// Build a digits-normalized phone→agentName map from WBAH's own Retell call log.
// wbah_calls (synced from WeeBespoke) carries NO per-call agent, so agent
// attribution for the Qualified page must come from Retell. Calls are fetched
// newest-first, so the first sighting of a number wins (its latest agent).
// Bounded by page count and by the set of numbers we actually need to resolve.
async function buildWbahAgentPhoneMap(
  apiKey: string,
  neededDigits: Set<string>,
): Promise<Record<string, string>> {
  const { retellFetch } = await import("@/lib/providers/retell/client.server");
  const agentList = await retellFetch<any[]>("/list-agents", null, "GET", apiKey).catch(() => []);
  const agentNames: Record<string, string> = {};
  for (const a of agentList ?? []) {
    if (a.agent_id) agentNames[a.agent_id] = a.agent_name ?? a.agent_id;
  }

  const map: Record<string, string> = {};
  const remaining = new Set(neededDigits);
  const MAX_PAGES = 20;
  let paginationKey: string | null = null;
  for (let page = 0; page < MAX_PAGES && remaining.size > 0; page++) {
    const callRes: any = await retellFetch<any>(
      "/v2/list-calls",
      { limit: 50, sort_order: "descending", ...(paginationKey ? { pagination_key: paginationKey } : {}) },
      "POST",
      apiKey,
    );
    const calls: any[] = Array.isArray(callRes) ? callRes : (callRes?.calls ?? []);
    if (calls.length === 0) break;
    for (const c of calls) {
      const d = String(c.to_number ?? "").replace(/\D/g, "");
      if (!d || d in map) continue;
      const name = agentNames[c.agent_id] ?? (c.agent_id ? String(c.agent_id) : null);
      if (name) {
        map[d] = name;
        remaining.delete(d);
      }
    }
    paginationKey = callRes?.pagination_key ?? null;
    if (!paginationKey) break;
  }
  return map;
}

// Qualified = a contact whose latest call came back positive OR who booked an
// appointment (a non-empty calendly_booking_url on ANY of their calls). Rows are
// deduped per contact (phone), newest-first by started_at, and shaped to the
// /leads table contract so the Qualified page renderer works unchanged. Agent
// name is enriched from Retell (see buildWbahAgentPhoneMap).
export const listWbahQualifiedLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    void refreshWbahLiveData(workspaceId, { lightBackfill: true });

    const { byPhone, crmBookingByDigits } = await getWbahCallsAggregate(workspaceId);

      const latestByPhone = new Map<string, any>();
      const countByPhone = new Map<string, number>();
      const orderKeys: string[] = [];
      for (const [key, calls] of byPhone) {
        const c = calls[0];
        countByPhone.set(key, calls.length);
        latestByPhone.set(key, c);
        orderKeys.push(key);
      }

      const contactBooked = (key: string): boolean => {
        const c = latestByPhone.get(key);
        if (!c) return false;
        const calls = byPhone.get(key) ?? [c];
        const bookingCall = findWbahBookingCall(calls);
        const digits = phoneDigits(c.phone);
        const crm = digits ? crmBookingByDigits.get(digits) : null;
        return isWbahRecordBooked(resolveWbahBookingFields(c, bookingCall, crm));
      };

      const qualifiedKeys = orderKeys.filter((key) => {
        const latest = latestByPhone.get(key);
        const s = String(latest?.sentiment ?? "").toLowerCase();
        return s === "positive" || contactBooked(key);
      });

      const keptIds = qualifiedKeys.map((k) => latestByPhone.get(k)?.id).filter(Boolean);
      const transcriptById = new Map<string, string | null>();
      for (let i = 0; i < keptIds.length; i += 500) {
        const chunk = keptIds.slice(i, i + 500);
        const { data: trows } = await (supabaseAdmin as any)
          .from("wbah_calls")
          .select("id, transcript")
          .in("id", chunk);
        for (const t of (trows ?? []) as any[]) transcriptById.set(t.id, t.transcript ?? null);
      }

      const neededDigits = new Set<string>();
      for (const key of qualifiedKeys) {
        const d = phoneDigits(latestByPhone.get(key)?.phone);
        if (d) neededDigits.add(d);
      }
      let agentByDigits: Record<string, string> = {};
      try {
        if (neededDigits.size > 0) {
          const apiKey = await requireWbahRetellKey(userId);
          agentByDigits = await cacheWrap(
            `webee:wbah-agent-map:${workspaceId}`,
            3600,
            () => buildWbahAgentPhoneMap(apiKey, neededDigits),
          );
        }
      } catch (e: any) {
        console.warn("[wbah-qualified-leads] agent enrichment skipped:", e?.message ?? e);
      }

      console.log(`[WBAH qualified] qualified contacts: ${qualifiedKeys.length}`);
      return qualifiedKeys.map((key) => {
        const c = latestByPhone.get(key);
        const calls = byPhone.get(key) ?? (c ? [c] : []);
        const bookingCall = findWbahBookingCall(calls);
        const digits = phoneDigits(c.phone);
        const crm = digits ? crmBookingByDigits.get(digits) : null;
        const appt = resolveWbahBookingFields(c, bookingCall, crm);
        const startedIso: string | null = c.started_at ?? null;
        const agentName = (digits && agentByDigits[digits]) || appt.agent_name || c.agent_name || null;
        const sentiment = (String(c.sentiment ?? "").toLowerCase() || null);
        const durationSec = c.duration_seconds != null ? Number(c.duration_seconds) : null;
        const partialQualified = sentiment === "neutral" && durationSec != null && durationSec > WBAH_PARTIAL_QUALIFIED_MIN_SECONDS;
        return {
          id:                c.id,
          full_name:         c.customer_name ?? "Unknown",
          company_name:      null,
          phone:             c.phone ?? null,
          email:             null,
          sentiment,
          lead_score:        null,
          interest_level:    null,
          status:            null,
          call_summary:      transcriptById.get(c.id) ?? null,
          next_action:       null,
          last_contacted_at: startedIso,
          created_at:        startedIso,
          meta: {
            last_called_at:       startedIso,
            call_status:          c.call_status ?? null,
            duration_ms:          durationSec != null ? durationSec * 1000 : null,
            recording_url:        c.recording_url ?? null,
            appointment_date:     appt.appointment_date ?? null,
            appointment_time:     appt.appointment_time ?? null,
            booking_status:       appt.booking_status ?? null,
            end_reason:           c.end_reason ?? null,
            disconnection_reason: c.disconnection_reason ?? null,
            calendly_booking_url: appt.calendly_booking_url ?? null,
            agent_name:           agentName,
            partial_qualified:    partialQualified,
            call_count:           countByPhone.get(key) ?? 1,
          },
        };
      });
  });

// ── Disqualified leads from WeeBespoke API (filter master UUID approach) ───────
// Fetches leads tagged as "Disqualified" in the WeeBespoke AI app using the
// filter master UUID returned by /leadfiltermaster/get-leadfiltermaster.

export const listWbahDisqualifiedFromApi = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
    const gt  = cbs.getTokens;
    const st  = cbs.saveNewAccessToken;

    const DISQ_UUID  = "6c113950-a5ae-461d-90b1-a187ee173673";
    const DISQ_LABEL = "Disqualified";

    const allRecs: any[] = [];
    for (const code of [DISQ_UUID, DISQ_LABEL]) {
      try {
        const res = await api.wbahGetLeadsFiltered(code, 1, gt, st);
        if (!res.ok) continue;
        const raw  = res.data as any;
        const recs = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
        if (recs.length === 0) continue;
        allRecs.push(...recs);
        const pag        = raw?.pagination;
        const totalItems = pag?.totalItems ?? pag?.total_count ?? 0;
        const pageSize   = pag?.pageSize ?? pag?.page_size ?? 50;
        const totalPages = totalItems > 0 ? Math.ceil(totalItems / pageSize) : 1;
        for (let p = 2; p <= Math.min(totalPages, 100); p++) {
          const pr = await api.wbahGetLeadsFiltered(code, p, gt, st);
          if (pr.ok) {
            const pr_recs = Array.isArray((pr.data as any)?.data) ? (pr.data as any).data : [];
            allRecs.push(...pr_recs);
          }
        }
        console.log(`[WBAH disqualified] fetched ${allRecs.length} leads via code="${code}"`);
        break;
      } catch (e: any) {
        console.warn(`[WBAH disqualified] code="${code}" failed: ${e?.message}`);
      }
    }
    console.log(`[WBAH disqualified] total: ${allRecs.length}`);
    return allRecs.map((r: any, idx: number) => ({
      id:                  String(r.id ?? r._id ?? `dq-${idx}`),
      srNo:                idx + 1,
      name:                r.name ?? r.fullName ?? null,
      contact:             r.toNumber ?? r.fromNumber ?? r.phone ?? null,
      email:               r.email ?? null,
      callType:            "Disqualified",
      callStatus:          r.callStatus ?? null,
      sentimentAnalysis:   r.sentimentAnalysis ?? null,
      disconnectionReason: r.disconnectionReason ?? null,
      appointmentDate:     r.appointment_date ?? null,
      appointmentTime:     r.appointment_time ?? null,
      bookingStatus:       r.booking_status ?? null,
      calendlyBookingUrl:  r.calendly_booking_url ?? null,
      agentName:           r.agentName ?? null,
      startTimestamp:      r.startTimestamp ? Number(r.startTimestamp) : null,
      durationMs:          r.durationMs ? Number(r.durationMs) : null,
      recordingUrl:        r.recordingUrl ?? null,
      transcript:          r.transcript ?? null,
      endReason:           r.endReason ?? null,
    }));
  });
