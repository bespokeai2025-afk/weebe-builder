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
 *  6. Send reply via Twilio REST API
 *  7. Persist session + outbound message
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

async function sendTwilio(
  to: string,
  from: string,
  body: string,
  accountSid: string,
  authToken: string,
): Promise<string | null> {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: `whatsapp:${to}`, From: `whatsapp:${from}`, Body: body }),
    });
    const json = (await res.json()) as any;
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

  // Try to match a transition condition to the reply content
  for (const t of currentNode.data.transitions) {
    if (!t.target) continue;
    const cond = t.condition?.toLowerCase() ?? "";
    if (!cond) {
      // Unconditional — always match
      return allNodes.find((n) => n.id === t.target) ?? null;
    }
    // Simple keyword matching on the AI reply or condition
    if (replyLower.includes(cond) || cond.includes("always") || cond.includes("default")) {
      return allNodes.find((n) => n.id === t.target) ?? null;
    }
  }

  // Fallback: take first transition with a target
  const first = currentNode.data.transitions.find((t) => t.target);
  return first ? (allNodes.find((n) => n.id === first.target) ?? null) : null;
}

// ── Main runtime ──────────────────────────────────────────────────────────────

export async function processWhatsAppMessage(input: RuntimeInput): Promise<void> {
  const { workspaceId, contactPhone, contactName, inboundBody } = input;
  const sb = supabaseAdmin as any;

  // 1. Get workspace settings (Twilio creds)
  const { data: ws } = await sb
    .from("workspace_settings")
    .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id")
    .eq("workspace_id", workspaceId)
    .single();

  const accountSid = ws?.twilio_account_sid ?? process.env.TWILIO_ACCOUNT_SID;
  const authToken  = ws?.twilio_auth_token  ?? process.env.TWILIO_AUTH_TOKEN;
  const fromPhone  = ws?.whatsapp_phone_id;

  if (!accountSid || !authToken || !fromPhone) {
    console.warn("[wa-runtime] Twilio credentials not configured for workspace", workspaceId);
    return;
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

  // Skip if session is ended
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

  // 5. Build system prompt
  const globalPrompt = agentSettings.globalPrompt ?? "";
  const nodePrompt   = currentNode.data.dialogue ?? currentNode.data.smsMessage ?? "";
  const agentName    = agentSettings.agentName ?? "Assistant";

  const systemPrompt = [
    `You are ${agentName}, a WhatsApp AI assistant.`,
    globalPrompt ? `\n${globalPrompt}` : "",
    nodePrompt
      ? `\n\nCurrent instruction for this step:\n${nodePrompt}`
      : "",
    "\n\nReply concisely (1-3 sentences max). Do not use markdown. Be conversational.",
    isNew ? "\nThis is the first message — greet the user appropriately." : "",
  ]
    .filter(Boolean)
    .join("");

  // 6. Generate reply with OpenAI
  let replyText: string;
  try {
    // Add the current inbound message if not already in history
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

  // 8. Send reply via Twilio
  const sid = await sendTwilio(contactPhone, fromPhone, replyText, accountSid, authToken);

  // 9. Persist outbound message
  if (sid) {
    await sb.from("whatsapp_messages").insert({
      workspace_id: workspaceId,
      external_id: sid,
      contact_phone: contactPhone,
      contact_name: contactName,
      direction: "outbound",
      body: replyText,
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
