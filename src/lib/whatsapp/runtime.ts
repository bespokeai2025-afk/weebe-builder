/**
 * WhatsApp conversation runtime engine — multi-step workflow edition.
 *
 * Three execution modes (set per-agent via waExecutionMode in BuilderSettings):
 *
 *   structured       — Default. Strict node-by-node flow. Transitions evaluated
 *                      via keyword matching against the user's message.
 *
 *   ai_assisted      — Same flow structure but AI evaluates transition conditions
 *                      and extracts named variables from user messages. Logic-split
 *                      branches can reference {variables}.
 *
 *   fully_autonomous — AI sees the entire remaining flow as context, chooses its
 *                      own response AND the next node in a single LLM call. The
 *                      flow graph acts as guardrails, not a strict script.
 *
 * New node kinds:
 *
 *   wa_wait_reply    — Sends its dialogue verbatim, then pauses. The next inbound
 *                      message resumes from this node, optionally extracts a
 *                      variable, then evaluates transitions.
 *
 *   wa_extract_var   — AI extracts a named variable from the user's last message.
 *                      No reply sent; advances silently.
 *
 *   wa_tag           — Tags the contact in whatsapp_contacts. No reply; advances.
 *
 *   wa_template      — Sends templateBody with {variable} substitution. No AI.
 *
 * Variable interpolation:
 *   Any outbound message body can contain {variable_name} placeholders that are
 *   replaced with values accumulated in session.workflow_variables.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createWhatsAppProviderWithFallback } from "@/lib/providers/whatsapp/factory";
import type { WhatsAppConfig } from "@/lib/providers/whatsapp/factory";

// ── Types ────────────────────────────────────────────────────────────────────

interface FlowNode {
  id: string;
  type: string;
  data: {
    kind: string;
    label: string;
    dialogue?: string;
    isStart?: boolean;
    endingPrompt?: string;
    mediaUrl?: string;
    mediaCaption?: string;
    bookingUrl?: string;
    bookingEventTypeId?: string;
    bookingLookaheadDays?: number;
    extractVarName?: string;
    extractVarPrompt?: string;
    tagName?: string;
    templateBody?: string;
    transitions: Array<{ id: string; condition: string; target: string | null }>;
    [key: string]: unknown;
  };
}

type ExecutionMode = "structured" | "ai_assisted" | "fully_autonomous";

interface RuntimeInput {
  workspaceId: string;
  contactPhone: string;
  contactName: string | null;
  inboundBody: string;
}

// ── Send helpers ──────────────────────────────────────────────────────────────

async function sendMeta(
  to: string,
  body: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to.replace(/^\+/, ""),
        type: "text",
        text: { body },
      }),
    });
    const json = (await res.json()) as any;
    if (!res.ok) console.error("[wa-runtime] Meta API error", json?.error?.message);
    return (json?.messages?.[0]?.id as string | undefined) ?? null;
  } catch (e) {
    console.error("[wa-runtime] sendMeta failed", e);
    return null;
  }
}

async function sendTwilio(
  to: string,
  from: string,
  body: string,
  accountSid: string,
  authToken: string,
  mediaUrl?: string,
): Promise<string | null> {
  try {
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const params: Record<string, string> = {
      To: `whatsapp:${to}`,
      From: `whatsapp:${from}`,
      Body: body,
    };
    if (mediaUrl) params.MediaUrl = mediaUrl;

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(params),
      },
    );
    const json = (await res.json()) as any;
    if (!res.ok) console.error("[wa-runtime] Twilio error", json?.code, json?.message);
    return json?.sid ?? null;
  } catch (e) {
    console.error("[wa-runtime] sendTwilio failed", e);
    return null;
  }
}

// ── OpenAI helpers ────────────────────────────────────────────────────────────

async function callOpenAI(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxTokens = 512,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: maxTokens,
      temperature: 0.4,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as any;
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// ── Variable helpers ──────────────────────────────────────────────────────────

function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

async function extractVariable(
  varName: string,
  instruction: string,
  userMessage: string,
): Promise<string | null> {
  const prompt = instruction
    ? instruction
    : `Extract the value of "${varName}" from the user's message. Return ONLY the extracted value as plain text, or "null" if not found.`;

  try {
    const result = await callOpenAI(
      `You are a data extraction assistant. ${prompt}\nRespond with ONLY the extracted value or the word "null".`,
      [{ role: "user", content: userMessage }],
      64,
    );
    return result && result.toLowerCase() !== "null" ? result : null;
  } catch {
    return null;
  }
}

// ── Transition helpers ────────────────────────────────────────────────────────

function pickTransitionKeyword(
  node: FlowNode,
  userMessage: string,
  nodes: FlowNode[],
): FlowNode | null {
  if (!node.data.transitions?.length) return null;
  const lower = userMessage.toLowerCase();

  for (const t of node.data.transitions) {
    if (!t.target) continue;
    const cond = t.condition?.toLowerCase().trim() ?? "";
    if (!cond || cond === "always" || cond === "default" || cond === "else") {
      return nodes.find((n) => n.id === t.target) ?? null;
    }
    if (lower.includes(cond)) {
      return nodes.find((n) => n.id === t.target) ?? null;
    }
  }

  const first = node.data.transitions.find((t) => t.target);
  return first ? (nodes.find((n) => n.id === first.target) ?? null) : null;
}

async function pickTransitionAI(
  node: FlowNode,
  userMessage: string,
  variables: Record<string, string>,
  nodes: FlowNode[],
): Promise<FlowNode | null> {
  if (!node.data.transitions?.length) return null;

  const validTargets = node.data.transitions.filter((t) => t.target);
  if (validTargets.length === 0) return null;
  if (validTargets.length === 1) {
    const cond = validTargets[0].condition?.toLowerCase().trim() ?? "";
    if (!cond || cond === "always" || cond === "default" || cond === "else") {
      return nodes.find((n) => n.id === validTargets[0].target) ?? null;
    }
  }

  const transitionList = validTargets
    .map((t) => `- id="${t.target}" condition="${t.condition}"`)
    .join("\n");

  const varContext =
    Object.keys(variables).length > 0
      ? `\nCollected variables: ${JSON.stringify(variables)}`
      : "";

  const prompt = `You must choose the correct next node from the transitions below based on the user's message and the collected variables.
User message: "${userMessage}"${varContext}

Transitions:
${transitionList}

Respond with ONLY the id of the chosen next node (exactly as shown), nothing else.`;

  try {
    const raw = await callOpenAI(prompt, [], 32);
    const chosen = raw.trim().replace(/^["']|["']$/g, "");
    return nodes.find((n) => n.id === chosen) ?? null;
  } catch {
    return pickTransitionKeyword(node, userMessage, nodes);
  }
}

// ── Cal.com booking helper ────────────────────────────────────────────────────

async function fetchCalSlotSummary(
  workspaceId: string,
  eventTypeIdOverride?: string,
  lookaheadDays = 7,
): Promise<string | null> {
  const sb = supabaseAdmin as any;
  const { data: ws } = await sb
    .from("workspace_settings")
    .select("calcom_api_key, default_event_type_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const apiKey = ws?.calcom_api_key as string | undefined;
  if (!apiKey) return null;

  const eventTypeId = eventTypeIdOverride
    ? Number(eventTypeIdOverride)
    : (ws?.default_event_type_id as number | undefined);
  if (!eventTypeId) return null;

  try {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + lookaheadDays);

    const res = await fetch(
      `https://api.cal.com/v2/slots/available?eventTypeId=${eventTypeId}&startTime=${now.toISOString().split("T")[0]}&endTime=${end.toISOString().split("T")[0]}`,
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } },
    );

    if (!res.ok) return null;

    const calData = (await res.json()) as any;
    const slotsByDay: Record<string, Array<{ time: string }>> =
      calData?.data?.slots ?? calData?.slots ?? {};

    const lines: string[] = [];
    for (const [day, daySlots] of Object.entries(slotsByDay)) {
      if (!Array.isArray(daySlots) || daySlots.length === 0) continue;
      const dayLabel = new Date(day).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      const times = daySlots
        .slice(0, 4)
        .map((s) =>
          new Date(s.time).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }),
        )
        .join(", ");
      lines.push(`• ${dayLabel}: ${times}`);
      if (lines.length >= 5) break;
    }

    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

// ── AI reply generators ───────────────────────────────────────────────────────

async function generateStructuredReply(
  currentNode: FlowNode,
  chatHistory: Array<{ role: "user" | "assistant"; content: string }>,
  inboundBody: string,
  variables: Record<string, string>,
  agentSettings: Record<string, unknown>,
  bookingContext: string,
  isNew: boolean,
): Promise<string> {
  const agentName = (agentSettings.agentName as string | undefined) ?? "Assistant";
  const globalPrompt = (agentSettings.globalPrompt as string | undefined) ?? "";
  const nodePrompt = interpolate(
    currentNode.data.dialogue ?? currentNode.data.endingPrompt ?? "",
    variables,
  );

  const varContext =
    Object.keys(variables).length > 0
      ? `\nCollected data so far: ${Object.entries(variables)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}`
      : "";

  const systemPrompt = [
    `You are ${agentName}, a WhatsApp AI assistant.`,
    globalPrompt ? `\n${globalPrompt}` : "",
    nodePrompt ? `\n\nCurrent instruction for this step:\n${nodePrompt}` : "",
    varContext,
    bookingContext,
    "\n\nReply concisely (1-3 sentences). Do not use markdown. Be conversational.",
    isNew ? "\nThis is the first message — greet the user appropriately." : "",
  ]
    .filter(Boolean)
    .join("");

  return callOpenAI(systemPrompt, [
    ...chatHistory.slice(-8),
    { role: "user", content: inboundBody },
  ]);
}

async function generateFullyAutonomousReply(
  nodes: FlowNode[],
  currentNode: FlowNode,
  chatHistory: Array<{ role: "user" | "assistant"; content: string }>,
  inboundBody: string,
  variables: Record<string, string>,
  agentSettings: Record<string, unknown>,
): Promise<{ reply: string; nextNodeId: string | null }> {
  const agentName = (agentSettings.agentName as string | undefined) ?? "Assistant";
  const globalPrompt = (agentSettings.globalPrompt as string | undefined) ?? "";

  const flowSummary = nodes
    .filter((n) => n.data.kind !== "note")
    .map(
      (n) =>
        `[id=${n.id} kind=${n.data.kind} label="${n.data.label}"] ${n.data.dialogue ?? n.data.templateBody ?? ""}`.slice(
          0,
          200,
        ),
    )
    .join("\n");

  const varContext =
    Object.keys(variables).length > 0
      ? `\nCollected data: ${JSON.stringify(variables)}`
      : "";

  const validNextIds = (currentNode.data.transitions ?? [])
    .filter((t) => t.target)
    .map((t) => t.target)
    .join(", ");

  const systemPrompt = `You are ${agentName}, a WhatsApp AI assistant.
${globalPrompt}

You are currently at node "${currentNode.data.label}" (id=${currentNode.id}).${varContext}

Full flow graph (for context):
${flowSummary}

Valid next node IDs from current node: [${validNextIds || "none — this is the end"}]

The user just said: "${inboundBody}"

Respond in JSON format ONLY:
{"reply": "your reply to the user", "next_node_id": "id of next node or null"}

Rules:
- reply must be 1-3 sentences, conversational, no markdown.
- next_node_id must be one of the valid next node IDs, or null if the conversation should end.`;

  try {
    const raw = await callOpenAI(systemPrompt, chatHistory.slice(-6), 256);
    const json = JSON.parse(raw.replace(/^```json\s*|```\s*$/g, ""));
    return {
      reply: (json.reply as string | undefined) ?? "",
      nextNodeId: (json.next_node_id as string | null | undefined) ?? null,
    };
  } catch {
    const fallback = await generateStructuredReply(
      currentNode,
      chatHistory,
      inboundBody,
      variables,
      agentSettings,
      "",
      false,
    );
    return { reply: fallback, nextNodeId: null };
  }
}

// ── Main runtime ──────────────────────────────────────────────────────────────

export async function processWhatsAppMessage(input: RuntimeInput): Promise<void> {
  const { workspaceId, contactPhone, contactName, inboundBody } = input;
  const sb = supabaseAdmin as any;

  // 1. Get workspace settings
  const { data: ws } = await sb
    .from("workspace_settings")
    .select(
      "twilio_account_sid, twilio_auth_token, whatsapp_phone_id, whatsapp_provider, meta_phone_number_id, meta_access_token",
    )
    .eq("workspace_id", workspaceId)
    .single();

  const provider = (ws?.whatsapp_provider as string | undefined) ?? "twilio";

  if (provider === "meta") {
    if (!ws?.meta_phone_number_id || !ws?.meta_access_token) {
      console.warn("[wa-runtime] Meta credentials not configured for workspace", workspaceId);
      return;
    }
  } else {
    const accountSid = ws?.twilio_account_sid ?? process.env.TWILIO_ACCOUNT_SID;
    const authToken = ws?.twilio_auth_token ?? process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken || !ws?.whatsapp_phone_id) {
      console.warn("[wa-runtime] Twilio credentials not configured for workspace", workspaceId);
      return;
    }
  }

  // 2. Find active WhatsApp agent
  const { data: agentsRaw } = await sb
    .from("agents")
    .select("id, name, flow_data, settings, variables")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(20);

  const agents = (agentsRaw ?? []) as any[];
  const agent = agents.find((a: any) => {
    const s = (typeof a.settings === "string" ? JSON.parse(a.settings) : a.settings) ?? {};
    return s.channelType === "whatsapp";
  });

  if (!agent) return;

  const agentSettings: Record<string, unknown> =
    (typeof agent.settings === "string" ? JSON.parse(agent.settings) : agent.settings) ?? {};
  const flowData =
    (typeof agent.flow_data === "string" ? JSON.parse(agent.flow_data) : agent.flow_data) ?? {};
  const nodes: FlowNode[] = flowData.nodes ?? [];

  if (nodes.length === 0) return;

  const mode: ExecutionMode =
    (agentSettings.waExecutionMode as ExecutionMode | undefined) ?? "structured";

  const startNode = nodes.find((n) => n.data.isStart) ?? nodes[0];

  // 3. Get or create session
  const { data: sessionRaw } = await sb
    .from("whatsapp_sessions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("contact_phone", contactPhone)
    .maybeSingle();

  let session = sessionRaw as any;
  const isNew = !session;

  if (!session) {
    const { data: newSession } = await sb
      .from("whatsapp_sessions")
      .insert({
        workspace_id: workspaceId,
        contact_phone: contactPhone,
        agent_id: agent.id,
        current_node_id: startNode.id,
        message_count: 0,
        workflow_variables: {},
        waiting_for_reply: false,
      })
      .select()
      .single();
    session = newSession;
  }

  if (session?.ended) return;

  const currentNodeId: string = session?.current_node_id ?? startNode.id;
  const currentNode: FlowNode = nodes.find((n) => n.id === currentNodeId) ?? startNode;
  let variables: Record<string, string> = (session?.workflow_variables as Record<string, string>) ?? {};
  const isResuming: boolean = session?.waiting_for_reply ?? false;

  // Helper: persist session updates
  async function updateSession(patch: Record<string, unknown>) {
    await sb
      .from("whatsapp_sessions")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("contact_phone", contactPhone);
  }

  // Helper: send message via active provider (with automatic fallback) and persist it
  async function sendAndPersist(body: string, mediaUrl?: string): Promise<void> {
    const msg = interpolate(body, variables);

    // Build primary config from workspace settings
    const primaryConfig: WhatsAppConfig & { workspaceId: string } =
      provider === "meta"
        ? { provider: "meta", accessToken: ws.meta_access_token as string, phoneNumberId: ws.meta_phone_number_id as string, workspaceId }
        : { provider: "twilio", accountSid: (ws?.twilio_account_sid ?? process.env.TWILIO_ACCOUNT_SID) as string, authToken: (ws?.twilio_auth_token ?? process.env.TWILIO_AUTH_TOKEN) as string, from: ws?.whatsapp_phone_id as string, workspaceId };

    // Read optional WATI fallback from provider_settings
    const { data: fallbackRow } = await (supabaseAdmin as any)
      .from("provider_settings")
      .select("credentials")
      .eq("workspace_id", workspaceId)
      .eq("category", "whatsapp")
      .eq("provider_name", "wati")
      .eq("status", "connected")
      .maybeSingle();
    const fallbackConfig: WhatsAppConfig | null =
      fallbackRow?.credentials?.apiEndpoint && fallbackRow?.credentials?.apiKey
        ? { provider: "wati" as const, apiEndpoint: fallbackRow.credentials.apiEndpoint as string, apiKey: fallbackRow.credentials.apiKey as string }
        : null;

    const waProvider = createWhatsAppProviderWithFallback(primaryConfig, fallbackConfig);
    const { messageId } = await waProvider.sendMessage({ to: contactPhone, body: msg, mediaUrl });

    await sb.from("whatsapp_messages").insert({
      workspace_id: workspaceId,
      external_id: messageId,
      contact_phone: contactPhone,
      contact_name: contactName,
      direction: "outbound",
      body: msg,
      media_url: mediaUrl ?? null,
      status: "sent",
      sent_at: new Date().toISOString(),
    });
  }

  // Helper: tag contact
  async function tagContact(tag: string) {
    await sb
      .from("whatsapp_contacts")
      .upsert(
        {
          workspace_id: workspaceId,
          phone: contactPhone,
          tags: sb.raw(`array_append(COALESCE(tags, '{}'), '${tag.replace(/'/g, "''")}'::text)`),
        },
        { onConflict: "workspace_id,phone", ignoreDuplicates: false },
      )
      .catch(() => {
        console.warn("[wa-runtime] Could not tag contact", tag);
      });
  }

  // 4. Handle ending node
  if (currentNode.data.kind === "ending") {
    await updateSession({ ended: true });
    return;
  }

  // 5. Fetch message history
  const { data: historyRaw } = await sb
    .from("whatsapp_messages")
    .select("direction, body")
    .eq("workspace_id", workspaceId)
    .eq("contact_phone", contactPhone)
    .order("sent_at", { ascending: false })
    .limit(10);

  const history = ((historyRaw ?? []) as any[]).reverse();
  const chatHistory: Array<{ role: "user" | "assistant"; content: string }> = history
    .filter((m: any) => m.body)
    .map((m: any) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.body as string,
    }));

  // ── NODE DISPATCH ──────────────────────────────────────────────────────────

  // ── wa_wait_reply ──────────────────────────────────────────────────────────
  if (currentNode.data.kind === "wa_wait_reply") {
    if (!isResuming) {
      // First visit: send the dialogue and pause
      const msg = currentNode.data.dialogue
        ? interpolate(currentNode.data.dialogue, variables)
        : "";
      if (msg) await sendAndPersist(msg);
      await updateSession({
        waiting_for_reply: true,
        message_count: (session?.message_count ?? 0) + 1,
      });
      return;
    }

    // Resuming: user sent a reply — optionally extract variable, then advance
    if ((mode === "ai_assisted" || mode === "fully_autonomous") && currentNode.data.extractVarName) {
      const extracted = await extractVariable(
        currentNode.data.extractVarName,
        currentNode.data.extractVarPrompt ?? "",
        inboundBody,
      );
      if (extracted) variables[currentNode.data.extractVarName] = extracted;
    }

    const nextNode =
      mode === "structured"
        ? pickTransitionKeyword(currentNode, inboundBody, nodes)
        : await pickTransitionAI(currentNode, inboundBody, variables, nodes);

    const nextNodeId = nextNode?.id ?? currentNodeId;
    const ended = nextNode?.data.kind === "ending";

    await updateSession({
      current_node_id: nextNodeId,
      workflow_variables: variables,
      waiting_for_reply: false,
      message_count: (session?.message_count ?? 0) + 1,
      ended,
    });
    return;
  }

  // ── wa_extract_var — silent extraction, no reply ───────────────────────────
  if (currentNode.data.kind === "wa_extract_var") {
    if (currentNode.data.extractVarName) {
      const extracted = await extractVariable(
        currentNode.data.extractVarName,
        currentNode.data.extractVarPrompt ?? "",
        inboundBody,
      );
      if (extracted) variables[currentNode.data.extractVarName] = extracted;
    }

    const nextNode = pickTransitionKeyword(currentNode, inboundBody, nodes);
    await updateSession({
      current_node_id: nextNode?.id ?? currentNodeId,
      workflow_variables: variables,
      message_count: (session?.message_count ?? 0) + 1,
      ended: nextNode?.data.kind === "ending",
    });
    return;
  }

  // ── wa_tag — tag contact, no reply ────────────────────────────────────────
  if (currentNode.data.kind === "wa_tag") {
    if (currentNode.data.tagName) {
      await tagContact(currentNode.data.tagName);
    }
    const nextNode = pickTransitionKeyword(currentNode, inboundBody, nodes);
    await updateSession({
      current_node_id: nextNode?.id ?? currentNodeId,
      message_count: (session?.message_count ?? 0) + 1,
      ended: nextNode?.data.kind === "ending",
    });
    return;
  }

  // ── wa_template — fixed message with variable interpolation ───────────────
  if (currentNode.data.kind === "wa_template") {
    const body = currentNode.data.templateBody ?? currentNode.data.dialogue ?? "";
    if (body) await sendAndPersist(body);

    const nextNode =
      mode === "structured"
        ? pickTransitionKeyword(currentNode, inboundBody, nodes)
        : await pickTransitionAI(currentNode, inboundBody, variables, nodes);

    await updateSession({
      current_node_id: nextNode?.id ?? currentNodeId,
      workflow_variables: variables,
      message_count: (session?.message_count ?? 0) + 1,
      ended: nextNode?.data.kind === "ending",
    });
    return;
  }

  // ── Booking context for wa_booking nodes ──────────────────────────────────
  let bookingContext = "";
  if (currentNode.data.kind === "wa_booking") {
    const lookahead = currentNode.data.bookingLookaheadDays ?? 7;
    const slots = await fetchCalSlotSummary(
      workspaceId,
      currentNode.data.bookingEventTypeId,
      lookahead,
    );
    if (slots) {
      bookingContext = `\n\nAvailable appointment slots for the next ${lookahead} days:\n${slots}\n\nPresent these options naturally. Ask which slot works. Do not include raw ISO timestamps.`;
    } else if (currentNode.data.bookingUrl) {
      bookingContext = `\n\nShare this booking link: ${currentNode.data.bookingUrl}`;
    }
  }

  // ── AI-Assisted: extract variables from all wa_extract_var nodes passively ─
  if (mode === "ai_assisted") {
    for (const n of nodes) {
      if (n.data.kind === "wa_extract_var" && n.data.extractVarName) {
        if (!variables[n.data.extractVarName]) {
          const extracted = await extractVariable(
            n.data.extractVarName,
            n.data.extractVarPrompt ?? "",
            inboundBody,
          ).catch(() => null);
          if (extracted) variables[n.data.extractVarName] = extracted;
        }
      }
    }
  }

  // ── Generate AI reply ──────────────────────────────────────────────────────
  let replyText: string;
  let overrideNextNodeId: string | null = null;

  if (mode === "fully_autonomous") {
    const result = await generateFullyAutonomousReply(
      nodes,
      currentNode,
      chatHistory,
      inboundBody,
      variables,
      agentSettings,
    ).catch(async () => ({
      reply: await generateStructuredReply(
        currentNode,
        chatHistory,
        inboundBody,
        variables,
        agentSettings,
        bookingContext,
        isNew,
      ),
      nextNodeId: null as string | null,
    }));
    replyText = result.reply;
    overrideNextNodeId = result.nextNodeId;
  } else {
    replyText = await generateStructuredReply(
      currentNode,
      chatHistory,
      inboundBody,
      variables,
      agentSettings,
      bookingContext,
      isNew,
    );
  }

  if (!replyText) return;

  // ── Determine next node ────────────────────────────────────────────────────
  let nextNode: FlowNode | null = null;

  if (overrideNextNodeId) {
    nextNode = nodes.find((n) => n.id === overrideNextNodeId) ?? null;
  } else if (mode === "ai_assisted") {
    nextNode = await pickTransitionAI(currentNode, inboundBody, variables, nodes);
  } else {
    nextNode = pickTransitionKeyword(currentNode, replyText, nodes);
  }

  // ── Send reply ─────────────────────────────────────────────────────────────
  const isMediaNode = currentNode.data.kind === "wa_media";
  const mediaUrl = isMediaNode ? (currentNode.data.mediaUrl ?? undefined) : undefined;
  const messageBody =
    isMediaNode && currentNode.data.mediaCaption ? currentNode.data.mediaCaption : replyText;

  await sendAndPersist(messageBody, mediaUrl);

  // ── Update session ─────────────────────────────────────────────────────────
  const ended = nextNode?.data.kind === "ending";
  await updateSession({
    current_node_id: nextNode?.id ?? currentNodeId,
    workflow_variables: variables,
    message_count: (session?.message_count ?? 0) + 1,
    ended,
  });
}
