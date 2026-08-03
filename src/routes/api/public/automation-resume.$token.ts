/**
 * POST /api/public/automation-resume/:token — resume a waiting workflow via webhook.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ensureAutomationEngineBootstrapped } from "@/lib/automation-engine/bootstrap";

export const Route = createFileRoute("/api/public/automation-resume/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        ensureAutomationEngineBootstrapped();
        const token = params.token;
        if (!token?.trim()) {
          return Response.json({ error: "Missing token" }, { status: 400 });
        }

        let payload: Record<string, unknown> = {};
        try {
          const text = await request.text();
          payload = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const { resumeExecutionByWebhookToken } = await import(
          "@/lib/automation-engine/runtime/resume"
        );
        const result = await resumeExecutionByWebhookToken({ token, payload });
        if (!result) {
          return Response.json({ error: "No waiting execution for token" }, { status: 404 });
        }

        return Response.json({
          ok: true,
          executionId: result.executionId,
          status: result.result.status,
          waitingOn: result.result.waitingOn ?? null,
        });
      },
    },
  },
});
