/**
 * Public ElevenLabs Conversational AI webhook receiver.
 *
 * ElevenLabs posts a `post_call_transcript` event after each conversation ends.
 * Security: a shared secret appended as `?secret=` in the registered webhook URL
 * is verified on every request. ElevenLabs does not currently provide HMAC signing;
 * the URL-embedded secret is the compensating control.
 *
 * Post-call pipeline mirrors the Retell processor:
 *   1. Resolve the platform agent that owns the ElevenLabs agent ID.
 *   2. Upsert a `calls` row with transcript + summary.
 *   3. Run AI lead-intelligence extraction (analyzeCallTranscript).
 *   4. Update lead record if agent type is lead_gen.
 *   5. Run qualification if agent type is client_qualification.
 *   6. Dispatch CRM post-call hook.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { analyzeCallTranscript, updateLeadIntelligence } from "@/lib/lead-gen/lead-intelligence.server";
import { analyzeQualification, applyQualificationToLead } from "@/lib/qualification/qualification-engine.server";
import { dispatchCrmPostCall } from "@/lib/crm/crm-dispatch.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type ElevenLabsTranscriptEntry = {
  role: string;
  message: string;
  time_in_call_secs?: number;
};

type AgentRow = {
  id: string;
  workspace_id: string;
  name: string;
  agent_type: string;
  settings: Record<string, unknown>;
};

async function resolveAgentByElId(elAgentId: string): Promise<AgentRow | null> {
  // Use the proven PostgREST JSON extraction filter pattern used elsewhere in the repo
  // (e.g. retell-key-lookup.ts, book.ts): settings->>field.eq.{value}
  const { data: matched, error } = await supabaseAdmin
    .from("agents")
    .select("id, workspace_id, name, agent_type, settings")
    .or(`settings->>deployedElevenLabsAgentId.eq.${elAgentId}` as never)
    .maybeSingle();
  if (error || !matched) return null;
  return {
    id: matched.id as string,
    workspace_id: matched.workspace_id as string,
    name: matched.name as string,
    agent_type: matched.agent_type as string,
    settings: (matched.settings ?? {}) as Record<string, unknown>,
  };
}

async function upsertElCall(conversationId: string, row: Record<string, unknown>) {
  const { data: existing } = await supabaseAdmin
    .from("calls")
    .select("id")
    .eq("retell_call_id", conversationId)
    .maybeSingle();
  if (existing?.id) {
    return supabaseAdmin.from("calls").update(row as never).eq("id", existing.id as string);
  }
  return supabaseAdmin.from("calls").insert({ ...row, retell_call_id: conversationId } as never);
}

async function runPostCallPipeline(
  agent: AgentRow,
  conversationId: string,
  transcript: string,
  summary: string | null,
  durationSeconds: number,
  contactPhone: string | null,
) {
  const s = agent.settings;
  const agentType = (s.dashboardAgentType as string | undefined) ?? agent.agent_type ?? "lead_gen";

  // 1. AI transcript analysis
  let intelligence: Awaited<ReturnType<typeof analyzeCallTranscript>> | null = null;
  try {
    intelligence = await analyzeCallTranscript(transcript, null, summary);
    if (intelligence) {
      await supabaseAdmin
        .from("calls")
        .update({
          sentiment: intelligence.sentiment ?? null,
          call_summary: intelligence.summary ?? summary,
          call_outcome: intelligence.summary ?? summary,
        } as never)
        .eq("retell_call_id", conversationId);
    }
  } catch (e) {
    console.warn("[elevenlabs-webhook] AI analysis failed:", (e as Error).message);
  }

  // 2. Lead intelligence update (requires phone)
  if (intelligence && contactPhone && (agentType === "lead_generation" || agentType === "lead_gen")) {
    try {
      const leadGen = (s.leadGen as Record<string, unknown> | undefined) ?? {};
      await updateLeadIntelligence(agent.workspace_id, contactPhone, intelligence, {
        agentName: agent.name,
        postCallMappings: (leadGen.postCallMappings as Record<string, string> | undefined) ?? {},
        customScoringRules: (leadGen.customScoringRules as Array<{ variable: string; points: number }> | undefined) ?? [],
      });
    } catch (e) {
      console.warn("[elevenlabs-webhook] Lead intelligence update failed:", (e as Error).message);
    }
  }

  // 3. Qualification pipeline (requires phone)
  if (contactPhone && agentType === "client_qualification") {
    try {
      const qualResult = await analyzeQualification(transcript, null);
      if (qualResult) {
        await applyQualificationToLead(agent.workspace_id, contactPhone, qualResult, {
          agentName: agent.name,
          qualifySettings: (s.qualify as Record<string, unknown> | undefined) as never,
        });
      }
    } catch (e) {
      console.warn("[elevenlabs-webhook] Qualification pipeline failed:", (e as Error).message);
    }
  }

  // 4. CRM dispatch
  try {
    await dispatchCrmPostCall(
      agent.workspace_id,
      { phone: contactPhone ?? "unknown", name: null },
      {
        phone: contactPhone ?? "unknown",
        agentName: agent.name,
        summary: intelligence?.summary ?? summary ?? null,
        durationSeconds,
        sentiment: intelligence?.sentiment ?? null,
        callId: conversationId,
        calledAt: new Date().toISOString(),
      },
    );
  } catch (e) {
    console.warn("[elevenlabs-webhook] CRM dispatch failed:", (e as Error).message);
  }
}

export const Route = createFileRoute("/api/public/elevenlabs-webhook")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },

      POST: async ({ request }) => {
        // ── Secret verification ───────────────────────────────────────────────
        // ElevenLabs does not provide HMAC signing; the shared secret embedded in
        // the webhook URL is the compensating control. In production the secret is
        // required — fail closed so misconfiguration cannot leave the endpoint open.
        const url = new URL(request.url);
        const incomingSecret = url.searchParams.get("secret");
        const configuredSecret = process.env.ELEVENLABS_WEBHOOK_SECRET?.trim() || null;
        const isProduction = process.env.NODE_ENV === "production";
        if (!configuredSecret && isProduction) {
          console.error("[elevenlabs-webhook] ELEVENLABS_WEBHOOK_SECRET is not set — rejecting all requests in production");
          return json({ ok: false, error: "Webhook secret not configured" }, 503);
        }
        if (configuredSecret && incomingSecret !== configuredSecret) {
          console.warn("[elevenlabs-webhook] Secret mismatch — rejecting request");
          return json({ ok: false, error: "Unauthorized" }, 403);
        }
        if (!configuredSecret && !isProduction) {
          console.warn("[elevenlabs-webhook] ELEVENLABS_WEBHOOK_SECRET not set — accepting request in dev mode (set secret for production)");
        }

        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          console.warn("[elevenlabs-webhook] Invalid JSON body");
          return json({ ok: false, error: "Invalid JSON" }, 400);
        }

        console.log("[elevenlabs-webhook] Received", JSON.stringify(body).slice(0, 500));

        try {
          const eventType = body.type as string | undefined;
          if (eventType !== "post_call_transcript" && eventType !== "conversation_end") {
            return json({ ok: true, ignored: true });
          }

          const data = (body.data ?? body) as Record<string, unknown>;
          const elAgentId = data.agent_id as string | undefined;
          const conversationId = data.conversation_id as string | undefined;
          const transcriptRaw = data.transcript as ElevenLabsTranscriptEntry[] | undefined;
          const analysis = (data.analysis ?? {}) as Record<string, unknown>;

          if (!elAgentId || !conversationId) {
            console.warn("[elevenlabs-webhook] Missing agent_id or conversation_id");
            return json({ ok: true });
          }

          if (!transcriptRaw || transcriptRaw.length === 0) {
            console.log("[elevenlabs-webhook] Empty transcript — skipping pipeline");
            return json({ ok: true });
          }

          const agent = await resolveAgentByElId(elAgentId);
          if (!agent) {
            console.warn("[elevenlabs-webhook] No agent found for EL agent ID:", elAgentId);
            return json({ ok: true });
          }

          const durationSeconds = Math.round(
            transcriptRaw[transcriptRaw.length - 1]?.time_in_call_secs ?? 0,
          );
          const fullTranscript = transcriptRaw
            .map((t) => `${t.role === "agent" ? "Assistant" : "User"}: ${t.message}`)
            .join("\n");
          const callSummary = (analysis.transcript_summary as string | undefined) ?? null;
          const contactPhone = (data.caller_id as string | undefined) ?? null;

          // ── Upsert call record ──────────────────────────────────────────────
          const callRow: Record<string, unknown> = {
            workspace_id: agent.workspace_id,
            agent_id: agent.id,
            agent_name: agent.name,
            call_type: "inbound",
            call_status: "completed",
            to_number: "unknown",
            from_number: contactPhone ?? null,
            started_at: new Date(Date.now() - durationSeconds * 1000).toISOString(),
            ended_at: new Date().toISOString(),
            duration_seconds: durationSeconds,
            transcript: fullTranscript,
            call_summary: callSummary,
            call_outcome: callSummary,
            call_successful: true,
            in_voicemail: false,
          };
          const { error: callErr } = await upsertElCall(conversationId, callRow);
          if (callErr) {
            console.error("[elevenlabs-webhook] Call upsert failed:", callErr.message);
            return json({ ok: false, error: "db error" }, 500);
          }
          console.log("[elevenlabs-webhook] Call stored", { agentId: agent.id, conversationId, durationSeconds });

          // ── Post-call pipeline (best-effort, async) ─────────────────────────
          void runPostCallPipeline(
            agent,
            conversationId,
            fullTranscript,
            callSummary,
            durationSeconds,
            contactPhone,
          );
        } catch (err) {
          console.error("[elevenlabs-webhook] Processing error:", err);
        }

        return json({ ok: true });
      },
    },
  },
});
