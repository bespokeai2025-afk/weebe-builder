import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildBookingTools } from "@/lib/calendar/booking-tools.server";
import {
  getRetailRetellApiKey,
  getRetailWorkspaceId,
  isRetailDeployEnabled,
} from "@/lib/deploy/config.server";
import { registerCalcomWebhook } from "@/lib/providers/calcom/webhook-register.server";

/**
 * Look up whether the signed-in user has Cal.com configured at the workspace
 * level. Returns the tool definitions to attach (or null when not connected).
 */
async function maybeBuildBookingToolsForWorkspace(workspaceId: string) {
  const { data } = await supabaseAdmin
    .from("workspace_settings")
    .select("calcom_api_key")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  // Attach booking tools whenever a Cal.com API key exists. The endpoints
  // auto-pick the first active synced event type when no default is set.
  if (!data?.calcom_api_key) return null;
  return buildBookingTools();
}

const RETELL_BASE = "https://api.retellai.com";

function resolveProductionApiKey(explicitKey: string | undefined): string {
  const trimmed = explicitKey?.trim();
  if (trimmed) return trimmed;
  const retailKey = getRetailRetellApiKey();
  if (retailKey) return retailKey;
  throw new Error(
    "A production Retell API key is required. Provide one or set RETELL_RETAIL_API_KEY in .env.",
  );
}

class RetellApiError extends Error {
  constructor(
    public path: string,
    public status: number,
    message: string,
  ) {
    super(`Retell ${path} ${status}: ${message}`);
    this.name = "RetellApiError";
  }
}

function isRetellAuthError(error: unknown) {
  return error instanceof RetellApiError && (error.status === 401 || error.status === 403);
}

