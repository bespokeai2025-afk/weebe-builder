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

export const getReceptionistDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ limit: z.number().int().min(1).max(100).default(30) }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const sb = supabase as any;

    const { data: agents } = await sb
      .from("agents")
      .select("id, name, retell_agent_id, agent_type, settings")
      .eq("workspace_id", workspaceId)
      .eq("agent_type", "receptionist");

    const receptionistAgents = (agents ?? []) as Array<{
      id: string;
      name: string;
      retell_agent_id: string | null;
      agent_type: string;
      settings: Record<string, unknown> | null;
    }>;

    const retellIds = new Set<string>();
    for (const a of receptionistAgents) {
      if (a.retell_agent_id) retellIds.add(a.retell_agent_id.replace(/^agents\//, ""));
      const deployed = a.settings?.deployedRetellAgentId;
      if (typeof deployed === "string") retellIds.add(deployed.replace(/^agents\//, ""));
    }
    retellIds.add(DNR_RETELL_AGENT_ID);

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
        if (c.agent_name && agentNames.includes(c.agent_name)) return true;
        if (c.agent_name?.includes("Dr Nyla") || c.agent_name?.includes("Cheshire")) return true;
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

    const pabauBookings = ((bookingRows ?? []) as ReceptionistBookingRow[]).filter(
      (b) => b.source === "pabau" || b.title.includes("Cheshire") || b.notes?.includes("Pabau"),
    );

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

    return {
      brand: DNR_VOICE.brand,
      location: DNR_VOICE.location.name,
      retellAgentId: DNR_RETELL_AGENT_ID,
      agents: receptionistAgents,
      calls,
      bookings: pabauBookings.length ? pabauBookings : ((bookingRows ?? []) as ReceptionistBookingRow[]),
      toolEvents,
      toolEventsAvailable: !toolsErr,
    };
  });
