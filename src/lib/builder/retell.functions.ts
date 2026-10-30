import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireAction } from "@/lib/permissions/permissions.server";
import { buildDocumentTools } from "@/lib/documents/document-tools.server";
import { registerCalcomWebhook } from "@/lib/providers/calcom/webhook-register.server";
import { RETELL_BASE, RetellApiError, retellFetch } from "@/lib/builder/retell-telephony.server";
import { withStandardCallOutcome } from "@/lib/voice/call-outcome.shared";
import { READONLY_KEYS, maybeBuildBookingToolsForWorkspace, redactRetellPayload, sanitizeRetellConversationFlow, stripKeys, transferSchemaMismatches } from "@/lib/builder/retell-deploy-helpers.server";

// Moved to their own files; re-exported so existing imports keep working.
export * from "./retell-voices.functions";
export * from "./retell-phone-numbers.functions";
export * from "./retell-agents.functions";
export * from "./elevenlabs-agent.functions";

export const deployAgentToRetell = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
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
    // Go Live is a high-risk RBAC action — fail-closed permission check.
    await requireAction(context.workspaceId, context.userId, "go_live");
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
          return { ...n, tool_id: finalName, speak_during_execution: true };
        });
      }
    }

    // Force speak_during_execution on ALL calendar-related function nodes so
    // the agent always says something while the function is running, regardless
    // of whether the node went through the calToolOverrides remap above.
    const BOOKING_TOOL_IDS = new Set([
      "check_availability",
      "check_availability_cal",
      "book_appointment",
      "book_appointment_cal",
      "reschedule_appointment",
      "cancel_appointment",
    ]);
    const BOOKING_SPEAK_MESSAGES: Record<string, string> = {
      check_availability: "Say: 'One moment while I check the calendar for available times.'",
      check_availability_cal: "Say: 'One moment while I check the calendar for available times.'",
      book_appointment: "Say: 'Perfect, let me secure that booking for you now.'",
      book_appointment_cal: "Say: 'Perfect, let me secure that booking for you now.'",
      reschedule_appointment: "Say: 'One moment while I reschedule that appointment for you.'",
      cancel_appointment: "Say: 'One moment while I cancel that appointment for you.'",
    };

    // Force speak_during_execution on document tool function nodes too.
    const DOC_TOOL_IDS = new Set(["check_documents", "send_upload_link"]);
    const DOC_SPEAK_MESSAGES: Record<string, string> = {
      check_documents: "Say: 'Let me just check that for you now, one moment.'",
      send_upload_link: "Say: 'Of course, let me generate and send that link to you right now.'",
    };

    if (Array.isArray(cf.nodes)) {
      cf.nodes = (cf.nodes as Array<Record<string, unknown>>).map((n) => {
        if (n.type !== "function") return n;
        const tid = String(n.tool_id ?? "");
        if (DOC_TOOL_IDS.has(tid)) {
          const msg = DOC_SPEAK_MESSAGES[tid];
          return {
            ...n,
            speak_during_execution: true,
            ...(msg ? { execution_message_description: msg } : {}),
          };
        }
        if (!BOOKING_TOOL_IDS.has(tid)) return n;
        const msg = BOOKING_SPEAK_MESSAGES[tid];
        return {
          ...n,
          speak_during_execution: true,
          ...(msg ? { execution_message_description: msg } : {}),
        };
      });
    }

    // Always auto-attach document tools (check_documents + send_upload_link).
    // These are stateless lookups — harmless when the agent never calls them.
    const docTools = buildDocumentTools() as Array<Record<string, unknown>>;

    // Merge auto-attached + per-node Cal.com tools into agent.general_tools
    // AND cf.tools (Retell requires the tool exist in cf.tools for function
    // nodes to reference it by tool_id).
    const mergedTools: Array<Record<string, unknown>> = [
      ...docTools,
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
      // Append comprehensive booking flow instructions to the global prompt.
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

      const existingPrompt = String(cf.global_prompt ?? "");
      const parts: string[] = [];

      // Always inject the full booking flow guidance when booking is enabled.
      parts.push(`## Appointment Booking

You have access to Cal.com booking tools. Follow this exact flow when a caller wants to book, cancel, or reschedule an appointment.

### Booking a new appointment

**Step 1 — Detect intent**
Listen for phrases like "I'd like to book", "can I schedule", "I need an appointment", "I'd like to come in". Once detected, move to step 2.

**Step 2 — Collect required information**
Before checking availability you need ALL of the following:
- Caller's full name
- Caller's email address
- Caller's phone number — ask "What's the best phone number to reach you on?" if not already provided. This is required for every booking.
- Preferred date or date range (e.g. "this week", "next Monday", "sometime in June")
- Caller's timezone (infer from phone number country code, accent, or ask "What timezone are you in?")
Never ask for information the caller has already given. Do NOT proceed to check availability until you have their name, email AND phone number.

**Step 3 — Check availability**
Call \`check_availability\` with:
- start_date: first day of their preferred range (ISO date, e.g. 2026-06-10)
- end_date: last day of their preferred range (add 6 days if they said "this week")
- timezone: their IANA timezone (e.g. Europe/London, America/New_York)

**Step 4 — Present available times**
Read the \`summary\` field from the response aloud almost verbatim. Example:
"I have slots on Tuesday 10th June at 2pm, 3pm and 4pm, and on Wednesday at 10am. Which works best for you?"
If slot_count is 0, apologise and offer to check different dates: "I don't see any openings that week — shall I check the following week?"

**Step 5 — Capture their chosen slot**
When the caller picks a time, identify the exact \`start\` ISO string from the \`slots\` array that matches. Never modify or guess an ISO time — use it exactly as returned.

**Step 6 — Confirm before booking**
Always read back the details before creating the booking:
"Just to confirm — I'll book you in for [display time] under [name], email [email], and phone [phone]. Is that right?"
Wait for an explicit "yes" or "that's correct" before proceeding.

**Step 7 — Create the booking**
Only after the caller confirms, call \`book_appointment\` with:
- start: the exact ISO string from the slots array
- name: caller's full name
- email: caller's email address (REQUIRED — do not call without this)
- phone: caller's phone number (REQUIRED — do not call without this; go back to Step 2 if missing)
- notes: (optional) any details they mentioned
- timezone: their IANA timezone

**Step 8 — Confirm success**
Read the \`confirmation_message\` field from the response. If a \`meeting_url\` is present, share it: "Your meeting link is [url]". If \`ok\` is false, apologise and offer to try again.

### Cancelling an appointment

1. Ask for the booking ID (they received it in their confirmation email).
2. Confirm: "Just to confirm, you'd like to cancel your booking [id]?"
3. Call \`cancel_appointment\` only after they confirm.
4. Confirm: "Your appointment has been cancelled."

### Rescheduling an appointment

1. Ask for the booking ID.
2. Ask for their preferred new date/time range.
3. Call \`check_availability\` for the new range.
4. Present available slots.
5. Confirm the new time with the caller.
6. Call \`reschedule_appointment\` with the booking_id and new ISO start time.
7. Confirm: "Your appointment has been rescheduled to [new time]."

### Rules — always follow these

- NEVER create a booking without explicit caller confirmation of name, email, phone, and time.
- NEVER call \`book_appointment\` unless you have the caller's phone number AND email address — ask for whichever is missing before proceeding.
- NEVER fabricate, modify, or guess an ISO slot time — always use the exact value from check_availability.
- NEVER ask for payment or credit card information.
- If timezone is unclear, ask: "What timezone are you in?"
- If the same slot gets booked twice, apologise and check availability again.
- If an API call fails, apologise gracefully: "I'm sorry, I ran into a technical issue. Let me try again — or I can pass your details on and someone will call you back."`);

      if (whLines.length) {
        parts.push(
          `## Working hours\nOnly offer slots within these hours (caller's local time):\n${whLines.join("\n")}`,
        );
      }
      if (instructions) parts.push(`## Additional booking instructions\n${instructions}`);
      cf.global_prompt = `${existingPrompt}\n\n${parts.join("\n\n")}`.trim();
    }

    // ---- Conversation flow ----
    const cfBody = sanitizeRetellConversationFlow(stripKeys(cf, READONLY_KEYS));

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
        try {
          cfResp = await retellFetch(
            `/update-conversation-flow/${conversationFlowId}`,
            cfBody,
            "PATCH",
            builderKey,
          );
        } catch (updateErr) {
          // Conversation flow was deleted from Retell (stale ID) — create a fresh one.
          if (updateErr instanceof RetellApiError && updateErr.status === 404) {
            console.warn("[retell-deploy] Conversation flow not found in Retell (stale ID), creating a new one");
            cfResp = await retellFetch(`/create-conversation-flow`, cfBody, "POST", builderKey);
            conversationFlowId = String(cfResp.conversation_flow_id ?? "");
          } else {
            throw updateErr;
          }
        }
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
            `Transfer verification failed. Stripped nodes: ${stripped.join(", ") || "none"}. Critical schema mismatches: ${JSON.stringify(hardMismatches)}.`,
          );
        }
      } catch (verifyErr) {
        throw new Error(`Transfer verification failed: ${(verifyErr as Error).message}`);
      }
    }

    // ---- Always inject webhook URL on every deployed agent ----
    const PUBLIC_BASE_URL_FOR_WEBHOOK =
      process.env.PUBLIC_BASE_URL ||
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
    if (PUBLIC_BASE_URL_FOR_WEBHOOK && !agent.webhook_url) {
      agent.webhook_url = `${PUBLIC_BASE_URL_FOR_WEBHOOK}/api/public/voice-webhook`;
    }
    // Subscribe to `transcript_updated` (opt-in, not in Retell's default set) so
    // the dashboard can show a LIVE transcript during the call — while keeping
    // the default trio (call_started/ended/analyzed) that analytics/leads rely on.
    {
      const LIVE_WEBHOOK_EVENTS = [
        "call_started",
        "call_ended",
        "call_analyzed",
        "transcript_updated",
      ];
      const existingEvents = Array.isArray(agent.webhook_events)
        ? (agent.webhook_events as string[])
        : [];
      agent.webhook_events = Array.from(new Set([...existingEvents, ...LIVE_WEBHOOK_EVENTS]));
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

    // ---- Standard call outcome on every agent (outcome rules act on it) ----
    agent.post_call_analysis_data = withStandardCallOutcome(
      (agent.post_call_analysis_data as Array<Record<string, unknown>> | undefined) ?? [],
    );

    // ---- Agent ----
    let agentResp: Record<string, unknown> | undefined;
    let agentId = mode === "update" ? data.agentId : undefined;
    let voiceFallback = false;

    // Auto-register an unregistered ElevenLabs voice ID in the platform workspace.
    // Voice IDs like 11labs-{20charId} that haven't been registered via /create-voice
    // will fail with "voice not found". We detect them by the long alphanumeric suffix
    // (EL real IDs are ~20 chars vs built-in names like "Adrian" which are short).
    async function tryAutoRegisterVoice(failedVoiceId: unknown): Promise<string | null> {
      if (typeof failedVoiceId !== "string") return null;
      const suffix = failedVoiceId.startsWith("11labs-") ? failedVoiceId.slice(7) : null;
      if (!suffix || suffix.length < 12) return null; // short names = built-in voices, can't re-register
      try {
        const regRes = await fetch(`${RETELL_BASE}/add-community-voice`, {
          method: "POST",
          headers: { Authorization: `Bearer ${builderKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ voice_name: suffix, voice_provider: "elevenlabs", provider_voice_id: suffix }),
        });
        if (!regRes.ok) return null;
        const regJson = (await regRes.json()) as Record<string, unknown>;
        const newId = String(regJson.voice_id ?? "");
        if (newId) {
          console.log("[retell-deploy] Auto-registered ElevenLabs voice", failedVoiceId, "→", newId);
          return newId;
        }
      } catch { /* fall through */ }
      return null;
    }

    if (mode === "update" && agentId) {
      const updateBody = stripKeys(agent, READONLY_KEYS);
      updateBody.response_engine = {
        type: "conversation-flow",
        conversation_flow_id: conversationFlowId,
      };
      try {
        agentResp = await retellFetch(`/update-agent/${agentId}`, updateBody, "PATCH", builderKey);
      } catch (e) {
        if (/voice.*not found|not found.*voice/i.test((e as Error).message)) {
          const registeredId = await tryAutoRegisterVoice(updateBody.voice_id);
          if (registeredId) {
            updateBody.voice_id = registeredId;
            agentResp = await retellFetch(`/update-agent/${agentId}`, updateBody, "PATCH", builderKey);
          } else {
            updateBody.voice_id = "11labs-Adrian";
            agentResp = await retellFetch(`/update-agent/${agentId}`, updateBody, "PATCH", builderKey);
            voiceFallback = true;
          }
        } else if (e instanceof RetellApiError && e.status === 404) {
          // Agent no longer exists in the platform workspace. Throw a typed error so
          // the client can clear its stale agentId and prompt the user to create fresh.
          throw new Error(
            `STALE_AGENT_ID: Agent ${agentId} was not found — it may have been deleted. Click + to create a new agent.`,
          );
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
        if (/voice.*not found|not found.*voice/i.test((e as Error).message)) {
          const registeredId = await tryAutoRegisterVoice(createBody.voice_id);
          if (registeredId) {
            createBody.voice_id = registeredId;
            agentResp = await retellFetch(`/create-agent`, createBody, "POST", builderKey);
          } else {
            createBody.voice_id = "11labs-Adrian";
            agentResp = await retellFetch(`/create-agent`, createBody, "POST", builderKey);
            voiceFallback = true;
          }
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

    // ── Deployment sync snapshot (Task #458, best-effort) ────────────────────
    // Anchor the sync-diff engine: read the live config back and store the
    // deployed + live hashes. The agent row is looked up by its Retell IDs
    // because this fn does not receive the local row id (fresh creates are
    // snapshotted on first sync-status read instead).
    try {
      const { data: agentRowMatch } = await supabaseAdmin
        .from("agents")
        .select("id, settings, retell_agent_id")
        .eq("workspace_id", wsId);
      const matched = (agentRowMatch ?? []).find((r) => {
        const s = (r.settings ?? {}) as Record<string, unknown>;
        return (
          r.retell_agent_id === agentId ||
          (s.deployedRetellAgentId as string | undefined) === agentId
        );
      });
      if (matched && agentId) {
        const { recordDeploySnapshot } = await import(
          "@/lib/systemmind/retell-sync.server"
        );
        await recordDeploySnapshot({
          workspaceId: wsId,
          agentRowId: matched.id as string,
          retellAgentId: agentId,
          conversationFlowId: conversationFlowId ?? null,
          success: true,
          builderKey: builderKey ?? null,
        });
      }
    } catch (snapErr) {
      console.warn("[retell-deploy] sync snapshot failed (non-fatal)", snapErr);
    }

    return {
      agentId: agentId ?? "",
      conversationFlowId: conversationFlowId ?? "",
      agentName: String((agentResp.agent_name as string | undefined) ?? ""),
      calendarConnected,
      bookingToolsAttached: calendarConnected,
      voiceFallback,
    };
  });
