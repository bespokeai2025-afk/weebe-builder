/**
 * GET /api/automation/executions/:executionId/events — SSE live execution events.
 */
import { createFileRoute } from "@tanstack/react-router";
import { executionEventBus } from "@/lib/automation-engine/runtime/execution-events";

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export const Route = createFileRoute("/api/automation/executions/$executionId/events")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const executionId = params.executionId;
        if (!executionId) {
          return Response.json({ error: "Missing executionId" }, { status: 400 });
        }

        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            const write = (payload: unknown) => {
              controller.enqueue(encoder.encode(sseData(payload)));
            };

            write({ type: "connected", executionId, timestamp: new Date().toISOString() });

            const unsubscribe = executionEventBus.subscribe(executionId, (event) => {
              write(event);
              if (
                event.type === "execution.completed" ||
                event.type === "execution.failed" ||
                event.type === "execution.cancelled"
              ) {
                setTimeout(() => {
                  unsubscribe();
                  controller.close();
                }, 100);
              }
            });

            const keepalive = setInterval(() => {
              controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
            }, 15_000);

            request.signal.addEventListener("abort", () => {
              clearInterval(keepalive);
              unsubscribe();
              controller.close();
            });
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
