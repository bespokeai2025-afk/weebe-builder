import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DNR_RETELL_AGENT_ID, DNR_VOICE } from "@/lib/dnr/dnr-voice.config";

export type ReceptionistCallRow = {
  id: string;
  retell_call_id: string | null;
  agent_name: string | null;
  from_number: string | null;
  started_at: string | null;
  duration_seconds: number | null;
  call_status: string | null;
  call_summary: string | null;
  transcript: string | null;
  recording_url: string | null;
  sentiment: string | null;
};

export type ReceptionistBookingRow = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  attendee_name: string | null;
  attendee_phone: string | null;
  status: string;
  source: string;
  notes: string | null;
};

export type ReceptionistToolEventRow = {
  id: string;
  tool_name: string;
  ok: boolean;
  retell_call_id: string | null;
  request_summary: Record<string, unknown>;
  response_summary: Record<string, unknown>;
  created_at: string;
};

export type ReceptionistAgentRow = {
  id: string;
  name: string;
  retell_agent_id: string | null;
  agent_type: string;
  settings: Record<string, unknown> | null;
};

/**
 * Named so the page gets a real type. The handler's return was being inferred as `{}`, which left
 * every field access on the page an implicit-any error and hid this kind of bug from tsc.
 */
export type ReceptionistDashboard = {
  brand: string | null;
  location: string | null;
  retellAgentId: string | null;
  agents: ReceptionistAgentRow[];
  calls: ReceptionistCallRow[];
  bookings: ReceptionistBookingRow[];
  toolEvents: ReceptionistToolEventRow[];
  toolEventsAvailable: boolean;
};

export const getReceptionistDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ limit: z.number().int().min(1).max(100).default(30) }).parse(input ?? {}),
  )
  .handler(async ({ context, data }): Promise<ReceptionistDashboard> => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const sb = supabase as any;

    const { data: agents } = await sb
      .from("agents")
      .select("id, name, retell_agent_id, agent_type, settings")
      .eq("workspace_id", workspaceId)
      .eq("agent_type", "receptionist");

    const receptionistAgents = (agents ?? []) as ReceptionistAgentRow[];

    const retellIds = new Set<string>();
    for (const a of receptionistAgents) {
      if (a.retell_agent_id) retellIds.add(a.retell_agent_id.replace(/^agents\//, ""));
      const deployed = a.settings?.deployedRetellAgentId;
      if (typeof deployed === "string") retellIds.add(deployed.replace(/^agents\//, ""));
    }
    // Deliberately NOT seeded with DNR_RETELL_AGENT_ID. That agent belongs to one
    // workspace, whose own `agents` row already carries the id, so seeding it here
    // only ever matched calls in workspaces it has nothing to do with.

    const agentNames = receptionistAgents.map((a) => a.name).filter(Boolean);

    let callsQ = sb
      .from("calls")
      .select(
        "id, retell_call_id, agent_name, agent_id, from_number, started_at, duration_seconds, call_status, call_summary, transcript, recording_url, sentiment",
      )
      .eq("workspace_id", workspaceId)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(data.limit);

    const { data: callRows, error: callsErr } = await callsQ;
    if (callsErr) throw new Error(callsErr.message);

    const calls = ((callRows ?? []) as ReceptionistCallRow[] & { agent_id?: string }[]).filter(
      (c) => {
        const aid = (c as { agent_id?: string }).agent_id?.replace(/^agents\//, "");
        if (aid && retellIds.has(aid)) return true;
        // Matched on this workspace's own agent names only. Matching the literal
        // strings "Dr Nyla" and "Cheshire" put one client's calls into the filter
        // for every tenant that happened to name an agent the same way.
        if (c.agent_name && agentNames.includes(c.agent_name)) return true;
        return false;
      },
    );

    const { data: bookingRows, error: bookingsErr } = await sb
      .from("calendar_bookings")
      .select("id, title, start_at, end_at, attendee_name, attendee_phone, status, source, notes")
      .eq("workspace_id", workspaceId)
      .in("source", ["pabau", "retell"])
      .order("start_at", { ascending: false })
      .limit(data.limit);

    if (bookingsErr) throw new Error(bookingsErr.message);

    // Bookings this receptionist actually made: the practice-management
    // integration's own rows, or a voice booking from a caller whose call the
    // filter above already attributed to a receptionist agent.
    //
    // The previous rule fell back to EVERY pabau/retell booking in the workspace
    // whenever no pabau row matched, so ordinary outbound-campaign bookings were
    // listed as receptionist bookings. Matching on the caller's number rather
    // than on notes, because voice bookings are written with notes = null.
    const tail = (phone: string | null | undefined): string =>
      String(phone ?? "")
        .replace(/\D/g, "")
        .slice(-9);
    const receptionistCallerPhones = new Set(
      calls.map((c) => tail(c.from_number)).filter((p) => p.length >= 7),
    );
    const receptionistBookings = ((bookingRows ?? []) as ReceptionistBookingRow[]).filter((b) => {
      if (b.source === "pabau" || b.notes?.includes("Pabau")) return true;
      const phone = tail(b.attendee_phone);
      return phone.length >= 7 && receptionistCallerPhones.has(phone);
    });

    let toolEvents: ReceptionistToolEventRow[] = [];
    const { data: toolRows, error: toolsErr } = await sb
      .from("receptionist_tool_events")
      .select("id, tool_name, ok, retell_call_id, request_summary, response_summary, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (!toolsErr) {
      toolEvents = (toolRows ?? []) as ReceptionistToolEventRow[];
    }

    // The DNR brand copy belongs to the workspace that owns that agent, nobody else.
    const isDnrWorkspace = retellIds.has(DNR_RETELL_AGENT_ID);
    const primaryRetellAgentId =
      receptionistAgents
        .find((a) => a.retell_agent_id)
        ?.retell_agent_id?.replace(/^agents\//, "") ?? null;

    return {
      // Identity comes from the workspace being viewed. These were the DNR
      // constants, so every tenant's Receptionist tab was titled with, and
      // linked to, one particular client's brand and Retell agent.
      brand: isDnrWorkspace ? DNR_VOICE.brand : null,
      location: isDnrWorkspace ? DNR_VOICE.location.name : null,
      retellAgentId: primaryRetellAgentId,
      agents: receptionistAgents,
      calls,
      bookings: receptionistBookings,
      toolEvents,
      toolEventsAvailable: !toolsErr,
    };
  });
