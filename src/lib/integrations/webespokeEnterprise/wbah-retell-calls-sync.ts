/**
 * WBAH Retell Calls Sync — pulls calls directly from the WBAH Retell workspace
 * (the source of truth for real durations, sentiment and outcomes) and upserts
 * them into `wbah_calls`. Retell is reliable (no single-session limit like
 * WeeBespoke), which fixes both the coverage gaps and the wrong-duration problem.
 *
 * Self-contained (no @/ aliases) so it can be imported anywhere, including the
 * dev Vite plugins.
 */
import { createClient } from "@supabase/supabase-js";

const WBAH_SLUG = "webuyanyhouse";

function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

type Sb = ReturnType<typeof getAdminClient>;

// Concurrency guard + throttle so overlapping opens don't run duplicate syncs.
let _inFlight: Promise<{ synced: number; pages: number; caughtUp: boolean }> | null = null;
let _lastRunAt = 0;
const MIN_INTERVAL_MS = 60 * 1000;

function normStatus(rawStatus: string, durationMs: number): string {
  const s = (rawStatus ?? "").toLowerCase();
  if (s === "ended") return durationMs > 0 ? "completed" : "no_answer";
  if (s === "error") return "failed";
  if (s === "ongoing") return "ongoing";
  return "no_answer"; // registered / not_connected / unknown
}

function normSentiment(v: unknown): string | null {
  const s = String(v ?? "").toLowerCase();
  if (/positive/.test(s)) return "positive";
  if (/negative/.test(s)) return "negative";
  if (/neutral/.test(s)) return "neutral";
  return null;
}

function buildRetellCallRow(c: any, workspaceId: string) {
  const callId = c?.call_id;
  if (!callId) return null;
  const dv = c.retell_llm_dynamic_variables ?? c.collected_dynamic_variables ?? {};
  const durationMs = Number(c.duration_ms ?? 0);
  const rawStatus = String(c.call_status ?? "");
  const startedAt = c.start_timestamp ? new Date(Number(c.start_timestamp)).toISOString() : null;

  const name =
    dv.name ??
    [dv.first_name, dv.last_name].filter(Boolean).join(" ").trim() ??
    null;

  const transcript =
    typeof c.transcript === "string" && c.transcript.trim()
      ? c.transcript
      : Array.isArray(c.transcript_object)
        ? c.transcript_object.map((t: any) => `${t.role}: ${t.content}`).join("\n")
        : null;

  return {
    id:                   String(callId),
    workspace_id:         workspaceId,
    customer_name:        name || null,
    phone:                c.to_number ?? c.from_number ?? dv.mobile ?? null,
    agent_name:           c.agent_name ?? null,
    call_status:          normStatus(rawStatus, durationMs),
    call_type:            c.direction === "inbound" ? "inbound" : "outbound",
    sentiment:            normSentiment(c.call_analysis?.user_sentiment),
    duration_seconds:     durationMs > 0 ? Math.round(durationMs / 1000) : (rawStatus.toLowerCase() === "ended" ? 0 : null),
    started_at:           startedAt,
    recording_url:        c.recording_url ?? null,
    transcript,
    call_summary:         c.call_analysis?.call_summary ?? null,
    disconnection_reason: c.disconnection_reason ?? null,
    end_reason:           c.disconnection_reason ?? null,
    appointment_date:     null,
    appointment_time:     null,
    booking_status:       null,
    calendly_booking_url: null,
    call_count:           1,
    // Verified attribution columns — provider call id is authoritative here;
    // campaign_id is stamped separately by the campaign-run tracker (never
    // overwritten by this upsert since it isn't in the supplied columns).
    provider_call_id:     String(callId),
    lead_id:              dv.lead_id != null ? String(dv.lead_id) : null,
    meta: {
      source:          "retell",
      // Actual provider-recorded cost (Retell call_cost.combined_cost, USD
      // cents) and raw duration — used for provider cost/duration recon.
      cost_usd_cents:  typeof c.call_cost?.combined_cost === "number" ? c.call_cost.combined_cost : null,
      duration_ms:     Number.isFinite(Number(c.duration_ms)) ? Number(c.duration_ms) : null,
      call_successful: c.call_analysis?.call_successful ?? null,
      in_voicemail:    c.call_analysis?.in_voicemail ?? null,
      lead_id:         dv.lead_id ?? null,
      agent_id:        c.agent_id ?? null,
      custom_analysis: c.call_analysis?.custom_analysis_data ?? null,
      dynamic_variables: dv,
    },
    synced_at:            new Date().toISOString(),
  };
}

async function getWbahRetellKey(sb: Sb): Promise<{ workspaceId: string; apiKey: string } | null> {
  const { data: ws } = await (sb as any).from("workspaces").select("id").eq("slug", WBAH_SLUG).maybeSingle();
  if (!ws?.id) return null;
  const { data: settings } = await (sb as any)
    .from("workspace_settings").select("retell_workspace_id").eq("workspace_id", ws.id).maybeSingle();
  const apiKey = (settings?.retell_workspace_id as string | undefined)?.trim();
  if (!apiKey || !apiKey.startsWith("key_")) return null;
  return { workspaceId: ws.id as string, apiKey };
}

