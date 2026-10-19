/**
 * WBAH Calls page server functions: the server-side paged list + KPI summary, the legacy paged
 * list and count, a contact's call history and single-call detail. Split out of
 * wbah-workspace.server.ts (which re-exports these so existing imports keep working).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  enrichWbahCallRowsWithBookings,
  loadWbahCrmBookingByDigits,
  phoneDigits,
  resolveWbahBookingFields,
  sanitizeWbahBookingFields,
} from "@/lib/dashboard/wbah-booking-meta";
import { cacheWrap } from "@/lib/cache/redis.server";
import { requireActiveWbahWorkspace } from "@/lib/wbah-exclusion.shared";
import { jsonResult } from "@/lib/server-fn-json.shared";
import { WBAH_WORKSPACE_ID, refreshWbahLiveData, requireWbahRetellKey } from "./wbah-live.server";

/** One wbah_calls row → the Calls-table row shape (shared by the full list and the paged list). */
function mapWbahCallRow(r: any, lite: boolean) {
  return {
    id: r.id,
    agent_id: null,
    agent_name: r.agent_name,
    call_status: r.call_status,
    call_type: r.call_type ?? "outbound",
    duration_seconds: r.duration_seconds,
    started_at: r.started_at,
    ended_at: null,
    recording_url: r.recording_url,
    // In lite mode the transcript text is dropped from the payload; the client
    // fetches it on demand. `hasTranscript` still drives the "View" button.
    transcript: lite ? null : r.transcript,
    hasTranscript:
      r.has_transcript === true ||
      !!(r.transcript && String(r.transcript).trim()) ||
      (String(r.id).startsWith("call_") && r.call_status !== "ongoing"),
    call_summary: lite
      ? r.call_summary && String(r.call_summary).trim()
        ? String(r.call_summary).trim()
        : null
      : r.call_summary,
    from_number: r.call_type === "inbound" ? r.phone : null,
    to_number: r.call_type === "outbound" ? r.phone : null,
    sentiment: r.sentiment,
    disconnection_reason: r.disconnection_reason,
    cost_cents: null,
    retell_call_id: null,
    lead: r.customer_name ? { id: r.id, full_name: r.customer_name, phone: r.phone ?? "" } : null,
    wbah_name: r.customer_name,
    wbah_contact: r.phone,
    phone: r.phone,
    appointment_date: r.appointment_date,
    appointment_time: r.appointment_time,
    booking_status: r.booking_status,
    calendly_booking_url: r.calendly_booking_url,
    end_reason: r.end_reason,
    call_count: r.call_count ?? 1,
  };
}

// ── Calls page: server-side pages + KPI summary ──────────────────────────────
// The Calls page used to download every call (~138k rows) and filter / count / page in the
// browser. wbah_calls_page() and wbah_calls_summary() (migration 20261017070000) do that in the
// database; filter semantics match the old client-side code.

const WbahCallsPageFilters = z.object({
  voicemail: z.enum(["exclude", "all", "only"]).default("exclude"),
  search: z.string().trim().max(120).optional(),
  status: z.string().max(40).optional(),
  callType: z.string().max(20).optional(),
  sentiment: z.string().max(20).optional(),
  agentName: z.string().max(200).optional(),
  minDuration: z.coerce.number().int().min(0).max(86_400).optional(),
  outcome: z.enum(["", "successful", "unsuccessful"]).optional(),
  dateFrom: z.string().max(40).optional(),
  dateTo: z.string().max(40).optional(),
});
export type WbahCallsPageFiltersInput = z.input<typeof WbahCallsPageFilters>;

export const listWbahCallsPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
      filters: WbahCallsPageFilters.default({}),
    }),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { data: res, error } = await (supabase as any).rpc("wbah_calls_page", {
      p_workspace_id: workspaceId,
      p_filters: data.filters,
      p_limit: data.pageSize,
      p_offset: (data.page - 1) * data.pageSize,
    });
    if (error) throw new Error(error.message);
    const pageRows = ((res?.rows ?? []) as any[]).map((r) => mapWbahCallRow(r, true));

    // Booking enrichment looks at the contact's other calls. On one page those may be missing,
    // so pull the booking-relevant calls for the same phones and enrich them together.
    const phones = [...new Set(pageRows.map((r) => r.phone).filter(Boolean))] as string[];
    let siblings: any[] = [];
    if (phones.length > 0) {
      const { data: sib } = await (supabaseAdmin as any)
        .from("wbah_calls")
        .select(
          "id, customer_name, phone, agent_name, call_status, call_type, sentiment, duration_seconds, started_at, recording_url, disconnection_reason, end_reason, appointment_date, appointment_time, booking_status, calendly_booking_url, call_count",
        )
        .eq("workspace_id", workspaceId)
        .in("phone", phones)
        .or("appointment_date.not.is.null,booking_status.not.is.null,calendly_booking_url.not.is.null")
        .limit(500);
      const pageIds = new Set(pageRows.map((r) => r.id));
      siblings = ((sib ?? []) as any[]).filter((r) => !pageIds.has(r.id)).map((r) => mapWbahCallRow(r, true));
    }
    const enriched = await enrichWbahCallRowsWithBookings(supabaseAdmin, workspaceId, [...pageRows, ...siblings]);
    const byId = new Map(enriched.map((r: any) => [r.id, r]));
    const rows = pageRows.map((r) => byId.get(r.id) ?? r);

    return { rows, total: Number(res?.total ?? 0), page: data.page, pageSize: data.pageSize };
  });