function maskApiKey(key: string) {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return `${trimmed.slice(0, 4)}…`;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

function readProductionRetellApiKey(settings: unknown) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const value = (settings as Record<string, unknown>).productionRetellApiKey;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function loadStoredProductionRetellApiKey(agentRowId: string | undefined, userId: string) {
  if (!agentRowId) return null;
  const admin = supabaseAdmin as any;
  const { data, error } = await admin
    .from("agent_retell_secrets")
    .select("production_api_key")
    .eq("agent_id", agentRowId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.production_api_key === "string" ? data.production_api_key : null;
}

async function rememberProductionRetellApiKey(
  agentRowId: string | undefined,
  userId: string,
  apiKey: string | undefined,
) {
  const trimmed = apiKey?.trim();
  if (!agentRowId || !trimmed) return;
  const admin = supabaseAdmin as any;
  const masked = maskApiKey(trimmed);
  const { error: secretErr } = await admin.from("agent_retell_secrets").upsert(
    {
      user_id: userId,
      agent_id: agentRowId,
      production_api_key: trimmed,
      production_api_key_masked: masked,
    },
    { onConflict: "user_id,agent_id" },
  );
  if (secretErr) throw new Error(secretErr.message);
  const { data, error: readErr } = await supabaseAdmin
    .from("agents")
    .select("settings")
    .eq("id", agentRowId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  const settings =
    data?.settings && typeof data.settings === "object" && !Array.isArray(data.settings)
      ? { ...(data.settings as Record<string, unknown>) }
      : {};
  delete settings.productionRetellApiKey;
  const next = {
    ...settings,
    productionRetellApiKeyMasked: masked,
    productionRetellApiKeySavedAt: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin
    .from("agents")
    .update({ settings: next })
    .eq("id", agentRowId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

async function retellFetchForAgent(
  path: string,
  body: unknown,
  method: string,
  userId: string,
  agentRowId?: string,
  explicitApiKey?: string,
  workspaceId?: string,
) {
  const explicit = explicitApiKey?.trim() || undefined;
  let stored = explicit ? null : await loadStoredProductionRetellApiKey(agentRowId, userId);
  // Fall back to the admin-provisioned workspace-level production API key.
  if (!explicit && !stored && workspaceId) {
    const { data: ws } = await supabaseAdmin
      .from("workspace_settings")
      .select("retell_workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const wsKey = (ws?.retell_workspace_id as string | undefined)?.trim();
    if (wsKey && wsKey.startsWith("key_")) stored = wsKey;
  }
  const resp = await retellFetch(path, body, method, explicit ?? stored ?? undefined);
  if (explicit) await rememberProductionRetellApiKey(agentRowId, userId, explicit);
  return resp;
}

async function retellFetch(path: string, body: unknown, method = "POST", overrideApiKey?: string) {
  const apiKey = overrideApiKey || process.env.RETELL_API_KEY;
  if (!apiKey) throw new Error("RETELL_API_KEY is not configured");
  const res = await fetch(`${RETELL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const message =
      typeof parsed === "object" && parsed && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : typeof parsed === "object" && parsed && "error_message" in parsed
          ? String((parsed as { error_message: unknown }).error_message)
          : text || res.statusText;
    throw new RetellApiError(path, res.status, message);
  }
  return parsed as Record<string, unknown>;
}

// Fields Retell rejects on create/PATCH (read-only / system-managed).
const READONLY_KEYS = [
  "conversation_flow_id",
  "agent_id",
  "version",
  "version_title",
  "is_published",
  "last_modification_timestamp",
  "base_version",
  "published_version",
  "channel",
  "llm_id",
  "response_engine_id",
];

function stripKeys(obj: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k)) continue;
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function redactRetellPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRetellPayload);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/api[_-]?key|authorization|password|secret|token/i.test(key)) out[key] = "[REDACTED]";
    else out[key] = redactRetellPayload(child);
  }
  return out;
}

/**
 * Compare critical transfer fields between what we sent and what Retell
 * stored. Only flags fields we explicitly set — Retell adds defaults to many
 * optional fields (e.g. `ring_duration_ms`, `transfer_option.on_hold_music`)
 * so a naive deep-equal produces false positives that block valid deploys.
 *
 * Hard-fail fields (cause deploy error): `type`, `transfer_destination`.
 * Soft-warn fields (logged only): everything else we sent.
 */
function transferSchemaMismatches(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  const HARD = ["type", "transfer_destination"] as const;
  const SOFT = [
    "transfer_option",
    "ignore_e164_validation",
    "custom_sip_headers",
    "extension_dial_string",
    "cold_transfer_mode",
    "show_transferee_as_caller",
    "transfer_ring_duration_ms",
  ] as const;
  const hard: string[] = [];
  const soft: string[] = [];
  for (const f of HARD) {
    if (expected[f] !== undefined && JSON.stringify(expected[f]) !== JSON.stringify(actual[f]))
      hard.push(f);
  }
  for (const f of SOFT) {
    if (expected[f] !== undefined && JSON.stringify(expected[f]) !== JSON.stringify(actual[f]))
      soft.push(f);
  }
  return { hard, soft };
}

export const deployAgentToRetell = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      agent: Record<string, unknown>;
      agentId?: string;
      conversationFlowId?: string;
      mode?: "create" | "update";
      bookingConfig?: {
        enabled?: boolean;
        instructions?: string;
        eventTypeId?: string;
        workingHours?: Record<string, Array<[string, string]>>;
      };
      /**
       * Per-function-node Cal.com tool config from the builder. Each entry
       * corresponds to one function node whose toolId matches a Cal.com preset.
       * On deploy these become Retell-native `check_availability_cal` /
       * `book_appointment_cal` tools (or our URL tools for cancel/reschedule).
       */
      calToolOverrides?: Array<{
        nodeId: string;
        preset:
          | "check_availability"
          | "book_appointment"
          | "reschedule_appointment"
          | "cancel_appointment";
        name?: string;
        description?: string;
        apiKey?: string;
        eventTypeId?: string;
        timezone?: string;
      }>;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const agent = { ...data.agent };
    const cf = { ...((agent.conversationFlow as Record<string, unknown>) ?? {}) };
    delete agent.conversationFlow;

    const mode: "create" | "update" = data.mode ?? (data.agentId ? "update" : "create");
    if (mode === "update" && !data.agentId) {
      throw new Error("Update requires an existing agent ID. Use Create to make a new agent.");
    }

    // ---- Auto-attach booking tools when this user has Cal.com connected ----
    const bookingEnabled = data.bookingConfig?.enabled !== false;
    const wsId = context.workspaceId;
    if (!wsId) throw new Error("No active workspace");

    // Resolve which Retell key to use for all builder API calls.
    // If the workspace has its own key configured (admin-provisioned), use it
    // so custom ElevenLabs voices and workspace-specific resources work in
    // the builder. Falls back to the platform RETELL_API_KEY when not set.
    let builderKey: string | undefined;
    {
      const { data: wsSettings } = await supabaseAdmin
        .from("workspace_settings")
        .select("retell_workspace_id")
        .eq("workspace_id", wsId)
        .maybeSingle();
      const wk = wsSettings?.retell_workspace_id?.trim();
      if (wk && wk.startsWith("key_")) builderKey = wk;
    }

    const bookingTools = bookingEnabled ? await maybeBuildBookingToolsForWorkspace(wsId) : null;
    const calendarConnected = bookingTools !== null;

    // ---- Build per-node Cal.com tools in Retell-native format ----
    const perNodeTools: Array<Record<string, unknown>> = [];
    const nodeToolIdRemap = new Map<string, string>();

    if (bookingEnabled && data.calToolOverrides?.length) {
      const { data: ws } = await supabaseAdmin
        .from("workspace_settings")
        .select("calcom_api_key, default_event_type_id, timezone")
        .eq("workspace_id", wsId)
        .maybeSingle();

      const PUBLIC_BASE_URL =
        process.env.PUBLIC_BASE_URL ||
        (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
      const base = `${PUBLIC_BASE_URL}/api/public/retell`;

      // Build a name→tool lookup for cf.tools so we can extract event_type_id
      // from an existing native Cal tool when the node itself doesn't carry it.
      const cfToolByName = new Map<string, Record<string, unknown>>();
      if (Array.isArray(cf.tools)) {
        for (const t of cf.tools as Array<Record<string, unknown>>) {
          if (t.name) cfToolByName.set(String(t.name), t);
          // Also index by tool_id in case name differs (e.g. "check_availability_cal")
          if (t.tool_id) cfToolByName.set(String(t.tool_id), t);
        }
      }

      for (const ov of data.calToolOverrides) {
        const apiKey = (ov.apiKey?.trim() || ws?.calcom_api_key || "").trim();

        // Try to extract event_type_id from: node data → workspace default →
        // existing CF native tool (e.g. "check_availability_cal") as last resort.
        const existingCalTool =
          cfToolByName.get(`${ov.preset}_cal`) ??
          cfToolByName.get(ov.preset ?? "") ??
          cfToolByName.get(`${ov.name ?? ""}_cal`);
        const rawEventTypeId =
          ov.eventTypeId ||
          ws?.default_event_type_id ||
          existingCalTool?.event_type_id;
        const eventTypeId = Number(rawEventTypeId || 0) || 0;
        const timezone =
          ov.timezone?.trim() ||
          (existingCalTool?.timezone as string | undefined) ||
          ws?.timezone ||
          "America/Los_Angeles";

        const defaultNames: Record<string, string> = {
          check_availability: "check_availability",
          book_appointment: "book_appointment",
          reschedule_appointment: "reschedule_appointment",
          cancel_appointment: "cancel_appointment",
        };
        const name = ov.name?.trim() || defaultNames[ov.preset];
        const description = ov.description?.trim() || "";

        if (ov.preset === "check_availability") {
          if (!apiKey || !eventTypeId) {
            console.warn("[retell-deploy] Skipping check_availability_cal override — missing apiKey or eventTypeId", { apiKey: apiKey ? "set" : "missing", eventTypeId });
            continue;
          }
          nodeToolIdRemap.set(ov.nodeId, name);
          perNodeTools.push({
            type: "check_availability_cal",
            name,
            ...(description ? { description } : {}),
            cal_api_key: apiKey,
            event_type_id: eventTypeId,
            timezone,
          });
        } else if (ov.preset === "book_appointment") {
          if (!apiKey || !eventTypeId) {
            console.warn("[retell-deploy] Skipping book_appointment_cal override — missing apiKey or eventTypeId", { apiKey: apiKey ? "set" : "missing", eventTypeId });
            continue;
          }
          nodeToolIdRemap.set(ov.nodeId, name);
          perNodeTools.push({
            type: "book_appointment_cal",
            name,
            ...(description ? { description } : {}),
            cal_api_key: apiKey,
            event_type_id: eventTypeId,
            timezone,
          });
        } else if (ov.preset === "reschedule_appointment") {
          perNodeTools.push({
            type: "custom",
            name,
            description:
              description ||
              "Move an existing appointment to a new start time. Use after check_availability_cal has confirmed the new slot is free.",
            url: `${base}/reschedule`,
            speak_during_execution: true,
            execution_message_description: "Rescheduling the appointment",
            parameters: {
              type: "object",
              properties: {
                booking_id: { type: "string", description: "Cal.com booking uid" },
                new_start: { type: "string", description: "ISO 8601 new start time" },
                reason: { type: "string", description: "Optional reason" },
              },
              required: ["booking_id", "new_start"],
            },
          });
        } else if (ov.preset === "cancel_appointment") {
          perNodeTools.push({
            type: "custom",
            name,
            description: description || "Cancel an existing appointment by its booking id.",
            url: `${base}/cancel`,
            speak_during_execution: true,
            execution_message_description: "Cancelling the appointment",
            parameters: {
              type: "object",
              properties: {
                booking_id: { type: "string", description: "Cal.com booking uid" },
                reason: { type: "string", description: "Optional reason" },
              },
              required: ["booking_id"],
            },
          });
        }
      }

      // Rewrite function nodes' tool_id to the final tool name so Retell
      // resolves them against cf.tools.
      if (nodeToolIdRemap.size) {
        const nodes = Array.isArray(cf.nodes) ? (cf.nodes as Array<Record<string, unknown>>) : [];
        cf.nodes = nodes.map((n) => {
          const finalName = nodeToolIdRemap.get(String(n.id ?? ""));
          if (!finalName || n.type !== "function") return n;
          return { ...n, tool_id: finalName };
        });
      }
    }

    // Merge auto-attached + per-node Cal.com tools into agent.general_tools
    // AND cf.tools (Retell requires the tool exist in cf.tools for function
    // nodes to reference it by tool_id).
    const mergedTools: Array<Record<string, unknown>> = [
      ...((bookingTools ?? []) as Array<Record<string, unknown>>),
      ...perNodeTools,
    ];
    if (mergedTools.length) {
      // Per-node overrides win when names collide with auto-attached tools.
      const byName = new Map<string, Record<string, unknown>>();
      for (const t of mergedTools) byName.set(String(t.name), t);
      const finalTools = Array.from(byName.values());
      const ourNames = new Set(finalTools.map((t) => t.name as string));

      const existing = Array.isArray(agent.general_tools)
        ? (agent.general_tools as Array<Record<string, unknown>>)
        : [];
      agent.general_tools = [
        ...existing.filter((t) => !ourNames.has(t.name as string)),
        ...finalTools,
      ];
      const cfExisting = Array.isArray(cf.tools)
        ? (cf.tools as Array<Record<string, unknown>>)
        : [];
      // cf.tools entries require a `tool_id` field (Retell's conversation-flow
      // schema); use the tool name as the id since function nodes reference it.
      cf.tools = [
        ...cfExisting.filter((t) => !ourNames.has(t.name as string)),
        ...finalTools.map((t) => ({ tool_id: String(t.name), ...t })),
      ];
    }

    if (bookingTools) {
      // Append per-agent booking instructions to the global prompt.
      const instructions = data.bookingConfig?.instructions?.trim();
      const wh = data.bookingConfig?.workingHours;
      const whLines: string[] = [];
      if (wh && typeof wh === "object") {
        const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
        const names: Record<string, string> = {
          mon: "Mon",
          tue: "Tue",
          wed: "Wed",
          thu: "Thu",
          fri: "Fri",
          sat: "Sat",
          sun: "Sun",
        };
        for (const day of order) {
          const ranges = wh[day];
          if (!Array.isArray(ranges) || ranges.length === 0) {
            whLines.push(`- ${names[day]}: closed`);
          } else {
            whLines.push(
              `- ${names[day]}: ${ranges.map((r) => `${r[0]}\u2013${r[1]}`).join(", ")}`,
            );
          }
        }
      }
      if (instructions || whLines.length) {
        const existingPrompt = String(cf.global_prompt ?? "");
        const parts: string[] = [];
        if (whLines.length) {
          parts.push(
            `## Working hours\nOnly offer slots within these hours (caller's local time):\n${whLines.join("\n")}`,
          );
        }
        if (instructions) parts.push(`## Booking instructions\n${instructions}`);
        cf.global_prompt = `${existingPrompt}\n\n${parts.join("\n\n")}`.trim();
      }
    }

    // ---- Conversation flow ----
    const cfBody = stripKeys(cf, READONLY_KEYS);

    // Fix relative tool URLs: Retell requires absolute URLs for custom-type
    // tools. Tools stored from a previous import may have relative paths
    // (e.g. "/api/public/retell/availability"). Convert them to absolute so
    // Retell does not reject the conversation flow with a URL validation error.
    const PUBLIC_BASE_TOOL =
      process.env.PUBLIC_BASE_URL ||
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
    if (Array.isArray(cfBody.tools)) {
      cfBody.tools = (cfBody.tools as Array<Record<string, unknown>>).map((tool) => {
        if (tool.type === "custom" && typeof tool.url === "string" && tool.url.startsWith("/")) {
          if (!PUBLIC_BASE_TOOL) {
            console.warn("[retell-deploy] Cannot absolutize tool URL — PUBLIC_BASE_URL and REPLIT_DEV_DOMAIN are both unset. Tool:", tool.name, tool.url);
            return tool;
          }
          console.log("[retell-deploy] Absolutizing tool URL:", tool.name, tool.url, "→", `${PUBLIC_BASE_TOOL}${tool.url}`);
          return { ...tool, url: `${PUBLIC_BASE_TOOL}${tool.url}` };
        }
        return tool;
      });
    }

    // Audit: list every transfer_call node going to Retell so deployment
    // problems with transfers (silent stripping, wrong type, bad numbers)
    // are visible in worker logs.
    const cfNodes = Array.isArray(cfBody.nodes)
      ? (cfBody.nodes as Array<Record<string, unknown>>)
      : [];
    const transferNodes = cfNodes.filter((n) => n.type === "transfer_call");
    console.log(JSON.stringify(redactRetellPayload(cfBody), null, 2));
    console.log("[retell-deploy] conversation flow summary", {
      mode,
      totalNodes: cfNodes.length,
      transferNodes: transferNodes.length,
      transfers: transferNodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        transfer_destination: n.transfer_destination,
        transfer_option_type: (n.transfer_option as { type?: string } | undefined)?.type,
        ring_duration_ms: n.ring_duration_ms,
        has_edge: Boolean(n.edge),
      })),
    });

    let conversationFlowId = mode === "update" ? data.conversationFlowId : undefined;
    let cfResp: Record<string, unknown>;
    console.log("[retell-deploy] Sending CF to Retell →", mode, "tools:", (cfBody.tools as Array<Record<string,unknown>> | undefined)?.map((t) => ({ name: t.name, type: t.type, url: t.url })));
    try {
      if (mode === "update" && conversationFlowId) {
        cfResp = await retellFetch(
          `/update-conversation-flow/${conversationFlowId}`,
          cfBody,
          "PATCH",
          builderKey,
        );
      } else {
        cfResp = await retellFetch(`/create-conversation-flow`, cfBody, "POST", builderKey);
        conversationFlowId = String(cfResp.conversation_flow_id ?? "");
      }
      console.log("[retell-deploy] CF API success, conversationFlowId:", conversationFlowId);
    } catch (cfErr) {
      console.error("[retell-deploy] CF creation/update FAILED:", (cfErr as Error).message);
      throw cfErr;
    }

    // Post-deploy verification: fetch the flow Retell actually stored and
    // confirm every transfer node survived round-trip with the correct schema.
    if (transferNodes.length > 0 && conversationFlowId) {
      try {
        const deployed = (await retellFetch(
          `/get-conversation-flow/${conversationFlowId}`,
          undefined,
          "GET",
          builderKey,
        )) as Record<string, unknown>;
        const deployedNodes = Array.isArray(deployed.nodes)
          ? (deployed.nodes as Array<Record<string, unknown>>)
          : [];
        const deployedTransfers = deployedNodes.filter((n) => n.type === "transfer_call");
        const sentIds = new Set(transferNodes.map((n) => String(n.id)));
        const deployedIds = new Set(deployedTransfers.map((n) => String(n.id)));
        const stripped = [...sentIds].filter((id) => !deployedIds.has(id));
        const mismatches = transferNodes
          .map((sent) => {
            const actual = deployedTransfers.find((n) => String(n.id) === String(sent.id));
            if (!actual) return null;
            const { hard, soft } = transferSchemaMismatches(sent, actual);
            if (!hard.length && !soft.length) return null;
            return { id: sent.id, hard, soft };
          })
          .filter((x): x is { id: unknown; hard: string[]; soft: string[] } => Boolean(x));
        const hardMismatches = mismatches.filter((m) => m.hard.length > 0);
        console.log("[retell-deploy] transfer verification", {
          conversationFlowId,
          sent: transferNodes.length,
          deployed: deployedTransfers.length,
          stripped,
          mismatches,
        });
        if (stripped.length > 0 || hardMismatches.length > 0) {
          throw new Error(
            `Retell transfer verification failed. Stripped nodes: ${stripped.join(", ") || "none"}. Critical schema mismatches: ${JSON.stringify(hardMismatches)}.`,
          );
        }
      } catch (verifyErr) {
        throw new Error(`Retell transfer verification failed: ${(verifyErr as Error).message}`);
      }
    }

    // ---- Always inject webhook URL on every deployed agent ----
    const PUBLIC_BASE_URL_FOR_WEBHOOK =
      process.env.PUBLIC_BASE_URL ||
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
    if (PUBLIC_BASE_URL_FOR_WEBHOOK && !agent.webhook_url) {
      agent.webhook_url = `${PUBLIC_BASE_URL_FOR_WEBHOOK}/api/public/voice-webhook`;
    }

    // ---- Auto-inject Post-Call Analysis for booking-enabled agents ----
    if (calendarConnected || perNodeTools.length > 0) {
      const bookingAnalysisFields = [
        {
          type: "string",
          name: "booking_summary",
          description:
            "Concise summary of the customer's appointment booking including customer name, appointment reason, date/time booked, important notes, special requests, and follow-up requirements.",
          examples: [
            "Booked John Smith for a dental cleaning on 2026-06-10 at 14:00. Requested morning reminder call.",
          ],
        },
        {
          type: "boolean",
          name: "appointment_booked",
          description: "Was an appointment successfully booked during this call?",
        },
        {
          type: "string",
          name: "appointment_reason",
          description: "Reason or purpose for the appointment.",
        },
        {
          type: "string",
          name: "customer_name",
          description: "Customer's full name.",
        },
        {
          type: "string",
          name: "customer_phone",
          description: "Customer's phone number in any format mentioned.",
        },
        {
          type: "string",
          name: "appointment_date",
          description: "Booked appointment date and time as discussed on the call.",
        },
      ];
      const existingAnalysis =
        (agent.post_call_analysis_data as Array<Record<string, unknown>> | undefined) ?? [];
      const existingNames = new Set(existingAnalysis.map((f) => String(f.name)));
      agent.post_call_analysis_data = [
        ...existingAnalysis,
        ...bookingAnalysisFields.filter((f) => !existingNames.has(f.name)),
      ];
    }

    // ---- Agent ----
    let agentResp: Record<string, unknown> | undefined;
    let agentId = mode === "update" ? data.agentId : undefined;
    let voiceFallback = false;

    if (mode === "update" && agentId) {
      const updateBody = stripKeys(agent, READONLY_KEYS);
      updateBody.response_engine = {
        type: "conversation-flow",
        conversation_flow_id: conversationFlowId,
      };
      try {
        agentResp = await retellFetch(`/update-agent/${agentId}`, updateBody, "PATCH", builderKey);
      } catch (e) {
        if (/Voice .* not found/i.test((e as Error).message)) {
          updateBody.voice_id = "11labs-Adrian";
          agentResp = await retellFetch(`/update-agent/${agentId}`, updateBody, "PATCH", builderKey);
          voiceFallback = true;
        } else throw e;
      }
    }

    if (!agentResp) {
      const createBody = stripKeys(agent, READONLY_KEYS);
      createBody.response_engine = {
        type: "conversation-flow",
        conversation_flow_id: conversationFlowId,
      };
      try {
        agentResp = await retellFetch(`/create-agent`, createBody, "POST", builderKey);
      } catch (e) {
        if (/Voice .* not found/i.test((e as Error).message)) {
          createBody.voice_id = "11labs-Adrian";
          agentResp = await retellFetch(`/create-agent`, createBody, "POST", builderKey);
          voiceFallback = true;
        } else throw e;
      }
      agentId = String(agentResp.agent_id ?? "");
    }

    // ---- Auto-register Cal.com webhook when booking tools are in the flow ----
    // If the CF has any Retell-native Cal.com tools, ensure the workspace's
    // webhook is registered so booking events get forwarded to us.
    // Best-effort — failure does not block the deploy.
    const hasCfCalTools =
      Array.isArray(cfBody.tools) &&
      (cfBody.tools as Array<Record<string, unknown>>).some(
        (t) => t.type === "check_availability_cal" || t.type === "book_appointment_cal",
      );
    if (hasCfCalTools && wsId) {
      const webhookBase =
        process.env.PUBLIC_BASE_URL ||
        (process.env.REPLIT_DEV_DOMAIN
          ? `https://${process.env.REPLIT_DEV_DOMAIN}`
          : "");
      if (webhookBase) {
        try {
          const whResult = await registerCalcomWebhook({
            workspaceId: wsId,
            subscriberUrl: `${webhookBase}/api/public/calcom-webhook`,
          });
          console.log("[retell-deploy] Cal.com webhook registration:", whResult.message);
        } catch (whErr) {
          console.warn("[retell-deploy] Cal.com webhook registration failed:", whErr);
        }
      }
    }

    console.log("[retell-deploy] agent creation complete", {
      agentId,
      conversationFlowId,
      voiceFallback,
      calendarConnected,
      calWebhookRegistered: hasCfCalTools,
    });

    return {
      agentId: agentId ?? "",
      conversationFlowId: conversationFlowId ?? "",
      agentName: String((agentResp.agent_name as string | undefined) ?? ""),
      calendarConnected,
      bookingToolsAttached: calendarConnected,
      voiceFallback,
    };
  });

