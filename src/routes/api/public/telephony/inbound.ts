/**
 * Public Twilio inbound-call webhook.
 *
 * Twilio hits this URL when a call comes in to one of our registered numbers.
 * Signature verification is mandatory and fails closed: the request must be
 * signed by the Twilio account that owns the number (see
 * `verifyTwilioRequestForWorkspace`) — it is never accepted unverified.
 *
 * Routing follows the number's Retell-style settings:
 *  1. Parse To / From / CallSid / FromCountry from the form body
 *  2. Look up the number → workspace and its routing settings
 *  3. Verify the Twilio signature (reject if invalid)
 *  4. Allowed inbound countries — reject callers from anywhere else
 *  5. Pick the agent (weighted inbound agents, else the assigned agent)
 *  6. Inbound webhook, if set — may reject, swap the agent, add dynamic variables
 *  7. No agent → fallback number, else a polite rejection
 *  8. Create the telephony_calls row and answer with <Connect><Stream/>
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  callInboundWebhook,
  candidateTwilioAuthTokens,
  escapeXml,
  resolveOverrideAgent,
  verifyTwilioRequestForWorkspace,
  verifyTwilioSignature,
  type SignatureCheck,
} from "@/lib/telephony/inbound-routing.server";
import {
  chooseInboundAgent,
  countriesForE164,
  isCountryAllowed,
  type NumberRoutingRow,
} from "@/lib/telephony/number-routing.shared";

export { verifyTwilioSignature };

const INBOUND_PATH = "/api/public/telephony/inbound";

type DbClient = typeof supabaseAdmin | { from: (table: string) => any };

/**
 * Verify Twilio's signature for this workspace's number. Extracted from the
 * route handler so it's directly testable without invoking TanStack Start's
 * route machinery (this codebase has no test harness for that).
 */
export async function resolveAndVerifyInboundSignature(
  workspaceId: string,
  request: Request,
  params: Record<string, string>,
  candidates: typeof candidateTwilioAuthTokens = candidateTwilioAuthTokens,
): Promise<SignatureCheck> {
  const result = await verifyTwilioRequestForWorkspace(
    supabaseAdmin,
    workspaceId,
    request,
    INBOUND_PATH,
    params,
    candidates,
  );
  if (!result.ok) {
    console.warn(
      `[telephony/inbound] rejected — ${result.reason === "credentials_unavailable" ? "no Twilio account configured for this workspace" : "signature does not match any of the workspace's Twilio accounts"}`,
    );
  }
  return result;
}

