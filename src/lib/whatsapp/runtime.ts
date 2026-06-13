/**
 * WhatsApp conversation runtime engine.
 *
 * Processes an inbound WhatsApp message through an agent's flow graph and
 * sends an automated reply via Twilio. Called from the Twilio webhook handler.
 *
 * Flow:
 *  1. Find the workspace's active WhatsApp agent
 *  2. Get/create conversation session (tracks current node)
 *  3. Fetch recent message history for context
 *  4. Call OpenAI to generate a reply from the current node's prompt
 *  5. Evaluate transitions to advance the node
 *  6. Send reply via Twilio REST API (with optional MediaUrl for wa_media nodes)
 *  7. Persist session + outbound message
 *
 * wa_media nodes: send a media URL (image/video/audio/document) via Twilio MMS.
 * wa_booking nodes: fetch live Cal.com slots and inject into AI context so the
 *   agent can present booking times as plain text over WhatsApp.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
    smsMessage?: string;
    /** wa_media: publicly accessible URL of the media to send */
    mediaUrl?: string;
    /** wa_media: optional caption shown below the media */
    mediaCaption?: string;
    /** wa_booking: fallback Cal.com or Calendly link sent when no API key */
    bookingUrl?: string;
    /** wa_booking: Cal.com event type ID (overrides workspace default) */
    bookingEventTypeId?: string;
    /** wa_booking: how many days ahead to look for slots (default 7) */
    bookingLookaheadDays?: number;
    transitions: Array<{ id: string; condition: string; target: string | null }>;
    [key: string]: unknown;
  };
}

interface RuntimeInput {
  workspaceId: string;
  contactPhone: string;
  contactName: string | null;
  inboundBody: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function sendMeta(
  to: string,
  body: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    const res = await fetch(url, {
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
    if (!res.ok) {
      console.error("[wa-runtime] Meta API error", json?.error?.message);
    }
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
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const params: Record<string, string> = {
      To: `whatsapp:${to}`,
      From: `whatsapp:${from}`,
      Body: body,
    };
    if (mediaUrl) params.MediaUrl = mediaUrl;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    });
    const json = (await res.json()) as any;
    if (!res.ok) {
      console.error("[wa-runtime] Twilio error", json?.code, json?.message);
    }
    return json?.sid ?? null;
  } catch (e) {
    console.error("[wa-runtime] sendTwilio failed", e);
    return null;
  }
}