export const createRetellWebCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string }) => input)
  .handler(async ({ data, context }) => {
    const agentId = (data.agentId ?? "").trim();
    if (!agentId || !agentId.startsWith("agent_")) {
      throw new Error(
        `Invalid agent ID "${agentId}". Deploy the agent first to get a real ID (starts with "agent_").`,
      );
    }
    // Spend-cap gate: block the call if the user is already over their cap.
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("spend_limit_cents, spend_used_cents")
      .eq("user_id", context.userId)
      .maybeSingle();
    const limit = prof?.spend_limit_cents ?? 500;
    const used = prof?.spend_used_cents ?? 0;
    if (used >= limit) {
      throw new Error(
        `Test-call spend cap reached ($${(used / 100).toFixed(2)} of $${(limit / 100).toFixed(2)}). Ask an admin to add credits.`,
      );
    }

    // Use the same API key that was used to create the agent. The agent may
    // live in the workspace's own Retell account (retell_workspace_id), not
    // the platform account. Using the wrong key gives a 404.
    let webCallKey: string | undefined;
    const wsId = context.workspaceId;
    if (wsId) {
      const { data: wsSettings } = await supabaseAdmin
        .from("workspace_settings")
        .select("retell_workspace_id")
        .eq("workspace_id", wsId)
        .maybeSingle();
      const wk = wsSettings?.retell_workspace_id?.trim();
      if (wk && wk.startsWith("key_")) webCallKey = wk;
    }

    const resp = await retellFetch(`/v2/create-web-call`, { agent_id: agentId }, "POST", webCallKey);
    return {
      callId: String(resp.call_id ?? ""),
      accessToken: String(resp.access_token ?? ""),
    };
  });

