import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processRetellWebhook, retellJson } from "@/lib/retell/retell-webhook.processor";

const TestPayloadSchema = z
  .object({
    event: z
      .enum(["call_started", "call_ended", "call_analyzed", "call_transferred", "call_failed"])
      .default("call_analyzed"),
    payload: z.record(z.unknown()).optional(),
  })
  .default({ event: "call_analyzed" });

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function requireWorkspaceToken(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!match) return { error: retellJson({ error: "Missing bearer token" }, 401) };

  const { data: tokenRow, error } = await supabaseAdmin
    .from("workspace_api_tokens")
    .select("id, workspace_id, revoked_at")
    .eq("token_hash", sha256Hex(match[1].trim()))
    .maybeSingle();

  if (error) return { error: retellJson({ error: "Auth lookup failed" }, 500) };
  if (!tokenRow || tokenRow.revoked_at) {
    return { error: retellJson({ error: "Invalid or revoked token" }, 401) };
  }

  await supabaseAdmin
    .from("workspace_api_tokens")
    .update({ last_used_at: new Date().toISOString() } as never)
    .eq("id", tokenRow.id);

  return { workspaceId: tokenRow.workspace_id as string };
}

async function defaultPayload(workspaceId: string, event: string) {
  const { data: settings } = await supabaseAdmin
    .from("workspace_settings")
    .select("retell_default_agent_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const agentId =
    ((settings?.retell_default_agent_id as string | null | undefined) ?? "agent_test")
      .replace(/^agents\//, "")
      .trim() || "agent_test";
  const now = Date.now();

  return {
    event,
    call: {
      call_id: `test_${now}`,
      agent_id: agentId,
      call_status:
        event === "call_failed" ? "failed" : event === "call_started" ? "ongoing" : "ended",
      call_type: "outbound",
      from_number: "+15550000000",
      to_number: "+15551112222",
      direction: "outbound",
      start_timestamp: now - 90_000,
      end_timestamp: event === "call_started" ? undefined : now,
      duration_ms: event === "call_started" ? undefined : 90_000,
      disconnection_reason: event === "call_failed" ? "test_failure" : "user_hangup",
      transcript: "This is a simulated Retell webhook test call.",
      recording_url: null,
      call_analysis: {
        call_summary: "Simulated Retell webhook processed successfully.",
        user_sentiment: "neutral",
        call_successful: event !== "call_failed",
        in_voicemail: false,
      },
    },
  };
}

export const Route = createFileRoute("/api/admin/test-retell-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireWorkspaceToken(request);
        if (auth.error) return auth.error;

        let input: z.infer<typeof TestPayloadSchema>;
        try {
          const text = await request.text();
          input = TestPayloadSchema.parse(text.trim() ? JSON.parse(text) : undefined);
        } catch (error) {
          return retellJson(
            {
              error: "Invalid test payload",
              detail: error instanceof Error ? error.message : "Unknown error",
            },
            400,
          );
        }

        const payload = input.payload ?? (await defaultPayload(auth.workspaceId!, input.event));
        const result = await processRetellWebhook(JSON.stringify(payload), new Headers(), {
          skipSignature: true,
          forcedWorkspaceId: auth.workspaceId!,
          source: "admin-test",
        });

        return retellJson({ ok: result.ok, result, payload }, result.status);
      },
    },
  },
});