export const getWbahCallsSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ voicemail: z.enum(["exclude", "all", "only"]).default("exclude") }))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    // Same live refresh the old full-list read did on open (incremental, throttled).
    void refreshWbahLiveData(workspaceId, { lightBackfill: true });
    try {
      const { refreshWbahAppointmentBackfill } = await import("./wbah-leads-sync-tick");
      await refreshWbahAppointmentBackfill({ maxPages: 8 });
    } catch (e: any) {
      console.warn("[getWbahCallsSummary] appointment backfill:", e?.message ?? e);
    }
    const { data: res, error } = await (supabase as any).rpc("wbah_calls_summary", {
      p_workspace_id: workspaceId,
      p_voicemail: data.voicemail,
    });
    if (error) throw new Error(error.message);
    return {
      total: Number(res?.total ?? 0),
      completed: Number(res?.completed ?? 0),
      failed: Number(res?.failed ?? 0),
      totalSec: Number(res?.total_sec ?? 0),
      agentNames: ((res?.agent_names ?? []) as string[]).filter(Boolean),
      bookedAgentNames: ((res?.booked_agent_names ?? []) as string[]).filter(Boolean),
    };
  });

// Lightweight count for the Calls sub-tab badge — avoids downloading all
// 11k+ call rows (with transcripts) just to show a number on the People page.
export const listWbahCallsCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    requireActiveWbahWorkspace(workspaceId);
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

function logWbahResponse(
  fn: string,
  workspaceId: string,
  rows: number,
  payload: unknown,
  extra?: Record<string, unknown>,
) {
  let bytes = 0;
  try {
    bytes = JSON.stringify(payload)?.length ?? 0;
  } catch {
    bytes = 0;
  }
  console.log(
    `[wbah-response] fn=${fn} workspace_id=${workspaceId} rows=${rows} bytes=${bytes} ` +
      `sizeKB=${(bytes / 1024).toFixed(1)} sizeMB=${(bytes / 1_000_000).toFixed(2)}` +
      (extra
        ? " " +
          Object.entries(extra)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")
        : ""),
  );
}

// UI status buckets → raw wbah_calls.call_status values.
const WBAH_CALL_STATUS_FILTER: Record<string, string[]> = {
  completed: ["completed", "ended", "call_analyzed", "analyzed"],
  not_connected: ["no_answer", "not_connected", "voicemail", "voicemail_reached", "missed"],
  need_to_call: ["need_to_call"],
  failed: ["failed", "error", "call_failed"],
};