async function callOpenAI(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 512,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as any;
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

function pickNextNode(
  currentNode: FlowNode,
  reply: string,
  allNodes: FlowNode[],
): FlowNode | null {
  if (!currentNode.data.transitions || currentNode.data.transitions.length === 0) return null;
  const replyLower = reply.toLowerCase();

  for (const t of currentNode.data.transitions) {
    if (!t.target) continue;
    const cond = t.condition?.toLowerCase() ?? "";
    if (!cond) {
      return allNodes.find((n) => n.id === t.target) ?? null;
    }
    if (replyLower.includes(cond) || cond.includes("always") || cond.includes("default")) {
      return allNodes.find((n) => n.id === t.target) ?? null;
    }
  }

  const first = currentNode.data.transitions.find((t) => t.target);
  return first ? (allNodes.find((n) => n.id === first.target) ?? null) : null;
}

/**
 * Fetch available Cal.com slots for the next `lookaheadDays` days.
 * Returns a human-readable text list, or null if Cal.com is not configured.
 */
async function fetchCalSlotSummary(
  workspaceId: string,
  eventTypeIdOverride?: string,
  lookaheadDays = 7,
): Promise<{ summary: string; bookingLink: string | null } | null> {
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

    const startTime = now.toISOString().split("T")[0];
    const endTime = end.toISOString().split("T")[0];

    const calRes = await fetch(
      `https://api.cal.com/v2/slots/available?eventTypeId=${eventTypeId}&startTime=${startTime}&endTime=${endTime}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!calRes.ok) {
      console.warn("[wa-runtime] Cal.com slots fetch failed", await calRes.text());
      return null;
    }

    const calData = (await calRes.json()) as any;
    const slotsByDay: Record<string, Array<{ time: string }>> =
      calData?.data?.slots ?? calData?.slots ?? {};

    const lines: string[] = [];
    for (const [day, daySlots] of Object.entries(slotsByDay)) {
      if (!Array.isArray(daySlots) || daySlots.length === 0) continue;
      const date = new Date(day);
      const dayLabel = date.toLocaleDateString("en-US", {
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

    if (lines.length === 0) return null;

    return {
      summary: lines.join("\n"),
      bookingLink: null,
    };
  } catch (e) {
    console.error("[wa-runtime] Cal.com slots error", e);
    return null;
  }
}

// ── Main runtime ──────────────────────────────────────────────────────────────

export async function processWhatsAppMessage(input: RuntimeInput): Promise<void> {
  const { workspaceId, contactPhone, contactName, inboundBody } = input;
  const sb = supabaseAdmin as any;

  // 1. Get workspace settings (creds for whichever provider is active)
  const { data: ws } = await sb
    .from("workspace_settings")
    .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id, whatsapp_provider, meta_phone_number_id, meta_access_token")
    .eq("workspace_id", workspaceId)
    .single();

  const provider = (ws?.whatsapp_provider as string | undefined) ?? "twilio";

  // Validate we have credentials for the active provider
  if (provider === "meta") {
    if (!ws?.meta_phone_number_id || !ws?.meta_access_token) {
      console.warn("[wa-runtime] Meta credentials not configured for workspace", workspaceId);
      return;
    }
  } else {
    const accountSid = ws?.twilio_account_sid ?? process.env.TWILIO_ACCOUNT_SID;
    const authToken  = ws?.twilio_auth_token  ?? process.env.TWILIO_AUTH_TOKEN;
    const fromPhone  = ws?.whatsapp_phone_id;
    if (!accountSid || !authToken || !fromPhone) {
      console.warn("[wa-runtime] Twilio credentials not configured for workspace", workspaceId);
      return;
    }
  }

  // 2. Find active WhatsApp agent for this workspace
  const { data: agentsRaw } = await sb
    .from("agents")
    .select("id, name, flow_data, settings, variables")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(20);

  const agents = (agentsRaw ?? []) as any[];
  const agent = agents.find((a) => {
    const settings = (typeof a.settings === "string" ? JSON.parse(a.settings) : a.settings) ?? {};
    return settings.channelType === "whatsapp";
  });

  if (!agent) {
    // No WhatsApp agent configured — messages stored, no auto-reply
    return;
  }

  const agentSettings = (typeof agent.settings === "string" ? JSON.parse(agent.settings) : agent.settings) ?? {};
  const flowData = (typeof agent.flow_data === "string" ? JSON.parse(agent.flow_data) : agent.flow_data) ?? {};
  const nodes: FlowNode[] = flowData.nodes ?? [];

  if (nodes.length === 0) return;

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
      })
      .select()
      .single();
    session = newSession;
  }

  if (session?.ended) return;

  const currentNodeId = session?.current_node_id ?? startNode.id;
  const currentNode = nodes.find((n) => n.id === currentNodeId) ?? startNode;

  // Handle ending node — close session
  if (currentNode.data.kind === "ending") {
    await sb
      .from("whatsapp_sessions")
      .update({ ended: true, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("contact_phone", contactPhone);
    return;
  }

  // 4. Fetch recent message history (last 10 messages) for context
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

  // 5. Build system prompt — pulls globalPrompt from agent settings + node dialogue
  const globalPrompt = agentSettings.globalPrompt ?? "";
  const nodePrompt   = currentNode.data.dialogue ?? currentNode.data.smsMessage ?? "";
  const agentName    = agentSettings.agentName ?? "Assistant";

  // 5a. For wa_booking nodes: fetch Cal.com slots and inject them
  let bookingContext = "";
  if (currentNode.data.kind === "wa_booking") {
    const lookahead = currentNode.data.bookingLookaheadDays ?? 7;
    const calResult = await fetchCalSlotSummary(
      workspaceId,
      currentNode.data.bookingEventTypeId,
      lookahead,
    );

    if (calResult && calResult.summary) {
      bookingContext = `\n\nAvailable appointment slots for the next ${lookahead} days:\n${calResult.summary}\n\nPresent these options naturally to the contact. Ask which slot works for them. Do not include raw ISO timestamps — use the friendly times shown above.`;
    } else if (currentNode.data.bookingUrl) {
      bookingContext = `\n\nShare this booking link with the contact: ${currentNode.data.bookingUrl}\nTell them they can click it to pick a time that works for them.`;
    }
  }

  const systemPrompt = [
    `You are ${agentName}, a WhatsApp AI assistant.`,
    globalPrompt ? `\n${globalPrompt}` : "",
    nodePrompt ? `\n\nCurrent instruction for this step:\n${nodePrompt}` : "",
    bookingContext,
    "\n\nReply concisely (1-3 sentences max). Do not use markdown. Be conversational.",
    isNew ? "\nThis is the first message — greet the user appropriately." : "",
  ]
    .filter(Boolean)
    .join("");

  // 6. Generate reply with OpenAI
  let replyText: string;
  try {
    const msgs: Array<{ role: "user" | "assistant"; content: string }> = [
      ...chatHistory.slice(-8),
      { role: "user", content: inboundBody },
    ];
    replyText = await callOpenAI(systemPrompt, msgs);
  } catch (e) {
    console.error("[wa-runtime] OpenAI error", e);
    return;
  }

  if (!replyText) return;

  // 7. Advance to next node based on transitions
  const nextNode = pickNextNode(currentNode, replyText, nodes);
  const nextNodeId = nextNode?.id ?? currentNodeId;

  // 8. Send reply via the active provider
  //    wa_media nodes: attach the configured media URL (Twilio only)
  //    All other nodes: text only
  const isMediaNode = currentNode.data.kind === "wa_media";
  const mediaUrl    = isMediaNode ? (currentNode.data.mediaUrl ?? undefined) : undefined;
  const messageBody = isMediaNode ? (currentNode.data.mediaCaption ?? replyText) : replyText;

  let sid: string | null = null;
  if (provider === "meta") {
    sid = await sendMeta(
      contactPhone,
      messageBody,
      ws.meta_phone_number_id as string,
      ws.meta_access_token as string,
    );
  } else {
    const accountSid = (ws?.twilio_account_sid ?? process.env.TWILIO_ACCOUNT_SID) as string;
    const authToken  = (ws?.twilio_auth_token  ?? process.env.TWILIO_AUTH_TOKEN)  as string;
    const fromPhone  = ws?.whatsapp_phone_id as string;
    sid = await sendTwilio(contactPhone, fromPhone, messageBody, accountSid, authToken, mediaUrl);
  }

  // 9. Persist outbound message
  if (sid) {
    await sb.from("whatsapp_messages").insert({
      workspace_id: workspaceId,
      external_id: sid,
      contact_phone: contactPhone,
      contact_name: contactName,
      direction: "outbound",
      body: messageBody,
      media_url: mediaUrl ?? null,
      status: "sent",
      sent_at: new Date().toISOString(),
    });
  }

  // 10. Update session state
  const ended = nextNode?.data.kind === "ending";
  await sb
    .from("whatsapp_sessions")
    .update({
      current_node_id: nextNodeId,
      message_count: (session?.message_count ?? 0) + 1,
      ended,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("contact_phone", contactPhone);
}