async function syncRetellAccountPages(input: {
  sb: Sb;
  workspaceId: string;
  apiKey: string;
  full: boolean;
  maxPages: number;
}): Promise<{ synced: number; pages: number; caughtUp: boolean; enrichCandidates: string[] }> {
  const { sb, workspaceId, apiKey, full, maxPages } = input;
  const { listRetellCallsPage, listRetellAgents } = await import("@/lib/providers/retell/list.server");

  const agentNames: Record<string, string> = {};
  try {
    const agents = await listRetellAgents(apiKey);
    for (const a of (Array.isArray(agents) ? agents : []) as any[]) {
      if (a.agent_id && !agentNames[a.agent_id]) agentNames[a.agent_id] = a.agent_name ?? a.agent_id;
    }
  } catch {
    /* non-fatal */
  }

  let synced = 0;
  let pages = 0;
  let caughtUp = false;
  const enrichCandidates: string[] = [];
  let paginationKey: string | undefined;
  const PAGE = 1000;

  for (; pages < maxPages; pages++) {
    let res: Awaited<ReturnType<typeof listRetellCallsPage>>;
    try {
      res = await listRetellCallsPage(
        {
          limit: PAGE,
          sort_order: "descending",
          ...(paginationKey ? { pagination_key: paginationKey } : {}),
        },
        apiKey,
      );
    } catch (e: any) {
      console.error(`[wbah-retell-calls] v3/list-calls page ${pages + 1} failed: ${e?.message}`);
      throw new Error(`Retell v3/list-calls page ${pages + 1} failed: ${e?.message ?? e}`);
    }
    const calls: any[] = res.items;
    if (calls.length === 0) {
      caughtUp = true;
      break;
    }

    const rows = calls
      .map((c) => {
        const row = buildRetellCallRow(c, workspaceId);
        if (row && !row.agent_name && c.agent_id && agentNames[c.agent_id]) {
          row.agent_name = agentNames[c.agent_id];
        }
        return row;
      })
      .filter(Boolean) as any[];

    for (const r of rows) {
      if (r.call_status !== "ongoing") enrichCandidates.push(String(r.id));
    }

    if (!full && rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const { data: existing } = await (sb as any)
        .from("wbah_calls")
        .select("id")
        .eq("workspace_id", workspaceId)
        .in("id", ids);
      const known = new Set(((existing ?? []) as any[]).map((e) => String(e.id)));
      await upsertRows(sb, rows);
      synced += rows.length;
      if (pages >= 1 && ids.every((id) => known.has(id))) {
        caughtUp = true;
        break;
      }
    } else {
      await upsertRows(sb, rows);
      synced += rows.length;
    }

    if (!res.hasMore || !res.paginationKey) {
      caughtUp = true;
      break;
    }
    paginationKey = res.paginationKey;
  }

  return { synced, pages, caughtUp, enrichCandidates };
}

// transcript is preserved too: Retell's v3/list-calls (July 2026) no longer
// returns transcript/transcript_object, so re-upserts would otherwise wipe
// transcripts previously fetched via GET /v2/get-call.
const BOOKING_PRESERVE = ["appointment_date", "appointment_time", "booking_status", "calendly_booking_url", "transcript"] as const;

async function upsertRows(sb: Sb, rows: any[]): Promise<void> {
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  const { data: existing } = await (sb as any)
    .from("wbah_calls")
    .select("id, appointment_date, appointment_time, booking_status, calendly_booking_url, transcript")
    .eq("workspace_id", rows[0].workspace_id)
    .in("id", ids);
  const byId = new Map<string, any>(((existing ?? []) as any[]).map((e) => [String(e.id), e]));

  const merged = rows.map((row) => {
    const prev = byId.get(String(row.id));
    if (!prev) return row;
    const out = { ...row };
    for (const f of BOOKING_PRESERVE) {
      const next = out[f];
      const kept = prev[f];
      if ((next == null || String(next).trim() === "") && kept != null && String(kept).trim() !== "") {
        out[f] = kept;
      }
    }
    return out;
  });

  for (let i = 0; i < merged.length; i += 200) {
    const { error } = await (sb as any).from("wbah_calls").upsert(merged.slice(i, i + 200), { onConflict: "id" });
    if (error) console.error("[wbah-retell-calls] upsert error:", error.message);
  }
}

/**
 * Retell's v3/list-calls stopped returning transcript/transcript_object
 * (July 2026 list-API migration) — transcripts are only available per-call via
 * GET /v2/get-call. Enrich stored rows that are missing transcripts.
 * Bounded (maxCalls) and gently paced so incremental syncs stay fast.
 */
