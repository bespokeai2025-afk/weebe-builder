/**
 * Agent go-live + phone-number persistence services.
 *
 * Extracted from agents.functions.ts so BOTH the client-callable server fns
 * (manual "Go Live" button) and server-side orchestration (SystemMind
 * Deployment Orchestrator) run the exact same logic — never two paths.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { retellFetch } from "@/lib/providers/retell/client.server";
import type { AgentGoLiveType } from "@/lib/agents/agents.functions";

/** Save the deployed phone number onto an agent's settings JSON. */
export async function saveAgentPhoneNumberService(args: {
  supabase: SupabaseClient<any>;
  id: string;
  phoneNumber: string | null;
}): Promise<{ ok: boolean }> {
  const { data: row, error: readErr } = await args.supabase
    .from("agents")
    .select("settings")
    .eq("id", args.id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  const settings = ((row?.settings ?? {}) as Record<string, unknown>) || {};
  const next = { ...settings, phoneNumber: args.phoneNumber };
  const { error } = await args.supabase
    .from("agents")
    .update({ settings: next })
    .eq("id", args.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * Mark an agent live: set isLive/dashboardAgentType in settings, patch the
 * Retell webhook URL, configure ElevenLabs webhook + phone binding for
 * VoxStream agents, and register the Cal.com webhook for HyperStream agents.
 */
export async function goLiveAgentService(args: {
  supabase: SupabaseClient<any>;
  userId: string;
  workspaceId?: string;
  id: string;
  agentType: AgentGoLiveType;
}): Promise<{
  ok: boolean;
  live: boolean;
  elevenLabsPhoneNumber: string | null;
  webOnly: boolean;
}> {
  const { supabase, userId, workspaceId, id, agentType } = args;
  const { data: row, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Agent not found");
  const settings = ((row.settings ?? {}) as Record<string, unknown>) || {};
  const deployedRetellId = (settings.deployedRetellAgentId as string | undefined) ?? null;
  const phoneNumber = (settings.phoneNumber as string | undefined) ?? null;
  const voiceProvider = (settings.voiceProvider as string | undefined) ?? null;
  const isOpenAiRealtime = voiceProvider === "OPENAI_REALTIME";
  const deploymentMode = (settings.deploymentMode as string | undefined) ?? null;
  const isElevenLabsNative = deploymentMode === "ELEVENLABS_NATIVE";
  const deployedElAgentId = (settings.deployedElevenLabsAgentId as string | undefined) ?? null;
  // Allow Go Live when the agent has been deployed in any form.
  // OpenAI Realtime and ElevenLabs agents have no Retell ID — skip the Retell guard.
  const activeRetellId = deployedRetellId ?? row.retell_agent_id;
  if (!activeRetellId && !isOpenAiRealtime && !isElevenLabsNative) {
    throw new Error("Deploy this agent from the builder first.");
  }
  if (isElevenLabsNative && !deployedElAgentId) {
    throw new Error("Deploy this agent from the builder first (VoxStream agent not yet created).");
  }
  // ElevenLabs web agents operate without a phone number (web-based by default).
  // Phone binding is attempted best-effort later in the ElevenLabs go-live block.
  if (!phoneNumber && !isElevenLabsNative) {
    throw new Error("Attach a phone number to the agent first.");
  }
  // Agent is live in the unified app — mark it so locally.
  await supabase
    .from("agents")
    .update({
      settings: {
        ...settings,
        dashboardAgentType: agentType,
        isLive: true,
        liveAt: new Date().toISOString(),
      },
    })
    .eq("id", id);

  // ElevenLabs phone binding result — hoisted here so it is in scope at the return.
  let elPhoneAssigned: string | null = null;
  let elPhoneWebOnly = false;

  // Always patch the webhook URL on Go Live — all flow types (receptionist,
  // lead_generation, client_qualification) need post-call events delivered
  // so the dashboard receives transcripts, call records, and analytics.
  {
    const webhookBase =
      process.env.PUBLIC_BASE_URL ||
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
    if (webhookBase) {
      try {
        // Resolve the right API key: use the client workspace's Retell key
        // when the agent was cloned to a client workspace; fall back to the
        // platform key for builder-draft agents.
        let retellKey: string | undefined;
        if (deployedRetellId) {
          // 1. Try workspace-level key in workspace_settings
          if (workspaceId) {
            const { data: ws } = await supabaseAdmin
              .from("workspace_settings")
              .select("retell_workspace_id")
              .eq("workspace_id", workspaceId)
              .maybeSingle();
            const wsKey = (ws?.retell_workspace_id as string | undefined)?.trim();
            if (wsKey?.startsWith("key_")) retellKey = wsKey;
          }
          // 2. Fall back to per-agent production key stored during clone
          if (!retellKey && userId) {
            const { data: secret } = await (supabaseAdmin as any)
              .from("agent_retell_secrets")
              .select("production_api_key")
              .eq("agent_id", id)
              .eq("user_id", userId)
              .maybeSingle();
            const agentKey = (secret?.production_api_key as string | undefined)?.trim();
            if (agentKey?.startsWith("key_")) retellKey = agentKey;
          }
        }
        await retellFetch(
          `/update-agent/${activeRetellId}`,
          { webhook_url: `${webhookBase}/api/public/voice-webhook` },
          "PATCH",
          retellKey,
        );
        console.log("[go-live] Webhook URL configured on Retell agent", activeRetellId, agentType, webhookBase);
      } catch (whErr) {
        // Best-effort — don't block Go Live if the patch fails
        console.warn("[go-live] Failed to configure webhook URL", whErr);
      }
    }

    // Patch ElevenLabs Conversational AI webhook URL on go-live and attempt phone binding.
    if (isElevenLabsNative && deployedElAgentId) {
      try {
        let elKey: string | null = process.env.ELEVENLABS_API_KEY?.trim() ?? null;
        if (workspaceId) {
          const { data: ws } = await supabaseAdmin
            .from("workspace_settings")
            .select("elevenlabs_api_key" as never)
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          const wsKey = ((ws as Record<string, unknown> | null)?.elevenlabs_api_key as string | undefined)?.trim();
          if (wsKey) elKey = wsKey;
        }
        if (elKey && webhookBase) {
          // Always include the webhook secret in the URL if configured — must match deployElevenLabsAgent.
          const elWebhookUrl = process.env.ELEVENLABS_WEBHOOK_SECRET
            ? `${webhookBase}/api/public/elevenlabs-webhook?secret=${process.env.ELEVENLABS_WEBHOOK_SECRET}`
            : `${webhookBase}/api/public/elevenlabs-webhook`;

          const elRes = await fetch(
            `https://api.elevenlabs.io/v1/convai/agents/${deployedElAgentId}`,
            {
              method: "PATCH",
              headers: { "xi-api-key": elKey, "Content-Type": "application/json" },
              body: JSON.stringify({
                platform_settings: {
                  webhook: { url: elWebhookUrl },
                },
              }),
            },
          );
          if (!elRes.ok) {
            console.warn("[go-live] ElevenLabs webhook patch failed:", elRes.status);
          } else {
            console.log("[go-live] ElevenLabs webhook configured on agent", deployedElAgentId, webhookBase);
          }

          // Best-effort phone number binding: list workspace ElevenLabs phone numbers
          // and assign the first available one to this agent.
          try {
            const phoneRes = await fetch("https://api.elevenlabs.io/v1/convai/phone-numbers", {
              headers: { "xi-api-key": elKey },
            });
            if (phoneRes.ok) {
              const phoneJson = (await phoneRes.json()) as {
                phone_numbers?: Array<{ phone_number_id: string; phone_number: string; assigned_agent?: { agent_id: string } | null }>;
              };
              const available = (phoneJson.phone_numbers ?? []).find(
                (p) => !p.assigned_agent || p.assigned_agent.agent_id === deployedElAgentId,
              );
              if (available) {
                const assignRes = await fetch(
                  `https://api.elevenlabs.io/v1/convai/phone-numbers/${available.phone_number_id}`,
                  {
                    method: "PATCH",
                    headers: { "xi-api-key": elKey, "Content-Type": "application/json" },
                    body: JSON.stringify({ agent_id: deployedElAgentId }),
                  },
                );
                if (assignRes.ok) {
                  console.log("[go-live] ElevenLabs phone number assigned", available.phone_number, deployedElAgentId);
                  elPhoneAssigned = available.phone_number;
                  await supabase
                    .from("agents")
                    .update({
                      settings: {
                        ...settings,
                        dashboardAgentType: agentType,
                        isLive: true,
                        liveAt: new Date().toISOString(),
                        elevenLabsPhoneNumber: available.phone_number,
                      },
                    } as never)
                    .eq("id", id);
                } else {
                  console.warn("[go-live] ElevenLabs phone assignment failed:", assignRes.status);
                  elPhoneWebOnly = true;
                }
              } else {
                console.log("[go-live] No unassigned ElevenLabs phone numbers — agent operates in web-only mode");
                elPhoneWebOnly = true;
              }
            }
          } catch (phoneErr) {
            console.warn("[go-live] ElevenLabs phone binding skipped:", (phoneErr as Error).message);
            elPhoneWebOnly = true;
          }
        }
      } catch (elErr) {
        console.warn("[go-live] Failed to configure ElevenLabs webhook", elErr);
      }
    }

    // Register Cal.com webhook for HyperStream (OpenAI Realtime) agents that
    // have booking enabled. The webhook keeps calendar_bookings in sync when
    // Cal.com fires BOOKING_CREATED / BOOKING_RESCHEDULED / BOOKING_CANCELLED.
    // This is workspace-level — safe to call for any provider; Cal.com skips
    // registration if the webhook URL is already registered.
    if (isOpenAiRealtime && workspaceId && webhookBase) {
      const bookingEnabled =
        (settings.booking as Record<string, unknown> | undefined)?.enabled === true;
      if (bookingEnabled) {
        try {
          const { registerCalcomWebhook } = await import(
            "@/lib/providers/calcom/webhook-register.server"
          );
          const calResult = await registerCalcomWebhook({
            workspaceId,
            subscriberUrl: `${webhookBase}/api/public/calcom-webhook/${workspaceId}`,
          });
          if (calResult.ok) {
            console.log(
              "[go-live] Cal.com webhook registered for HyperStream agent",
              { created: calResult.created, webhookId: calResult.webhookId },
            );
          } else {
            console.warn("[go-live] Cal.com webhook registration skipped:", calResult.message);
          }
        } catch (calErr) {
          console.warn("[go-live] Cal.com webhook registration error:", calErr);
        }
      }
    }
  }

  return { ok: true, live: true, elevenLabsPhoneNumber: elPhoneAssigned, webOnly: elPhoneWebOnly };
}