/**
 * Fetch a Retell agent (and its conversation flow) by agent ID so the builder
 * can load an existing agent for editing.
 */
export const fetchRetellAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string }) => input)
  .handler(async ({ data, context }) => {
    const agentId = (data.agentId ?? "").trim();
    if (!agentId.startsWith("agent_")) {
      return {
        ok: false as const,
        error: `Invalid agent ID "${agentId}". Must start with "agent_".`,
      };
    }
    // Verify the calling user owns this Retell agent before exposing config.
    const { data: ownedRows, error: ownErr } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("user_id", context.userId)
      .eq("retell_agent_id", agentId)
      .limit(1);
    if (ownErr) {
      return { ok: false as const, error: ownErr.message };
    }
    if (!ownedRows || ownedRows.length === 0) {
      return { ok: false as const, error: "You do not have access to this agent." };
    }
    try {
      const agent = await retellFetch(`/get-agent/${agentId}`, undefined, "GET");
      const engine = (agent.response_engine ?? {}) as Record<string, unknown>;
      const cfId = String(engine.conversation_flow_id ?? "");
      if (!cfId) {
        return {
          ok: false as const,
          error: "This agent is not a conversation-flow agent and cannot be loaded.",
        };
      }
      const cf = await retellFetch(`/get-conversation-flow/${cfId}`, undefined, "GET");
      return {
        ok: true as const,
        agentJson: JSON.stringify({ ...agent, conversationFlow: cf }),
        agentId,
        conversationFlowId: cfId,
      };
    } catch (err) {
      // Expected failure (e.g. 404 "agent not found"): return a friendly
      // error instead of throwing so the dev runtime overlay doesn't blank
      // the screen on a recoverable user mistake.
      const status = err instanceof RetellApiError ? err.status : undefined;
      const message =
        status === 404
          ? `Agent ${agentId} was not found in Retell. It may have been deleted.`
          : (err as Error).message;
      return { ok: false as const, error: message };
    }
  });

