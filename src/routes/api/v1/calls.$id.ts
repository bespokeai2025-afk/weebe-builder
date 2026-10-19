/**
 * WEBEE Developer API v1 — Call by ID
 * GET /api/v1/calls/:id — full call record including summary, transcript, recording (calls:read)
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

// Untyped view of the shared service-role client (these routes predate the generated types).
const sb = () => supabaseAdmin as any;

const CALL_SELECT = [
  "id", "agent_id", "agent_name",
  "call_status", "call_type", "call_outcome",
  "from_number", "to_number",
  "duration_seconds", "started_at", "ended_at",
  "call_summary", "transcript",
  "recording_url",
  "sentiment", "disconnection_reason",
  "cost_cents", "retell_call_id",
  "lead:leads(id, full_name, phone, email)",
].join(", ");

export const Route = createFileRoute("/api/v1/calls/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await authenticateV1Request(request, "calls:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;
        const { id } = params as { id: string };

        const { data, error } = await (sb() as any).from("calls")
          .select(CALL_SELECT)
          .eq("id", id)
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        if (error) return jsonErr(error.message, 500);
        if (!data)  return jsonErr("Call not found", 404);

        return jsonOk({
          object:               "call",
          id:                   data.id,
          agent_id:             data.agent_id     ?? null,
          agent_name:           data.agent_name   ?? null,
          call_status:          data.call_status  ?? null,
          call_type:            data.call_type    ?? null,
          call_outcome:         data.call_outcome ?? null,
          from_number:          data.from_number  ?? null,
          to_number:            data.to_number    ?? null,
          duration_seconds:     data.duration_seconds ?? null,
          started_at:           data.started_at   ?? null,
          ended_at:             data.ended_at     ?? null,
          sentiment:            data.sentiment    ?? null,
          disconnection_reason: data.disconnection_reason ?? null,
          cost_usd:             data.cost_cents != null ? parseFloat((data.cost_cents / 100).toFixed(4)) : null,
          recording_url:        data.recording_url ?? null,
          summary:              data.call_summary  ?? null,
          transcript:           data.transcript    ?? null,
          provider_call_id:     data.retell_call_id ?? null,
          contact:              data.lead ?? null,
        });
      },
    },
  },
});
