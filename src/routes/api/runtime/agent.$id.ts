/**
 * GET /api/runtime/agent/:id
 *
 * Returns a lightweight summary of an agent's runtime definition:
 * identity, provider, model, voice config metadata, and capability flags.
 * Does NOT include the full workflow graph, compiled prompt, or provider JSON.
 *
 * For the complete self-contained runtime definition, use:
 *   GET /api/runtime/agent/:id/export
 *
 * Authentication: Bearer token (Supabase JWT).
 * Ownership: RLS on the agents table — only the owning user's agents are
 * returned. A valid token that belongs to a different user yields 404.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildAgentRuntimeDefinition, unpackAgentRow } from "@/lib/runtime/export";
import { summariseDefinition } from "@/lib/runtime/definition";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
} as const;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function unauthorizedResponse(detail: string) {
  return jsonResponse({ error: "Unauthorized", detail }, 401);
}

/**
 * Verify a Bearer JWT and return a user-scoped Supabase client.
 * The user-scoped client respects RLS — ownership checks are implicit.
 */
function createUserSupabase(token: string) {
  const SUPABASE_URL =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase env vars not configured");
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export const Route = createFileRoute("/api/runtime/agent/$id")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async ({ request, params }) => {
        // ── Auth ────────────────────────────────────────────────────────────
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) {
          return unauthorizedResponse("Bearer token required");
        }
        const token = authHeader.slice(7).trim();
        if (!token) return unauthorizedResponse("Empty token");

        let supabase: ReturnType<typeof createUserSupabase>;
        try {
          supabase = createUserSupabase(token);
        } catch (err) {
          return jsonResponse(
            { error: "Server configuration error", detail: String(err) },
            500,
          );
        }

        // Verify token
        const { data: claimsData, error: claimsErr } =
          await supabase.auth.getClaims(token);
        if (claimsErr || !claimsData?.claims?.sub) {
          return unauthorizedResponse("Invalid or expired token");
        }

        // ── Validate param ──────────────────────────────────────────────────
        const agentId = params.id;
        if (!agentId || !/^[0-9a-f-]{36}$/i.test(agentId)) {
          return jsonResponse({ error: "Invalid agent id" }, 400);
        }

        // ── Load agent (RLS enforces ownership) ─────────────────────────────
        const { data: row, error } = await supabase
          .from("agents")
          .select(
            "id, retell_agent_id, name, flow_data, settings, variables, updated_at",
          )
          .eq("id", agentId)
          .maybeSingle();

        if (error) {
          console.error("[runtime/agent] DB error", error);
          return jsonResponse({ error: "Database error" }, 500);
        }
        if (!row) {
          return jsonResponse({ error: "Agent not found" }, 404);
        }

        // ── Assemble summary ────────────────────────────────────────────────
        try {
          const typedRow = row as Parameters<typeof unpackAgentRow>[0];
          const params2 = unpackAgentRow(typedRow);
          const definition = buildAgentRuntimeDefinition(params2);
          const summary = summariseDefinition(definition, typedRow.updated_at);
          return jsonResponse({ ok: true, data: summary });
        } catch (err) {
          console.error("[runtime/agent] Assembly error", err);
          return jsonResponse({ error: "Failed to assemble runtime definition" }, 500);
        }
      },
    },
  },
});