export const listWbahCallsPaged = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
      search: z.string().trim().max(120).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      status: z.string().optional(),
      sentiment: z.string().optional(),
      agentName: z.string().trim().max(120).optional(),
      refresh: z.coerce.boolean().optional(),
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

    const { page, pageSize, search, dateFrom, dateTo, status, sentiment, agentName } = data;
    const filtersHash = Buffer.from(
      JSON.stringify({
        q: search ?? "",
        f: dateFrom ?? "",
        t: dateTo ?? "",
        s: status ?? "",
        se: sentiment ?? "",
        a: agentName ?? "",
      }),
    )
      .toString("base64")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 24);

    const key = `webee:wbah-calls-page:v2:${workspaceId}:p${page}:ps${pageSize}:${filtersHash}`;
    return cacheWrap(key, 60, async () => {
      const sb = supabase as any;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let q = sb
        .from("wbah_calls")
        // transcript is selected only to derive `hasTranscript`; it is NOT
        // returned in the response (fetched on demand via getWbahCallDetail).
        .select(
          "id, customer_name, phone, agent_name, call_status, call_type, sentiment, duration_seconds, started_at, recording_url, transcript, call_summary, disconnection_reason, end_reason, appointment_date, appointment_time, booking_status, calendly_booking_url, call_count",
          { count: "exact" },
        )
        .eq("workspace_id", workspaceId);

      if (search) q = q.or(`customer_name.ilike.%${search}%,phone.ilike.%${search}%`);
      if (dateFrom) q = q.gte("started_at", dateFrom);
      if (dateTo) q = q.lte("started_at", dateTo);
      if (sentiment && sentiment !== "all") q = q.eq("sentiment", sentiment);
      if (agentName && agentName !== "all") q = q.eq("agent_name", agentName);
      if (status && status !== "all" && WBAH_CALL_STATUS_FILTER[status]) {
        q = q.in("call_status", WBAH_CALL_STATUS_FILTER[status]);
      }
      q = q.order("started_at", { ascending: false, nullsFirst: false }).range(from, to);

      const { data: rows, count, error } = await q;
      if (error) throw new Error(error.message);

      const mapped = (rows ?? []).map((r: any, i: number) => ({
        id: r.id,
        srNo: from + i + 1,
        name: r.customer_name ?? null,
        contact: r.phone ?? null,
        phone: r.phone ?? null,
        email: null,
        callType: r.call_type ?? "outbound",
        callStatus: r.call_status,
        sentimentAnalysis: r.sentiment,
        disconnectionReason: r.disconnection_reason,
        appointmentDate: r.appointment_date ?? null,
        appointmentTime: r.appointment_time ?? null,
        appointment_date: r.appointment_date ?? null,
        appointment_time: r.appointment_time ?? null,
        bookingStatus: r.booking_status ?? null,
        booking_status: r.booking_status ?? null,
        calendlyBookingUrl: r.calendly_booking_url ?? null,
        calendly_booking_url: r.calendly_booking_url ?? null,
        agentName: r.agent_name ?? null,
        startTimestamp: r.started_at ? new Date(r.started_at).getTime() : null,
        durationMs: r.duration_seconds ? r.duration_seconds * 1000 : null,
        recordingUrl: r.recording_url ?? null,
        endReason: r.end_reason ?? null,
        callSummary:
          r.call_summary && String(r.call_summary).trim()
            ? String(r.call_summary).trim()
            : null,
        hasTranscript:
          !!(r.transcript && String(r.transcript).trim()) ||
          (String(r.id).startsWith("call_") && r.call_status !== "ongoing"),
      }));

      const enriched = await enrichWbahCallRowsWithBookings(supabaseAdmin, workspaceId, mapped);
      const rowsOut = enriched.map((r: any) => ({
        ...r,
        appointmentDate: r.appointment_date ?? r.appointmentDate ?? null,
        appointmentTime: r.appointment_time ?? r.appointmentTime ?? null,
        bookingStatus: r.booking_status ?? r.bookingStatus ?? null,
        calendlyBookingUrl: r.calendly_booking_url ?? r.calendlyBookingUrl ?? null,
      }));

      const result = { rows: rowsOut, total: count ?? 0, page, pageSize };
      logWbahResponse("listWbahCallsPaged", workspaceId, rowsOut.length, result, {
        page,
        pageSize,
        filters: filtersHash,
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
  .validator(z.object({ phone: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { data: rows, error } = await (supabase as any)
      .from("wbah_calls")
      .select(
        "id, customer_name, phone, agent_name, call_status, sentiment, duration_seconds, started_at, recording_url, transcript, call_summary, disconnection_reason, end_reason, appointment_date, appointment_time, booking_status, calendly_booking_url",
      )
      .eq("workspace_id", workspaceId)
      .eq("phone", data.phone)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const calls = (rows ?? []).map((r: any) => ({
      id: r.id,
      name: r.customer_name ?? null,
      agentName: r.agent_name ?? null,
      callStatus: r.call_status ?? null,
      sentiment: r.sentiment ?? null,
      durationSeconds: r.duration_seconds ?? null,
      startedAt: r.started_at ?? null,
      recordingUrl: r.recording_url ?? null,
      callSummary: r.call_summary ?? null,
      disconnectionReason: r.disconnection_reason ?? null,
      endReason: r.end_reason ?? null,
      appointmentDate: r.appointment_date ?? null,
      appointmentTime: r.appointment_time ?? null,
      bookingStatus: r.booking_status ?? null,
      calendlyBookingUrl: r.calendly_booking_url ?? null,
      hasTranscript:
        !!(r.transcript && String(r.transcript).trim()) ||
        (String(r.id).startsWith("call_") && r.call_status !== "ongoing"),
    }));
    return { phone: data.phone, calls };
  });

// ── Single-call detail (full transcript / summary / recording) ────────────────
// Loaded on demand when a user opens a call — never included in the list page.
export const getWbahCallDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: z.string().min(1) }))
  .handler(jsonResult(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    requireActiveWbahWorkspace(workspaceId);
    const sb = supabase as any;

    // Light refresh so polling picks up call_analyzed fields from WeeBespoke.
    void refreshWbahLiveData(workspaceId, { lightBackfill: true });

    const { data: row, error } = await sb
      .from("wbah_calls")
      .select(
        "id, transcript, call_summary, recording_url, disconnection_reason, end_reason, sentiment, started_at, duration_seconds, call_status, appointment_date, appointment_time, booking_status, calendly_booking_url, customer_name, phone, agent_name, meta",
      )
      .eq("workspace_id", workspaceId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);

    let postCall: Record<string, unknown> = {};
    let transcript = row?.transcript ? String(row.transcript).trim() : null;
    const meta = (row?.meta ?? {}) as Record<string, unknown>;
    if (meta.custom_analysis && typeof meta.custom_analysis === "object") {
      postCall = { ...postCall, ...(meta.custom_analysis as Record<string, unknown>) };
    }
    if (meta.dynamic_variables && typeof meta.dynamic_variables === "object") {
      postCall = { ...postCall, ...(meta.dynamic_variables as Record<string, unknown>) };
    }

    const callIdForRetell = String(row?.id ?? data.id);
    if (
      callIdForRetell.startsWith("call_") &&
      (!transcript || !Object.keys(postCall).length)
    ) {
      try {
        const { retellFetch } = await import("@/lib/providers/retell/client.server");
        const apiKey = await requireWbahRetellKey(context.userId);
        const retellCall = await retellFetch<Record<string, unknown>>(
          `/v2/get-call/${callIdForRetell}`,
          null,
          "GET",
          apiKey,
        );
        if (!transcript) {
          const fromText =
            typeof retellCall?.transcript === "string" ? retellCall.transcript.trim() : "";
          const fromObj = Array.isArray(retellCall?.transcript_object)
            ? (retellCall.transcript_object as Array<{ role?: string; content?: string }>)
                .filter((t) => (t.role === "agent" || t.role === "user") && t.content)
                .map((t) => `${t.role}: ${t.content}`)
                .join("\n")
            : "";
          transcript = fromText || fromObj || transcript;
          if (transcript) {
            void (supabaseAdmin as any)
              .from("wbah_calls")
              .update({ transcript, synced_at: new Date().toISOString() })
              .eq("workspace_id", workspaceId)
              .eq("id", callIdForRetell);
          }
        }
        const custom = (retellCall?.call_analysis as Record<string, unknown> | undefined)
          ?.custom_analysis_data;
        const dv =
          retellCall?.retell_llm_dynamic_variables ??
          retellCall?.collected_dynamic_variables ??
          {};
        if (custom && typeof custom === "object") {
          postCall = { ...postCall, ...(custom as Record<string, unknown>) };
        }
        if (dv && typeof dv === "object") {
          postCall = { ...postCall, ...(dv as Record<string, unknown>) };
        }
      } catch (err) {
        console.warn(
          "[getWbahCallDetail] Retell transcript fallback failed:",
          (err as Error).message ?? err,
        );
      }
    }

    const crmBookingByDigits = await loadWbahCrmBookingByDigits(supabaseAdmin, workspaceId);
    const crm = row?.phone ? crmBookingByDigits.get(phoneDigits(row.phone)) ?? null : null;
    const appt = sanitizeWbahBookingFields(
      resolveWbahBookingFields(row ?? {}, row ?? {}, crm),
    );

    return {
      id: data.id,
      transcript: transcript?.trim() ? transcript : null,
      callSummary: row?.call_summary ?? null,
      recordingUrl: row?.recording_url ?? null,
      sentiment: row?.sentiment ?? null,
      callStatus: row?.call_status ?? null,
      appointment_date: appt.appointment_date ?? null,
      appointment_time: appt.appointment_time ?? null,
      booking_status: appt.booking_status ?? null,
      calendly_booking_url: appt.calendly_booking_url ?? null,
      customer_name: row?.customer_name ?? null,
      phone: row?.phone ?? null,
      agent_name: row?.agent_name ?? null,
      postCall: Object.keys(postCall).length ? postCall : null,
      meta: row?.meta ?? null,
    };
  }));
