/**
 * Probe production WATI webhook — checks HTTP status only (no DB writes).
 *
 *   node scripts/probe-wati-webhook.mjs
 *   WEBHOOK_URL='https://...' node scripts/probe-wati-webhook.mjs
 */
const workspaceId =
  process.env.WATI_WORKSPACE_ID?.trim() || "9bc09fc9-5841-40d6-94a8-d3074a15f988";
const webhookUrl =
  process.env.WEBHOOK_URL?.trim() ||
  `https://webeereceptionist.com/api/webhook/wati-inbound?workspace=${workspaceId}`;

const samples = [
  {
    label: "templateMessageSent_v2",
    body: {
      eventType: "templateMessageSent_v2",
      localMessageId: "probe-template-sent",
      waId: "447700000000",
      whatsappMessageId: "wamid.probe.template",
      statusString: "SENT",
    },
  },
  {
    label: "sentMessageREAD_v2 (no waId)",
    body: {
      eventType: "sentMessageREAD_v2",
      statusString: "Read",
      localMessageId: "probe-read-id",
      whatsappMessageId: "wamid.probe.read",
    },
  },
  {
    label: "campaign reply (sentMessageREPLIED_v2)",
    body: {
      eventType: "sentMessageREPLIED_v2",
      statusString: "Replied",
      localMessageId: "probe-reply-local",
      id: "probe-reply-evt",
      whatsappMessageId: "wamid.probe.reply",
      conversationId: "probe-conversation",
      ticketId: "probe-ticket",
      text: "webhook probe campaign reply",
      type: "text",
      timestamp: String(Math.floor(Date.now() / 1000)),
      waId: "447700000001",
    },
  },
  {
    body: {
      eventType: "message",
      owner: false,
      waId: "447700000000",
      text: "webhook probe inbound",
      whatsappMessageId: "wamid.probe.inbound",
      timestamp: String(Math.floor(Date.now() / 1000)),
    },
  },
];

console.log("Webhook URL:", webhookUrl);
console.log("");

for (const sample of samples) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sample.body),
  });
  const text = await res.text();
  const snippet = text.slice(0, 120).replace(/\s+/g, " ");
  console.log(`${sample.label}: HTTP ${res.status} — ${snippet}`);
}

console.log("\nExpected: HTTP 200 with JSON { ok: true } for all samples.");
console.log("If you see 500/HTML, production is missing SUPABASE_SERVICE_ROLE_KEY or old code is deployed.");
