/**
 * POST /api/public/automation-queue — drain pending automation execution queue.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ensureAutomationEngineBootstrapped } from "@/lib/automation-engine/bootstrap";

export const Route = createFileRoute("/api/public/automation-queue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
        const pollerSecret = process.env.POLLER_SECRET ?? process.env.CRON_SECRET ?? "";
        const authHeader = request.headers.get("Authorization") ?? "";
        const secretHdr = request.headers.get("x-poller-secret") ?? "";
        const byBearer = serviceKey && authHeader === `Bearer ${serviceKey}`;
        const bySecret = pollerSecret && secretHdr === pollerSecret;
        if (!byBearer && !bySecret) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        ensureAutomationEngineBootstrapped();
        const { drainExecutionQueue } = await import(
          "@/lib/automation-engine/queue/execution-queue.server"
        );
        const processed = await drainExecutionQueue(10);
        return Response.json({ ok: true, processed });
      },
    },
  },
});
