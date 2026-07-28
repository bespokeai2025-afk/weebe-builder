/**
 * Agent Health — workspace-scoped, user-facing health summary for the
 * currently live voice agent(s). Computes friendly status badges
 * (operational / warning / failed / not_configured / test_required) from:
 *   - the WEBEE agents table (live + deployed agents)
 *   - the voice provider API (agent exists, voice, model, webhook, recording)
 *   - provider phone-number bindings (inbound / outbound routing)
 *   - the webhook event ledger (recent deliveries processed)
 *   - recent call evidence (recording, transcript, post-call extraction)
 *   - calendar tool configuration on the deployed conversation flow
 *
 * Never exposes API keys or raw provider JSON to the client.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { retellFetch, RetellApiError } from "@/lib/providers/retell/client.server";

export type HealthStatus =
  | "operational"
  | "warning"
  | "failed"
  | "not_configured"
  | "test_required";

export interface HealthItem {
  key: string;
  label: string;
  status: HealthStatus;
  detail: string;
}

export interface AgentHealthReport {
  agentId: string;
  agentName: string;
  deployedAgentName: string | null;
  items: HealthItem[];
  lastSuccessfulCallAt: string | null;
  checkedAt: string;
}

function item(key: string, label: string, status: HealthStatus, detail: string): HealthItem {
  return { key, label, status, detail };
}

async function resolveRetellKey(workspaceId: string): Promise<string | undefined> {
  const { data } = await supabaseAdmin
    .from("workspace_settings")
    .select("retell_workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const wsKey = ((data as any)?.retell_workspace_id as string | undefined)?.trim();
  return wsKey || process.env.RETELL_API_KEY || undefined;
}

interface RetellPhone {
  phone_number: string;
  nickname?: string;
  inbound_agents?: Array<{ agent_id: string }>;
  outbound_agents?: Array<{ agent_id: string }>;
  inbound_agent_id?: string | null;
  outbound_agent_id?: string | null;
}

function phoneBoundTo(p: RetellPhone, agentId: string): { inbound: boolean; outbound: boolean } {
  const inbound =
    p.inbound_agent_id === agentId ||
    (p.inbound_agents ?? []).some((a) => a.agent_id === agentId);
  const outbound =
    p.outbound_agent_id === agentId ||
    (p.outbound_agents ?? []).some((a) => a.agent_id === agentId);
  return { inbound, outbound };
}

async function buildReport(
  workspaceId: string,
  agentRow: {
    id: string;
    name: string;
    settings: Record<string, unknown>;
  },
  retellKey: string | undefined,
  phones: RetellPhone[] | null,
): Promise<AgentHealthReport> {
  const s = agentRow.settings ?? {};
  const deployedId =
    (s.deployedRetellAgentId as string | undefined) || (s.agentId as string | undefined) || null;
  const configuredPhone = (s.phoneNumber as string | undefined) || null;
  const items: HealthItem[] = [];

  // ── Provider agent + voice + model + webhook + recording ──────────────────
  let providerAgent: Record<string, any> | null = null;
  let flow: Record<string, any> | null = null;

  if (!deployedId) {
    items.push(item("agent", "Agent Status", "not_configured", "This agent has not been deployed yet."));
  } else if (!retellKey) {
    items.push(item("agent", "Agent Status", "not_configured", "No voice provider credentials are configured for this workspace."));
  } else {
    try {
      providerAgent = await retellFetch<Record<string, any>>(
        `/get-agent/${deployedId}`,
        undefined,
        "GET",
        retellKey,
      );
      items.push(item("agent", "Agent Status", "operational", "Deployed and reachable with this workspace's credentials."));
    } catch (err) {
      const notFound = err instanceof RetellApiError && err.status === 404;
      items.push(
        item(
          "agent",
          "Agent Status",
          "failed",
          notFound
            ? "The deployed agent no longer exists at the voice provider."
            : "The voice provider could not be reached with this workspace's credentials.",
        ),
      );
    }

    const flowId = providerAgent?.response_engine?.conversation_flow_id as string | undefined;
    if (flowId) {
      try {
        flow = await retellFetch<Record<string, any>>(
          `/get-conversation-flow/${flowId}`,
          undefined,
          "GET",
          retellKey,
        );
      } catch {
        flow = null;
      }
    }
  }

  // Voice
  const voiceId = (providerAgent?.voice_id as string | undefined) ?? (s.voiceId as string | undefined);
  if (voiceId) {
    const pretty = voiceId.replace(/^11labs-/, "");
    const isEleven = voiceId.startsWith("11labs-") || voiceId.startsWith("custom_voice_");
    items.push(
      item(
        "voice",
        "Voice",
        "operational",
        isEleven ? `ElevenLabs — ${pretty}` : pretty,
      ),
    );
  } else {
    items.push(item("voice", "Voice", "not_configured", "No voice has been selected."));
  }

  // Language model
  const model =
    (flow?.model_choice?.model as string | undefined) ??
    (s.model as string | undefined) ??
    null;
  items.push(
    model
      ? item("model", "Language Model", "operational", `${model} — Connected`)
      : item("model", "Language Model", "not_configured", "No language model is configured."),
  );

  // ── Phone / telephony ──────────────────────────────────────────────────────
  if (!configuredPhone) {
    items.push(item("phone", "Phone Number", "not_configured", "No phone number is assigned to this agent."));
    items.push(item("inbound", "Inbound Calling", "not_configured", "Assign a phone number to enable inbound calls."));
    items.push(item("outbound", "Outbound Calling", "not_configured", "Assign a phone number to enable outbound calls."));
  } else if (!phones) {
    items.push(item("phone", "Phone Number", "warning", `${configuredPhone} — could not verify with the provider right now.`));
    items.push(item("inbound", "Inbound Calling", "test_required", "Provider verification unavailable."));
    items.push(item("outbound", "Outbound Calling", "test_required", "Provider verification unavailable."));
  } else {
    const match = phones.find((p) => p.phone_number === configuredPhone);
    if (!match) {
      items.push(item("phone", "Phone Number", "failed", `${configuredPhone} was not found in this workspace's provider account.`));
      items.push(item("inbound", "Inbound Calling", "failed", "The assigned number does not exist at the provider."));
      items.push(item("outbound", "Outbound Calling", "failed", "The assigned number does not exist at the provider."));
    } else {
      items.push(item("phone", "Phone Number", "operational", `${configuredPhone} — Connected`));
      const bound = deployedId ? phoneBoundTo(match, deployedId) : { inbound: false, outbound: false };
      items.push(
        bound.inbound
          ? item("inbound", "Inbound Calling", "operational", "Inbound calls route to this agent.")
          : item("inbound", "Inbound Calling", "failed", "Inbound calls to this number do not route to this agent."),
      );
      // Outbound calls specify the agent explicitly at dial time, so a missing
      // outbound binding is not a failure — the binding just sets the default.
      items.push(
        bound.outbound
          ? item("outbound", "Outbound Calling", "operational", "Outbound calls are placed as this agent.")
          : item("outbound", "Outbound Calling", "operational", "Outbound calls are placed per-call with this agent selected."),
      );
    }
  }

  // ── Recording / transcription ──────────────────────────────────────────────
  const storage = providerAgent?.data_storage_setting as string | undefined;
  const recordingOn = !storage || storage === "everything";
  items.push(
    providerAgent
      ? item(
          "recording",
          "Recording",
          recordingOn ? "operational" : "warning",
          recordingOn ? "Enabled" : `Provider storage is limited (${storage}).`,
        )
      : item("recording", "Recording", "test_required", "Verify with a test call."),
  );

  const webhookEvents = (providerAgent?.webhook_events as string[] | undefined) ?? [];
  const liveTranscript = webhookEvents.includes("transcript_updated");
  items.push(
    providerAgent
      ? item(
          "transcription",
          "Live Transcription",
          liveTranscript ? "operational" : "warning",
          liveTranscript ? "Working" : "Final transcripts only — live transcript events are not enabled.",
        )
      : item("transcription", "Live Transcription", "test_required", "Verify with a test call."),
  );

  // ── Webhooks ───────────────────────────────────────────────────────────────
  const expectedBase = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const webhookUrl = (providerAgent?.webhook_url as string | undefined) ?? null;
  const { data: recentEvents } = await supabaseAdmin
    .from("retell_webhook_events")
    .select("processing_status, received_at")
    .eq("workspace_id", workspaceId)
    .order("received_at", { ascending: false })
    .limit(20);
  const eventRows = (recentEvents ?? []) as Array<{ processing_status: string | null; received_at: string }>;
  const processedCount = eventRows.filter((e) => e.processing_status === "processed").length;
  if (!webhookUrl && providerAgent) {
    items.push(item("webhooks", "Webhooks", "failed", "No webhook URL is configured on the deployed agent."));
  } else if (webhookUrl && expectedBase && !webhookUrl.startsWith(expectedBase)) {
    items.push(item("webhooks", "Webhooks", "warning", "The agent's webhook points to a different destination than this platform."));
  } else if (eventRows.length > 0 && processedCount === 0) {
    items.push(item("webhooks", "Webhooks", "failed", "Recent webhook deliveries are failing to process."));
  } else if (eventRows.length > 0) {
    items.push(item("webhooks", "Webhooks", "operational", "Healthy — recent events delivered and processed."));
  } else {
    items.push(item("webhooks", "Webhooks", "test_required", "Configured, but no events received yet. Verify with a test call."));
  }

  // ── Calendar booking ───────────────────────────────────────────────────────
  const flowTools = (flow?.tools as Array<Record<string, any>> | undefined) ?? [];
  const calTools = flowTools.filter(
    (t) => t.type === "check_availability_cal" || t.type === "book_appointment_cal",
  );
  if (calTools.length > 0) {
    const complete = calTools.every((t) => t.event_type_id && t.cal_api_key);
    items.push(
      complete
        ? item("calendar", "Calendar Booking", "operational", "Live availability check and in-call booking are configured.")
        : item("calendar", "Calendar Booking", "failed", "Calendar tools are attached but missing their event type or credentials."),
    );
  } else if (flow) {
    items.push(item("calendar", "Calendar Booking", "not_configured", "No calendar tools are attached to this agent."));
  } else {
    items.push(item("calendar", "Calendar Booking", "test_required", "Verify with a test call."));
  }

  // ── CRM / lead capture + post-call evidence from recent calls ─────────────
  const { data: recentCalls } = deployedId
    ? await supabaseAdmin
        .from("calls")
        .select("lead_id, recording_url, transcript, call_summary, call_status, created_at")
        .eq("workspace_id", workspaceId)
        .eq("agent_id", deployedId)
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [] as any[] };
  const callRows = (recentCalls ?? []) as Array<{
    lead_id: string | null;
    recording_url: string | null;
    transcript: string | null;
    call_summary: string | null;
    call_status: string | null;
    created_at: string;
  }>;

  if (callRows.length === 0) {
    items.push(item("crm", "CRM Integration", "test_required", "No calls recorded yet — verify with a test call."));
    items.push(item("extraction", "Post-Call Data", "test_required", "No calls recorded yet — verify with a test call."));
  } else {
    const withLead = callRows.filter((c) => c.lead_id).length;
    items.push(
      withLead > 0
        ? item("crm", "CRM Integration", "operational", "Recent calls are linked to lead records.")
        : item("crm", "CRM Integration", "warning", "Recent calls are not linked to any lead records."),
    );
    const withExtraction = callRows.filter((c) => c.transcript && c.call_summary).length;
    const withRecording = callRows.filter((c) => c.recording_url).length;
    items.push(
      withExtraction > 0 && withRecording > 0
        ? item("extraction", "Post-Call Data", "operational", "Recordings, transcripts and summaries are being captured.")
        : item("extraction", "Post-Call Data", "warning", "Some recent calls are missing recordings, transcripts or summaries."),
    );
  }

  const lastSuccess =
    callRows.find((c) => c.call_status === "completed")?.created_at ?? null;

  return {
    agentId: agentRow.id,
    agentName: agentRow.name,
    deployedAgentName: (s.deployedAgentName as string | undefined) ?? null,
    items,
    lastSuccessfulCallAt: lastSuccess,
    checkedAt: new Date().toISOString(),
  };
}

export const getAgentHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AgentHealthReport[]> => {
    const { supabase, workspaceId } = context as unknown as {
      supabase: any;
      workspaceId: string;
    };

    if (!workspaceId) throw new Error("No active workspace");

    // RLS-scoped read, hard-pinned to the caller's active workspace.
    const { data, error } = await supabase
      .from("agents")
      .select("id, name, settings, workspace_id")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as Array<{ id: string; name: string; settings: any; workspace_id: string }>)
      .filter((r) => r.workspace_id === workspaceId)
      .filter((r) => {
        const s = (r.settings ?? {}) as Record<string, unknown>;
        return s.isLive === true && s.archived !== true && !!(s.deployedRetellAgentId || s.agentId);
      })
      .slice(0, 5);

    if (rows.length === 0) return [];

    const retellKey = await resolveRetellKey(workspaceId);
    let phones: RetellPhone[] | null = null;
    if (retellKey) {
      try {
        phones = await retellFetch<RetellPhone[]>("/list-phone-numbers", undefined, "GET", retellKey);
      } catch {
        phones = null;
      }
    }

    const reports: AgentHealthReport[] = [];
    for (const row of rows) {
      reports.push(
        await buildReport(workspaceId, { id: row.id, name: row.name, settings: row.settings ?? {} }, retellKey, phones),
      );
    }
    return reports;
  });
