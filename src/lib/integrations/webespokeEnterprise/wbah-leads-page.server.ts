/**
 * WBAH Leads page data — server only.
 *
 * Kept out of wbah-workspace.server.ts on purpose: client pages import that file for its server
 * functions, and the build strips only server-function bodies from the browser bundle. Plain
 * functions there pulled the calls aggregate (and node:crypto) into every page. Import this file
 * only from inside server-function handlers.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { findWbahBookingCall, phoneDigits, resolveWbahBookingFields } from "@/lib/dashboard/wbah-booking-meta";
import { getWbahCallsAggregate } from "./wbah-leads.server";
import { WBAH_PARTIAL_QUALIFIED_MIN_SECONDS } from "./wbah-workspace.server";

/**
 * WBAH Leads window: one row per already-called contact whose best call was positive or neutral.
 * Built from the cached calls aggregate and memoised on it, so paging through the Leads page does
 * not rebuild it. Rows carry no summary or transcript flag — see attachWbahLeadCallText.
 */
const _posNeuMemo = new WeakMap<object, any[]>();

export async function buildWbahPositiveNeutralLeadRows(workspaceId: string): Promise<any[]> {
  const aggregate = await getWbahCallsAggregate(workspaceId);
  const memoKey = aggregate.all as object;
  const hit = _posNeuMemo.get(memoKey);
  if (hit) return hit;
  const { byPhone, crmBookingByDigits } = aggregate;

    const sentRank = (s: string) =>
      s === "positive" ? 3 : s === "neutral" ? 2 : s === "negative" ? 1 : 0;
    const posNeu: any[] = [];
    for (const calls of byPhone.values()) {
      // Latest-first (rows already ordered, but be explicit).
      calls.sort(
        (a, b) => (Date.parse(b.started_at ?? "") || 0) - (Date.parse(a.started_at ?? "") || 0),
      );
      // Definitive outcome = best sentiment across all the contact's calls.
      let main = calls[0];
      let best = sentRank(String(calls[0].sentiment ?? "").toLowerCase());
      for (const c of calls) {
        const r = sentRank(String(c.sentiment ?? "").toLowerCase());
        if (r > best) {
          best = r;
          main = c;
        } // first (latest) call at the best rank
      }
      const definitive = String(main.sentiment ?? "").toLowerCase();
      if (definitive !== "positive" && definitive !== "neutral") continue;
      main.__callCount = calls.length;
      posNeu.push(main);
    }

  const rows = (() => {
    return posNeu.map((c) => {
      const phoneKey = phoneDigits(c.phone) || `id:${c.id}`;
      const calls = byPhone.get(phoneKey) ?? [c];
      const bookingCall = findWbahBookingCall(calls);
      const crm = phoneDigits(c.phone) ? crmBookingByDigits.get(phoneDigits(c.phone)) : null;
      const appt = resolveWbahBookingFields(c, bookingCall, crm);
      const startedIso: string | null = c.started_at ?? null;
      const sentiment = String(c.sentiment ?? "").toLowerCase() || null;
      const durationSec = Number(c.duration_seconds ?? 0);
      const partialQualified =
        sentiment === "neutral" && durationSec > WBAH_PARTIAL_QUALIFIED_MIN_SECONDS;
      return {
        id: c.id,
        full_name: c.customer_name ?? "Unknown",
        company_name: null,
        phone: c.phone ?? null,
        email: null,
        sentiment,
        lead_score: null,
        interest_level: null,
        status: null,
        call_summary: null as string | null,
        next_action: null,
        last_contacted_at: startedIso,
        created_at: startedIso,
        meta: {
          last_called_at: startedIso,
          call_status: c.call_status ?? null,
          duration_ms: c.duration_seconds != null ? Number(c.duration_seconds) * 1000 : null,
          recording_url: c.recording_url ?? null,
          appointment_date: appt.appointment_date ?? null,
          appointment_time: appt.appointment_time ?? null,
          booking_status: appt.booking_status ?? null,
          end_reason: c.end_reason ?? null,
          disconnection_reason: c.disconnection_reason ?? null,
          calendly_booking_url: appt.calendly_booking_url ?? null,
          agent_name: appt.agent_name ?? c.agent_name ?? null,
          partial_qualified: partialQualified,
          call_count: c.__callCount ?? 1,
          has_transcript: false,
        },
      };
    });
  })();
  _posNeuMemo.set(memoKey, rows);
  return rows;
}

/**
 * Summary and "has transcript" for the given rows only. Transcripts are heavy; this used to run for
 * every positive/neutral contact (~7,000) on each open, chunked to stay under PostgREST's row cap.
 */
export async function attachWbahLeadCallText<T extends { id: string; call_summary?: string | null; meta?: any }>(
  rows: T[],
): Promise<T[]> {
  const summaryById = new Map<string, string | null>();
  const hasTranscriptById = new Map<string, boolean>();
  const ids = rows.map((c) => c.id).filter(Boolean);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data: trows } = await (supabaseAdmin as any)
      .from("wbah_calls")
      .select("id, transcript, call_summary")
      .in("id", chunk);
    for (const t of (trows ?? []) as any[]) {
      const summary =
        t.call_summary && String(t.call_summary).trim() ? String(t.call_summary).trim() : null;
      summaryById.set(t.id, summary);
      hasTranscriptById.set(t.id, !!(t.transcript && String(t.transcript).trim()));
    }
  }
  return rows.map((r) => ({
    ...r,
    call_summary: summaryById.get(r.id) ?? null,
    meta: { ...(r.meta ?? {}), has_transcript: hasTranscriptById.get(r.id) ?? false },
  }));
}

