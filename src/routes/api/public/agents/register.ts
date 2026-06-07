/**
 * External integration endpoint — POSTed by the Agent Builder's "Go Live"
 * button after it deploys an agent to Retell.
 *
 * Auth: Bearer <workspace API token> (Settings → API tokens).
 * Effect:
 *   1. Validates the bearer token against workspace_api_tokens (sha256).
 *   2. Upserts a row into public.agents keyed on retell_agent_id within
 *      that workspace — so the agent appears in /my-agents automatically.
 *   3. PATCHes the Retell agent with our webhook URL so call events flow
 *      into /api/public/retell-webhook and populate public.calls.
 *   4. Writes an audit row in public.deployments.
 *
 * Response: { agentId, retellAgentId, webhookUrl }.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { retellFetch } from "@/lib/providers/retell/client.server";
import { autofixCalcomBooking } from "@/lib/providers/retell/calcom-autofix.server";
import { registerCalcomWebhook } from "@/lib/providers/calcom/webhook-register.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const PayloadSchema = z.object({
  retellAgentId: z
    .string()
    .min(3)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).max(200),
  agentType: z.enum(["lead_gen", "receptionist"]).default("lead_gen"),
  inboundPhoneNumber: z
    .string()
    .trim()
    .max(32)
    .regex(/^\+?[0-9]{6,20}$/)
    .nullish(),
  retellConversationFlowId: z
    .string()
    .min(3)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullish(),
  description: z.string().max(2000).nullish(),
  // Optional: builder can ship the workspace's integration creds so the
  // dashboard auto-configures Cal.com / Twilio without manual paste.
  integrations: z
    .object({
      calcom: z
        .object({
          apiToken: z.string().min(1).max(512).optional(),
          eventTypeId: z.string().min(1).max(64).optional(),
        })
        .optional(),
      twilio: z
        .object({
          authToken: z.string().min(1).max(512).optional(),
          phoneId: z.string().min(1).max(128).optional(),
        })
        .optional(),
      timezone: z.string().min(1).max(64).optional(),
      businessName: z.string().min(1).max(200).optional(),
      notificationEmail: z.string().email().max(200).optional(),
    })
    .optional(),
  // Optional: where to POST the sync-back payload so the builder can
  // store the dashboard's agent + webhook URLs on its side.
  builderCallbackUrl: z.string().url().max(500).optional(),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function buildWebhookUrl(request: Request): string {
  const explicit = process.env.PUBLIC_SITE_URL?.trim();
  if (explicit) return `${explicit.replace(/\/$/, "")}/api/public/voice-webhook`;
  const origin = new URL(request.url).origin;
  return `${origin}/api/public/voice-webhook`;
}

export const Route = createFileRoute("/api/public/agents/register")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        // 1. Authenticate via Bearer token.
        const auth = request.headers.get("authorization") ?? "";
        const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
        if (!m) return json({ error: "Missing bearer token" }, 401);
        const token = m[1].trim();
        const tokenHash = sha256Hex(token);

        const { data: tokenRow, error: tokenErr } = await supabaseAdmin
          .from("workspace_api_tokens")
          .select("id, workspace_id, revoked_at")
          .eq("token_hash", tokenHash)
          .maybeSingle();
        if (tokenErr) return json({ error: "Auth lookup failed" }, 500);
        if (!tokenRow || tokenRow.revoked_at) {
          return json({ error: "Invalid or revoked token" }, 401);
        }
        const workspaceId = tokenRow.workspace_id as string;

        // Resolve a "deployed_by" user for audit. Use workspace owner.
        const { data: ws } = await supabaseAdmin
          .from("workspaces")
          .select("owner_id")
          .eq("id", workspaceId)
          .maybeSingle();
        const deployedBy = (ws?.owner_id as string | undefined) ?? null;

        // 2. Validate payload.
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }
        const parsed = PayloadSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
        }
        const p = parsed.data;

        // 2b. Persist any integration creds shipped by the builder.
        const integ = p.integrations;
        if (integ) {
          const patch: Record<string, unknown> = {};
          if (integ.calcom?.apiToken) patch.calcom_api_key = integ.calcom.apiToken;
          if (integ.calcom?.eventTypeId) patch.calcom_event_type_id = integ.calcom.eventTypeId;
          if (integ.twilio?.authToken) patch.twilio_auth_token = integ.twilio.authToken;
          if (integ.twilio?.phoneId) patch.whatsapp_phone_id = integ.twilio.phoneId;
          if (integ.timezone) patch.timezone = integ.timezone;
          if (integ.businessName) patch.business_name = integ.businessName;
          if (integ.notificationEmail) patch.notification_email = integ.notificationEmail;
          if (Object.keys(patch).length > 0) {
            // upsert pattern — workspace_settings is keyed by workspace_id.
            const { data: existingSettings } = await supabaseAdmin
              .from("workspace_settings")
              .select("workspace_id")
              .eq("workspace_id", workspaceId)
              .maybeSingle();
            if (existingSettings) {
              await supabaseAdmin
                .from("workspace_settings")
                .update(patch as never)
                .eq("workspace_id", workspaceId);
            } else {
              await supabaseAdmin
                .from("workspace_settings")
                .insert({ workspace_id: workspaceId, ...patch } as never);
            }
          }
        }

        // 3. Verify the Retell agent exists.
        let retellAgent: Record<string, unknown>;
        try {
          retellAgent = await retellFetch<Record<string, unknown>>(
            `/get-agent/${encodeURIComponent(p.retellAgentId)}`,
            undefined,
            "GET",
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Retell lookup failed";
          return json({ error: msg }, 502);
        }
        const verifiedId = (retellAgent.agent_id as string | undefined) ?? p.retellAgentId;
        const engine = retellAgent.response_engine as { conversation_flow_id?: string } | undefined;
        const flowId = p.retellConversationFlowId ?? engine?.conversation_flow_id ?? null;

        // 4. Upsert agent row (keyed on retell_agent_id + workspace).
        const { data: existing } = await supabaseAdmin
          .from("agents")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("retell_agent_id", verifiedId)
          .maybeSingle();

        let agentRowId: string;
        if (existing?.id) {
          agentRowId = existing.id as string;
          const { error: updErr } = await supabaseAdmin
            .from("agents")
            .update({
              name: p.name,
              agent_type: p.agentType,
              inbound_phone_number: p.inboundPhoneNumber ?? null,
              retell_conversation_flow_id: flowId,
            } as never)
            .eq("id", agentRowId);
          if (updErr) return json({ error: updErr.message }, 500);
        } else {
          if (!deployedBy) {
            return json({ error: "Workspace has no owner; cannot create agent" }, 500);
          }
          const { data: inserted, error: insErr } = await supabaseAdmin
            .from("agents")
            .insert({
              workspace_id: workspaceId,
              user_id: deployedBy,
              name: p.name,
              agent_type: p.agentType,
              retell_agent_id: verifiedId,
              retell_conversation_flow_id: flowId,
              inbound_phone_number: p.inboundPhoneNumber ?? null,
            } as never)
            .select("id")
            .single();
          if (insErr || !inserted) {
            return json({ error: insErr?.message ?? "Insert failed" }, 500);
          }
          agentRowId = inserted.id as string;
        }

        // 5. Register webhook on the Retell agent.
        const webhookUrl = buildWebhookUrl(request);
        try {
          await retellFetch(
            `/update-agent/${encodeURIComponent(verifiedId)}`,
            { webhook_url: webhookUrl },
            "PATCH",
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Webhook register failed";
          if (deployedBy) {
            await supabaseAdmin.from("deployments").insert({
              agent_id: agentRowId,
              workspace_id: workspaceId,
              provider: "retell",
              provider_agent_id: verifiedId,
              status: "error",
              error: msg,
              deployed_by: deployedBy,
              payload: { stage: "register_webhook", webhook_url: webhookUrl } as never,
            });
          }
          return json({ error: msg }, 502);
        }

        // 6. Audit + bump token last_used_at.
        if (deployedBy) {
          await supabaseAdmin.from("deployments").insert({
            agent_id: agentRowId,
            workspace_id: workspaceId,
            provider: "retell",
            provider_agent_id: verifiedId,
            provider_flow_id: flowId,
            status: "success",
            deployed_by: deployedBy,
            payload: {
              stage: "register_external",
              source: "agent_builder",
              agent_type: p.agentType,
              webhook_url: webhookUrl,
            } as never,
          });
        }
        await supabaseAdmin
          .from("workspace_api_tokens")
          .update({ last_used_at: new Date().toISOString() } as never)
          .eq("id", tokenRow.id);

        // 7. Best-effort: auto-fix Cal.com booking tool on the flow + agent.
        let autofix: Awaited<ReturnType<typeof autofixCalcomBooking>> | null = null;
        try {
          autofix = await autofixCalcomBooking({
            workspaceId,
            retellAgentId: verifiedId,
            retellConversationFlowId: flowId,
          });
        } catch (e) {
          console.warn("[register] autofixCalcomBooking failed", e);
        }

        // 8. Best-effort: auto-register the Cal.com booking webhook so
        //    bookings stream into /api/public/calcom-webhook/<workspaceId>
        //    without the user touching Cal.com's dashboard.
        const origin =
          process.env.PUBLIC_SITE_URL?.trim().replace(/\/$/, "") || new URL(request.url).origin;
        const calcomSubscriberUrl = `${origin}/api/public/calcom-webhook/${workspaceId}`;
        let calcomWebhook: Awaited<ReturnType<typeof registerCalcomWebhook>> | null = null;
        try {
          calcomWebhook = await registerCalcomWebhook({
            workspaceId,
            subscriberUrl: calcomSubscriberUrl,
          });
        } catch (e) {
          console.warn("[register] registerCalcomWebhook failed", e);
        }

        // 9. Two-way sync: notify the builder so it can store the
        //    dashboard's agent id + webhook URLs alongside its own copy.
        let builderSync: { ok: boolean; status?: number; error?: string } | null = null;
        if (p.builderCallbackUrl) {
          try {
            const r = await fetch(p.builderCallbackUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                source: "dashboard",
                workspaceId,
                agentId: agentRowId,
                retellAgentId: verifiedId,
                retellConversationFlowId: flowId,
                webhooks: {
                  voice: webhookUrl,
                  calcom: calcomSubscriberUrl,
                  whatsapp: `${origin}/api/public/whatsapp-webhook/${workspaceId}`,
                },
                calcomAutofix: autofix,
                calcomWebhook,
              }),
            });
            builderSync = { ok: r.ok, status: r.status };
          } catch (e) {
            builderSync = {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }

        return json({
          ok: true,
          agentId: agentRowId,
          retellAgentId: verifiedId,
          retellConversationFlowId: flowId,
          webhookUrl,
          webhooks: {
            voice: webhookUrl,
            calcom: calcomSubscriberUrl,
            whatsapp: `${origin}/api/public/whatsapp-webhook/${workspaceId}`,
          },
          calcomAutofix: autofix,
          calcomWebhook,
          builderSync,
        });
      },
    },
  },
});