/**
 * Clone a custom voice in Retell from an uploaded audio sample.
 * Client sends base64-encoded audio + filename/mime; we forward as multipart
 * to Retell's POST /clone-voice endpoint and return the new voice_id.
 */
export const cloneCustomVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      voiceName: string;
      voiceProvider?: "elevenlabs" | "playht";
      fileBase64: string;
      fileName: string;
      mimeType?: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.RETELL_API_KEY;
    if (!apiKey) throw new Error("RETELL_API_KEY is not configured");
    const name = data.voiceName.trim();
    if (!name) throw new Error("Voice name is required");
    if (!data.fileBase64) throw new Error("Audio file is required");

    const bytes = Buffer.from(data.fileBase64, "base64");
    const blob = new Blob([bytes], { type: data.mimeType || "audio/mpeg" });

    const form = new FormData();
    form.append("voice_name", name);
    form.append("voice_provider", data.voiceProvider ?? "elevenlabs");
    form.append("files", blob, data.fileName || "sample.mp3");

    const res = await fetch(`${RETELL_BASE}/clone-voice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      /* keep raw */
    }
    if (!res.ok) {
      const message = (parsed.message as string | undefined) || text || res.statusText;
      throw new Error(`Retell /clone-voice ${res.status}: ${message}`);
    }
    return {
      voiceId: String(parsed.voice_id ?? ""),
      voiceName: String(parsed.voice_name ?? name),
      previewAudioUrl: (parsed.preview_audio_url as string | undefined) ?? null,
    };
  });

/**
 * Buy a new phone number from Retell (Twilio-backed by default).
 * Markup is purely display-side; Retell bills its own rate.
 */
export const buyRetellPhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      areaCode?: number;
      tollFree?: boolean;
      nickname?: string;
      inboundAgentId?: string;
      outboundAgentId?: string;
      productionApiKey?: string;
      agentRowId?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const body: Record<string, unknown> = {
      phone_number_pricing_type: data.tollFree ? "toll_free" : "standard",
    };
    if (data.areaCode) body.area_code = data.areaCode;
    if (data.nickname) body.nickname = data.nickname;
    if (data.inboundAgentId) body.inbound_agent_id = data.inboundAgentId;
    if (data.outboundAgentId) body.outbound_agent_id = data.outboundAgentId;
    const resp = await retellFetchForAgent(
      `/create-phone-number`,
      body,
      "POST",
      context.userId,
      data.agentRowId,
      data.productionApiKey,
      context.workspaceId,
    );
    return {
      phoneNumber: String(resp.phone_number ?? ""),
      nickname: String(resp.nickname ?? ""),
      type: String(resp.phone_number_type ?? ""),
    };
  });

/**
 * Import an existing phone number via SIP trunking.
 */
export const importSipPhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      phoneNumber: string;
      terminationUri: string;
      sipUsername?: string;
      sipPassword?: string;
      nickname?: string;
      inboundAgentId?: string;
      outboundAgentId?: string;
      productionApiKey?: string;
      agentRowId?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    if (!/^\+\d{7,15}$/.test(data.phoneNumber)) {
      throw new Error("Phone number must be in E.164 format, e.g. +447533043457");
    }
    if (!data.terminationUri.trim()) {
      throw new Error("Termination URI is required");
    }
    const body: Record<string, unknown> = {
      phone_number: data.phoneNumber,
      termination_uri: data.terminationUri.trim(),
    };
    if (data.sipUsername) body.sip_trunk_auth_username = data.sipUsername;
    if (data.sipPassword) body.sip_trunk_auth_password = data.sipPassword;
    if (data.nickname) body.nickname = data.nickname;
    if (data.inboundAgentId) body.inbound_agent_id = data.inboundAgentId;
    if (data.outboundAgentId) body.outbound_agent_id = data.outboundAgentId;
    const resp = await retellFetchForAgent(
      `/import-phone-number`,
      body,
      "POST",
      context.userId,
      data.agentRowId,
      data.productionApiKey,
      context.workspaceId,
    );
    return {
      phoneNumber: String(resp.phone_number ?? data.phoneNumber),
      nickname: String(resp.nickname ?? ""),
    };
  });

/** List phone numbers the workspace owns (for the deploy dialog). */
export const listRetellPhoneNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { productionApiKey?: string; agentRowId?: string } | undefined) => input ?? {},
  )
  .handler(async ({ data, context }) => {
    let resp: Record<string, unknown>;
    try {
      resp = await retellFetchForAgent(
        `/list-phone-numbers`,
        undefined,
        "GET",
        context.userId,
        data?.agentRowId,
        data?.productionApiKey,
        context.workspaceId,
      );
    } catch (error) {
      if (isRetellAuthError(error)) {
        console.warn("[retell] list-phone-numbers auth failed", {
          userId: context.userId,
          agentRowId: data?.agentRowId,
          hasExplicitKey: Boolean(data?.productionApiKey?.trim()),
        });
        throw new Error(
          "Retell rejected your production API key (401/403). Re-enter the production API key above and try again.",
        );
      }
      throw error;
    }
    const arr = Array.isArray(resp) ? resp : [];
    return arr.map((n) => {
      const item = n as Record<string, unknown>;
      return {
        phoneNumber: String(item.phone_number ?? ""),
        nickname: String(item.nickname ?? ""),
        inboundAgentId: (item.inbound_agent_id as string | undefined) ?? null,
        outboundAgentId: (item.outbound_agent_id as string | undefined) ?? null,
      };
    });
  });

/** Attach an already-owned number to a specific agent (for inbound). */
export const assignNumberToAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      phoneNumber: string;
      inboundAgentId?: string;
      outboundAgentId?: string;
      productionApiKey?: string;
      agentRowId?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const body: Record<string, unknown> = {};
    if (data.inboundAgentId !== undefined) body.inbound_agent_id = data.inboundAgentId;
    if (data.outboundAgentId !== undefined) body.outbound_agent_id = data.outboundAgentId;
    const resp = await retellFetchForAgent(
      `/update-phone-number/${encodeURIComponent(data.phoneNumber)}`,
      body,
      "PATCH",
      context.userId,
      data.agentRowId,
      data.productionApiKey,
      context.workspaceId,
    );
    return { phoneNumber: String(resp.phone_number ?? data.phoneNumber) };
  });

/**
 * Clone a Retell agent + conversation flow into a separate Retell workspace
 * (a workspace = a distinct Retell API key). The client supplies a label so
 * the live/production copy is clearly identifiable in their Retell dashboard,
 * and optionally a separate production API key — when omitted, the clone is
 * created in the same workspace as the source.
 */
export const cloneRetellAgentForDeploy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      sourceAgentId: string;
      agentName?: string;
      productionApiKey?: string;
      agentRowId?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const src = (data.sourceAgentId ?? "").trim();
    if (!src.startsWith("agent_")) throw new Error("Invalid source agent ID");

    // Resolve the label: use explicit name, or fall back to the user's
    // approved workspace_request name (their company name).
    let label = (data.agentName ?? "").trim();
    if (!label && context.workspaceId) {
      const { data: wsReq } = await supabaseAdmin
        .from("workspace_requests")
        .select("workspace_name")
        .eq("user_id", context.userId)
        .eq("status", "approved")
        .order("decided_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      label = wsReq?.workspace_name ?? "";
    }
    if (!label) throw new Error("A company / workspace name is required to go live.");

    // Resolve the production API key: explicit > stored in agent_retell_secrets
    // > admin-provisioned key in workspace_settings.retell_workspace_id.
    let explicitKey = (data.productionApiKey ?? "").trim() || undefined;
    if (!explicitKey && context.workspaceId) {
      const { data: ws } = await supabaseAdmin
        .from("workspace_settings")
        .select("retell_workspace_id")
        .eq("workspace_id", context.workspaceId)
        .maybeSingle();
      // retell_workspace_id stores the admin-provisioned production API key.
      const storedKey = ws?.retell_workspace_id?.trim();
      if (storedKey && storedKey.startsWith("key_")) explicitKey = storedKey;
    }
    const prodKey = resolveProductionApiKey(explicitKey);

    // The builder may have created the source agent in the workspace's own
    // Retell account (using the workspace key). Use that same key when reading
    // so Go Live can find the agent even when it's not in the platform workspace.
    const srcReadKey = explicitKey || undefined;

    const agent = (await retellFetch(`/get-agent/${src}`, undefined, "GET", srcReadKey)) as Record<
      string,
      unknown
    >;
    const engine = (agent.response_engine ?? {}) as Record<string, unknown>;
    const srcCfId = String(engine.conversation_flow_id ?? "");
    if (!srcCfId) throw new Error("Source agent has no conversation flow");
    const cf = (await retellFetch(
      `/get-conversation-flow/${srcCfId}`,
      undefined,
      "GET",
      srcReadKey,
    )) as Record<string, unknown>;

    const cfBody = stripKeys(cf, READONLY_KEYS);

    // Absolutize relative tool URLs so Retell's production workspace doesn't
    // reject the CF with a URL validation error.
    const clonePubBase =
      process.env.PUBLIC_BASE_URL ||
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
    if (Array.isArray(cfBody.tools) && clonePubBase) {
      cfBody.tools = (cfBody.tools as Array<Record<string, unknown>>).map((tool) => {
        if (tool.type === "custom" && typeof tool.url === "string" && tool.url.startsWith("/")) {
          console.log("[go-live] Absolutizing tool URL:", tool.name, tool.url);
          return { ...tool, url: `${clonePubBase}${tool.url}` };
        }
        return tool;
      });
    }

    console.log("[go-live] Creating production CF, tools:", (cfBody.tools as Array<Record<string,unknown>> | undefined)?.map((t) => ({ name: t.name, type: t.type, url: t.url })));
    let cfResp: Record<string, unknown>;
    try {
      cfResp = await retellFetch(`/create-conversation-flow`, cfBody, "POST", prodKey);
    } catch (cfErr) {
      console.error("[go-live] CF creation FAILED:", (cfErr as Error).message);
      throw cfErr;
    }
    const newCfId = String(cfResp.conversation_flow_id ?? "");
    if (!newCfId) throw new Error("Production workspace did not return a conversation_flow_id");

    const agentBody = stripKeys(agent, READONLY_KEYS);
    delete (agentBody as Record<string, unknown>).response_engine;
    agentBody.agent_name = label;
    agentBody.response_engine = {
      type: "conversation-flow",
      conversation_flow_id: newCfId,
    };

    // Use the builder's intended voice_id (stored in agent settings) rather
    // than the voice from the platform agent, which may have been silently
    // fallen back to 11labs-Adrian when the custom voice wasn't available in
    // the platform Retell workspace.
    if (data.agentRowId) {
      const { data: agentRow } = await supabaseAdmin
        .from("agents")
        .select("settings")
        .eq("id", data.agentRowId)
        .maybeSingle();
      const storedSettings = (agentRow?.settings as Record<string, unknown> | null) ?? {};
      const intendedVoiceId = (storedSettings.voiceId as string | undefined)?.trim();
      if (intendedVoiceId) {
        agentBody.voice_id = intendedVoiceId;
        // Preserve voice_model from stored settings for ElevenLabs voices.
        const intendedVoiceModel = (storedSettings.voiceModel as string | undefined)?.trim();
        if (intendedVoiceId.startsWith("11labs-")) {
          agentBody.voice_model =
            intendedVoiceModel ||
            (agent.voice_model as string | undefined) ||
            "eleven_turbo_v2";
        }
      }
    }

    // Auto-attach booking tools if this workspace has Cal.com connected.
    // In retail mode, use the shared retail workspace so all deployed agents
    // share the same Cal.com config (set up once in the retail workspace).
    const retailWs = isRetailDeployEnabled() ? getRetailWorkspaceId() : undefined;
    const bkWorkspaceId = retailWs || context.workspaceId;
    if (!bkWorkspaceId) throw new Error("No active workspace");
    const bookingTools = await maybeBuildBookingToolsForWorkspace(bkWorkspaceId);
    const calendarConnected = bookingTools !== null;
    if (bookingTools) {
      const existing = Array.isArray(agentBody.general_tools)
        ? (agentBody.general_tools as Array<Record<string, unknown>>)
        : [];
      const ourNames = new Set(bookingTools.map((t) => t.name));
      agentBody.general_tools = [
        ...existing.filter((t) => !ourNames.has(t.name as string)),
        ...bookingTools,
      ];
    }

    // Always inject webhook URL so call events are tracked automatically.
    const cloneWebhookBase =
      process.env.PUBLIC_BASE_URL ||
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
    if (cloneWebhookBase && !agentBody.webhook_url) {
      agentBody.webhook_url = `${cloneWebhookBase}/api/public/voice-webhook`;
    }

    const agentResp = await retellFetch(`/create-agent`, agentBody, "POST", prodKey);
    const newAgentId = String(agentResp.agent_id ?? "");
    if (!newAgentId) throw new Error("Production workspace did not return an agent_id");
    await rememberProductionRetellApiKey(data.agentRowId, context.userId, prodKey);

    // Register Cal.com webhook when the CF has native cal tools.
    const goLiveHasCal =
      Array.isArray(cfBody.tools) &&
      (cfBody.tools as Array<Record<string, unknown>>).some(
        (t) => t.type === "check_availability_cal" || t.type === "book_appointment_cal",
      );
    if (goLiveHasCal && bkWorkspaceId) {
      const goLiveWebhookBase =
        process.env.PUBLIC_BASE_URL ||
        (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
      if (goLiveWebhookBase) {
        try {
          const wh = await registerCalcomWebhook({
            workspaceId: bkWorkspaceId,
            subscriberUrl: `${goLiveWebhookBase}/api/public/calcom-webhook`,
          });
          console.log("[go-live] Cal.com webhook registration:", wh.message);
        } catch (whErr) {
          console.warn("[go-live] Cal.com webhook registration failed:", whErr);
        }
      }
    }

    console.log("[go-live] Complete", { newAgentId, newCfId, calendarConnected });
    return {
      agentId: newAgentId,
      conversationFlowId: newCfId,
      agentName: String(agentResp.agent_name ?? label),
      separateWorkspace: true,
      calendarConnected,
      bookingToolsAttached: calendarConnected,
    };
  });
