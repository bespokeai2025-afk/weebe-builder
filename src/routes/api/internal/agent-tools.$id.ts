/**
 * GET /api/internal/agent-tools/:id
 *
 * Internal-only endpoint used by the HyperStream relay to fetch an agent's
 * full tool registry (name + url/api_url + tool_type) without a user Bearer
 * token.  Uses the Supabase admin client to bypass RLS.
 *
 * Protection: requires the `x-internal-relay: true` request header.  This
 * header is added by the relay plugin which runs in the same Node process;
 * external callers that don't know about it receive 403.
 *
 * Response: { ok: true, tools: Array<{ name, tool_type?, url?, api_url? }> }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildAgentRuntimeDefinition, unpackAgentRow } from "@/lib/runtime/export";
import { buildHyperStreamBookingTools } from "@/lib/calendar/hyperstream-booking-tools";
import { buildHyperStreamDocumentTools } from "@/lib/documents/hyperstream-document-tools";

export interface RelayToolEntry {
  name: string;
  tool_type?: string;
  url?: string;
  api_url?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/internal/agent-tools/$id")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      GET: async ({ request, params }) => {
        if (request.headers.get("x-internal-relay") !== "true") {
          return new Response("Forbidden", { status: 403 });
        }

        const agentId = params.id;
        if (!agentId || !/^[0-9a-f-]{36}$/i.test(agentId)) {
          return json({ error: "Invalid agent id" }, 400);
        }

        const { data: row } = await supabaseAdmin
          .from("agents")
          .select("id, retell_agent_id, name, flow_data, settings, variables, updated_at")
          .eq("id", agentId)
          .maybeSingle();

        if (!row) {
          return json({ error: "Agent not found" }, 404);
        }

        let tools: Array<Record<string, unknown>> = [];
        try {
          const typedRow = row as Parameters<typeof unpackAgentRow>[0];
          const def = buildAgentRuntimeDefinition(unpackAgentRow(typedRow));
          tools = (def.tools ?? []) as Array<Record<string, unknown>>;
        } catch {
          /* return empty list on assembly failure */
        }

        const settings = (row.settings ?? {}) as Record<string, unknown>;
        const bookingEnabled =
          (settings.booking as Record<string, unknown> | undefined)?.enabled === true;

        if (bookingEnabled) {
          const bookingTools = buildHyperStreamBookingTools(
            agentId,
          ) as Array<Record<string, unknown>>;
          tools = [...tools, ...bookingTools];
        }

        // Always include the document check tool — it's harmless when unused
        // and requires no extra configuration.
        const docTools = buildHyperStreamDocumentTools(agentId) as Array<Record<string, unknown>>;
        tools = [...tools, ...docTools];

        const registry: RelayToolEntry[] = tools
          .map((t) => ({
            name: typeof t.name === "string" ? t.name : "",
            tool_type: typeof t.tool_type === "string" ? t.tool_type : undefined,
            url: typeof t.url === "string" ? t.url : undefined,
            api_url: typeof t.api_url === "string" ? t.api_url : undefined,
          }))
          .filter((t) => t.name.length > 0);

        return json({ ok: true, tools: registry });
      },
    },
  },
});
