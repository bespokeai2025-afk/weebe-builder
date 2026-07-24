/**
 * WEBEE Mind API — Tool Execution
 * POST /api/v1/minds/tools/execute — run a registry Mind tool.
 *
 * Auth: Supabase user token ONLY (tool runs are user-initiated and go through
 * the exact same guard chain as the web: membership, entitlements, mode gate,
 * sensitive-approval requirement, zod validation, audit lifecycle).
 *
 * Body: { "tool": "hivemind.update_agent_prompt", "input": { ... } }
 * Sensitive tools return status "approval_required" — approve via the
 * HiveMind actions endpoints, never by passing an approval flag here.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const BodySchema = z.object({
  tool: z.string().min(1).max(200),
  input: z.unknown().optional(),
});

export const Route = createFileRoute("/api/v1/minds/tools/execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:execute", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId, supabase } = auth.ctx;

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch (err: any) {
          return jsonErr(`Invalid request body: ${err?.message ?? "expected { tool, input }"}`, 400);
        }

        try {
          const { executeMindTool } = await import("@/lib/minds/tool-registry.server");
          const exec = await executeMindTool({
            sb: supabase,
            workspaceId,
            userId,
            platform: "api",
            toolName: body.tool,
            input: body.input ?? {},
            initiatedBy: "user",
            // Explicit approval NEVER comes from this endpoint — sensitive
            // tools must go through the approvals workflow.
          });
          const status =
            exec.status === "completed" ? 200 :
            exec.status === "approval_required" ? 202 :
            exec.status === "blocked" ? 403 : 500;
          return jsonOk(
            {
              status: exec.status,
              execution_id: exec.executionId,
              result: exec.result ?? null,
              affected_record_type: exec.affectedRecordType ?? null,
              affected_record_id: exec.affectedRecordId ?? null,
              error: exec.error ?? null,
            },
            status,
          );
        } catch (err: any) {
          return jsonErr(err?.message ?? "Tool execution failed", 500);
        }
      },
    },
  },
});