function twimlResponse(xml: string) {
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

const xmlHead = `<?xml version="1.0" encoding="UTF-8"?>`;

function rejectTwiml(message = "Sorry, this number is not currently active.") {
  return twimlResponse(`${xmlHead}<Response><Say>${escapeXml(message)}</Say><Hangup/></Response>`);
}

export type InboundRoutingOutcome =
  | { kind: "reject"; reason: string }
  | { kind: "message"; message: string; reason: string }
  | { kind: "fallback"; number: string; reason: string }
  | {
      kind: "agent";
      agentId: string;
      dynamicVariables: Record<string, string>;
      metadata: Record<string, unknown>;
      webhookUsed: boolean;
    };

export interface InboundRoutingInput {
  workspaceId: string;
  callSid: string;
  from: string;
  to: string;
  /** Twilio's `FromCountry`; the From number's calling code is used when it is absent. */
  fromCountry?: string;
  number: NumberRoutingRow;
}

export interface InboundRoutingDeps {
  sb: DbClient;
  fetchImpl?: typeof fetch;
  rand?: () => number;
}

/**
 * Decide what happens to an inbound call. Pure apart from the webhook call and the agent lookup,
 * both injectable, so every branch is testable.
 */
export async function decideInboundRouting(
  input: InboundRoutingInput,
  deps: InboundRoutingDeps,
): Promise<InboundRoutingOutcome> {
  const { number } = input;
  const fallback = String(number.fallback_number ?? "").trim();

  const callerCountries = input.fromCountry?.trim()
    ? [input.fromCountry.trim().toUpperCase()]
    : countriesForE164(input.from);
  if (!isCountryAllowed(number.allowed_inbound_countries, callerCountries)) {
    return { kind: "reject", reason: `caller country ${callerCountries.join("/") || "unknown"} not allowed` };
  }

  let agentId = chooseInboundAgent(number, deps.rand);
  let dynamicVariables: Record<string, string> = {};
  let metadata: Record<string, unknown> = {};
  let webhookUsed = false;

  const webhookUrl = String(number.inbound_webhook_url ?? "").trim();
  if (webhookUrl) {
    const decision = await callInboundWebhook(
      webhookUrl,
      { callId: input.callSid, agentId, fromNumber: input.from, toNumber: input.to },
      deps.fetchImpl,
    );
    if (decision) {
      webhookUsed = true;
      if (decision.reject) return { kind: "reject", reason: "inbound webhook rejected the call" };
      if (decision.overrideAgentId) {
        const override = await resolveOverrideAgent(deps.sb, input.workspaceId, decision.overrideAgentId);
        if (override) agentId = override;
        else console.warn(`[telephony/inbound] webhook override "${decision.overrideAgentId}" is not an agent in this workspace — ignored`);
      }
      dynamicVariables = decision.dynamicVariables;
      metadata = decision.metadata;
    } else {
      console.warn("[telephony/inbound] inbound webhook failed — using the number's own agent");
    }
  }

  if (!agentId) {
    if (fallback) return { kind: "fallback", number: fallback, reason: "no agent assigned" };
    return { kind: "message", message: "Sorry, this number is not currently active.", reason: "no agent assigned" };
  }
  return { kind: "agent", agentId, dynamicVariables, metadata, webhookUsed };
}

export const Route = createFileRoute("/api/public/telephony/inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Read raw body for Twilio signature verification
        const rawBody = await request.text().catch(() => "");
        const params: Record<string, string> = {};
        try {
          new URLSearchParams(rawBody).forEach((v, k) => { params[k] = v; });
        } catch {}

        const callSid = params["CallSid"] ?? "";
        const to      = params["To"]      ?? "";
        const from    = params["From"]    ?? "";

        if (!callSid || !to) return rejectTwiml();

        // Find the phone number → workspace → routing settings.
        const { data: numberRow } = await supabaseAdmin
          .from("phone_numbers")
          .select("*")
          .eq("phone_number", to)
          .eq("is_active", true)
          // One Twilio number can be connected to several workspaces (e.g. a shared
          // dialer caller ID). Route to the copy that has an agent, else the oldest,
          // instead of failing the lookup on duplicates.
          .order("agent_id", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!numberRow) {
          console.log("[telephony/inbound] unknown number:", to);
          return rejectTwiml();
        }
        const workspaceId = numberRow.workspace_id as string;

        const verified = await resolveAndVerifyInboundSignature(workspaceId, request, params);
        if (!verified.ok) {
          return new Response("Forbidden", { status: 403 });
        }
        const host = request.headers.get("host") ?? "";

        const outcome = await decideInboundRouting(
          {
            workspaceId,
            callSid,
            from,
            to,
            fromCountry: params["FromCountry"],
            number: numberRow as NumberRoutingRow,
          },
          { sb: supabaseAdmin },
        );

        if (outcome.kind === "reject") {
          console.log(`[telephony/inbound] callSid=${callSid} rejected: ${outcome.reason}`);
          return twimlResponse(`${xmlHead}<Response><Reject/></Response>`);
        }
        if (outcome.kind === "message") {
          console.log(`[telephony/inbound] callSid=${callSid} not connected: ${outcome.reason}`);
          return rejectTwiml(outcome.message);
        }
        if (outcome.kind === "fallback") {
          console.log(`[telephony/inbound] callSid=${callSid} → fallback ${outcome.number}: ${outcome.reason}`);
          return twimlResponse(`${xmlHead}<Response><Dial>${escapeXml(outcome.number)}</Dial></Response>`);
        }

        const callMetadata: Record<string, unknown> = {};
        if (Object.keys(outcome.dynamicVariables).length) {
          callMetadata.dynamic_variables = outcome.dynamicVariables;
        }
        if (Object.keys(outcome.metadata).length) callMetadata.webhook_metadata = outcome.metadata;

        // Insert telephony_calls row
        const { data: callRow, error: insertErr } = await supabaseAdmin
          .from("telephony_calls")
          .insert({
            workspace_id: workspaceId,
            phone_number_id: numberRow.id,
            agent_id: outcome.agentId,
            call_sid: callSid,
            direction: "inbound",
            from_number: from,
            to_number: to,
            status: "ringing",
            provider: "twilio",
            metadata: callMetadata as never,
          })
          .select("id")
          .single();

        if (insertErr) {
          console.error("[telephony/inbound] DB insert error:", insertErr.message);
          const fallback = String(numberRow.fallback_number ?? "").trim();
          if (fallback) {
            return twimlResponse(`${xmlHead}<Response><Dial>${escapeXml(fallback)}</Dial></Response>`);
          }
          return rejectTwiml("Sorry, we could not connect your call.");
        }

        await supabaseAdmin.from("call_events").insert({
          call_id: callRow.id,
          workspace_id: workspaceId,
          event_type: "status_change",
          event_data: { from: "initiated", to: "ringing", callSid },
        });

        // Build stream URL for the audio bridge (host resolved above)
        const streamUrl = `wss://${host}/api/telephony/stream/${callRow.id}`;
        // With a fallback number, Twilio asks us what to do once the stream ends, so a call the
        // voice engine could not take is forwarded instead of dropped. Without one, nothing follows
        // the stream and the call simply ends, as before.
        const fallback = String(numberRow.fallback_number ?? "").trim();
        const connectOpen = fallback
          ? `<Connect action="https://${escapeXml(host)}/api/public/telephony/stream-ended/${callRow.id}" method="POST">`
          : `<Connect>`;

        const twiml =
          `${xmlHead}\n` +
          `<Response>\n` +
          `  ${connectOpen}\n` +
          `    <Stream url="${escapeXml(streamUrl)}" />\n` +
          `  </Connect>\n` +
          `</Response>`;

        console.log(
          `[telephony/inbound] callSid=${callSid} callId=${callRow.id} from=${from} agent=${outcome.agentId}` +
            (outcome.webhookUsed ? " (via inbound webhook)" : ""),
        );
        return twimlResponse(twiml);
      },

      GET: async () =>
        new Response("Twilio inbound webhook — POST only", { status: 405 }),
    },
  },
});
