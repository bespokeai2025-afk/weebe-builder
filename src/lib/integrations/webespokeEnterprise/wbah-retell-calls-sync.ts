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
const RETELL_BASE = "https://api.retellai.com";

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

async function retellPost(path: string, apiKey: string, body: unknown): Promise<any> {
  const res = await fetch(`${RETELL_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Retell ${path} → ${res.status}`);
  return res.json();
}

async function retellGet(path: string, apiKey: string): Promise<any> {
  const res = await fetch(`${RETELL_BASE}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`Retell ${path} → ${res.status}`);
  return res.json();
}

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
    meta: {
      source:          "retell",
      call_successful: c.call_analysis?.call_successful ?? null,
      in_voicemail:    c.call_analysis?.in_voicemail ?? null,
      lead_id:         dv.lead_id ?? null,
      agent_id:        c.agent_id ?? null,
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

async function upsertRows(sb: Sb, rows: any[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await (sb as any).from("wbah_calls").upsert(rows.slice(i, i + 200), { onConflict: "id" });
    if (error) console.error("[wbah-retell-calls] upsert error:", error.message);
  }
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
    const { workspaceId, apiKey } = conn;

    // agent_id → name (list-agents returns one row per version; dedupe).
    const agentNames: Record<string, string> = {};
    try {
      const agents = await retellGet("/list-agents", apiKey);
      for (const a of (Array.isArray(agents) ? agents : []) as any[]) {
        if (a.agent_id && !agentNames[a.agent_id]) agentNames[a.agent_id] = a.agent_name ?? a.agent_id;
      }
    } catch { /* non-fatal */ }

    let synced = 0;
    let pages = 0;
    let caughtUp = false;
    let paginationKey: string | null = null;
    const PAGE = 1000;

    for (; pages < maxPages; pages++) {
      let res: any;
      try {
        res = await retellPost("/v2/list-calls", apiKey, {
          limit: PAGE,
          sort_order: "descending",
          ...(paginationKey ? { pagination_key: paginationKey } : {}),
        });
      } catch (e: any) {
        console.warn(`[wbah-retell-calls] list-calls page ${pages + 1} failed: ${e?.message}`);
        break;
      }
      const calls: any[] = Array.isArray(res) ? res : (res?.calls ?? []);
      if (calls.length === 0) { caughtUp = true; break; }

      const rows = calls
        .map((c) => {
          const row = buildRetellCallRow(c, workspaceId);
          if (row && !row.agent_name && c.agent_id && agentNames[c.agent_id]) row.agent_name = agentNames[c.agent_id];
          return row;
        })
        .filter(Boolean) as any[];

      // Incremental: stop once every id on this page is already stored.
      if (!full && rows.length > 0) {
        const ids = rows.map((r) => r.id);
        const { data: existing } = await (sb as any)
          .from("wbah_calls").select("id").eq("workspace_id", workspaceId).in("id", ids);
        const known = new Set(((existing ?? []) as any[]).map((e) => String(e.id)));
        await upsertRows(sb, rows);
        synced += rows.length;
        if (pages >= 1 && ids.every((id) => known.has(id))) { caughtUp = true; break; }
      } else {
        await upsertRows(sb, rows);
        synced += rows.length;
      }

      // Retell v2 paginates by passing the LAST call_id as pagination_key.
      if (calls.length < PAGE) { caughtUp = true; break; }
      paginationKey = calls[calls.length - 1]?.call_id ?? null;
      if (!paginationKey) { caughtUp = true; break; }
    }

    _lastRunAt = Date.now();
    console.log(`[wbah-retell-calls] synced=${synced} pages=${pages} caughtUp=${caughtUp} full=${full}`);
    return { synced, pages, caughtUp };
  })();

  if (!full) _inFlight = run;
  try {
    return await run;
  } finally {
    if (!full) _inFlight = null;
  }
}