async function enrichMissingTranscripts(
  sb: Sb,
  apiKey: string,
  workspaceId: string,
  candidateIds: string[],
  maxCalls: number,
): Promise<number> {
  if (candidateIds.length === 0 || maxCalls <= 0) return 0;
  const uniqueIds = [...new Set(candidateIds)];

  // Only fetch for rows still missing a transcript (batched .in() reads).
  const missing: string[] = [];
  for (let i = 0; i < uniqueIds.length && missing.length < maxCalls; i += 200) {
    const batch = uniqueIds.slice(i, i + 200);
    const { data } = await (sb as any)
      .from("wbah_calls")
      .select("id, transcript")
      .eq("workspace_id", workspaceId)
      .in("id", batch);
    for (const r of (data ?? []) as any[]) {
      if (r.transcript == null || String(r.transcript).trim() === "") missing.push(String(r.id));
      if (missing.length >= maxCalls) break;
    }
  }
  if (missing.length === 0) return 0;

  let enriched = 0;
  const failures: Record<string, number> = {};
  const bumpFail = (k: string) => { failures[k] = (failures[k] ?? 0) + 1; };
  const CONCURRENCY = 4;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const batch = missing.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (callId) => {
      try {
        let res = await fetch(`https://api.retellai.com/v2/get-call/${callId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 2000));
          res = await fetch(`https://api.retellai.com/v2/get-call/${callId}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
        }
        if (!res.ok) { bumpFail(res.status === 429 ? "429" : res.status >= 500 ? "5xx" : "4xx"); return; }
        const c: any = await res.json();
        const transcript =
          typeof c.transcript === "string" && c.transcript.trim()
            ? c.transcript
            : Array.isArray(c.transcript_object)
              ? c.transcript_object.map((t: any) => `${t.role}: ${t.content}`).join("\n")
              : null;
        if (!transcript) return;
        const { error } = await (sb as any)
          .from("wbah_calls")
          .update({ transcript })
          .eq("workspace_id", workspaceId)
          .eq("id", callId);
        if (error) bumpFail("db"); else enriched++;
      } catch (e: any) {
        bumpFail("exception");
        console.warn(`[wbah-retell-calls] transcript enrich failed for ${callId}: ${e?.message}`);
      }
    }));
    if (i + CONCURRENCY < missing.length) await new Promise((r) => setTimeout(r, 150));
  }
  if (Object.keys(failures).length > 0) {
    console.warn(`[wbah-retell-calls] transcript enrich failures: ${JSON.stringify(failures)} (attempted=${missing.length}, enriched=${enriched})`);
  }
  return enriched;
}

/**
 * Sync calls from Retell into wbah_calls.
 * @param opts.full  full backfill (walk all pages); otherwise incremental (stop
 *                   once a page is fully known, after a couple of pages).
 * @param opts.maxPages safety cap.
 */
export async function refreshWbahCallsFromRetell(opts?: { full?: boolean; maxPages?: number }): Promise<{ synced: number; pages: number; caughtUp: boolean }> {
  const full = opts?.full ?? false;
  const maxPages = opts?.maxPages ?? (full ? 60 : 6);

  if (!full) {
    if (_inFlight) return _inFlight;
    if (Date.now() - _lastRunAt < MIN_INTERVAL_MS) return { synced: 0, pages: 0, caughtUp: true };
  }

  const run = (async () => {
    const sb = getAdminClient();
    const conn = await getWbahRetellKey(sb);
    if (!conn) return { synced: 0, pages: 0, caughtUp: false };

    const { getWbahRetellApiKeysForSync } = await import(
      "@/lib/wbah/post-call/wbah-retell-agents.shared"
    );
    const apiKeys = getWbahRetellApiKeysForSync(conn.apiKey);
    if (apiKeys.length === 0) return { synced: 0, pages: 0, caughtUp: false };

    let synced = 0;
    let pages = 0;
    let caughtUp = true;
    const enrichCandidates: string[] = [];

    for (const apiKey of apiKeys) {
      try {
        const result = await syncRetellAccountPages({
          sb,
          workspaceId: conn.workspaceId,
          apiKey,
          full,
          maxPages,
        });
        synced += result.synced;
        pages += result.pages;
        caughtUp = caughtUp && result.caughtUp;
        enrichCandidates.push(...result.enrichCandidates);
      } catch (e: any) {
        console.warn(`[wbah-retell-calls] sync skipped for key …${apiKey.slice(-6)}: ${e?.message ?? e}`);
      }
    }

    _lastRunAt = Date.now();

    let enriched = 0;
    const enrichKey = apiKeys[0];
    try {
      enriched = await enrichMissingTranscripts(
        sb,
        enrichKey,
        conn.workspaceId,
        enrichCandidates,
        full ? 2000 : 300,
      );
      if (apiKeys.length > 1) {
        for (const apiKey of apiKeys.slice(1)) {
          enriched += await enrichMissingTranscripts(
            sb,
            apiKey,
            conn.workspaceId,
            enrichCandidates,
            full ? 2000 : 300,
          );
        }
      }
    } catch (e: any) {
      console.warn(`[wbah-retell-calls] transcript enrichment pass failed: ${e?.message}`);
    }

    console.log(
      `[wbah-retell-calls] synced=${synced} pages=${pages} caughtUp=${caughtUp} full=${full} accounts=${apiKeys.length} transcriptsEnriched=${enriched}`,
    );
    return { synced, pages, caughtUp };
  })();

  if (!full) _inFlight = run;
  try {
    return await run;
  } finally {
    if (!full) _inFlight = null;
  }
}
