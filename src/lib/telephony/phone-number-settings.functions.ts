/**
 * Per-number settings and actions, matching what Retell offers on a phone number:
 * inbound/outbound agents (weighted for A/B tests), inbound webhook, fallback number, allowed
 * countries, and "Make an outbound call".
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { placeNativeOutboundCall } from "./native-outbound.server";
import {
  E164,
  chooseOutboundAgent,
  normaliseAgentWeights,
  normaliseCountryList,
  validateAgentWeights,
  validateWebhookUrl,
  type NumberRoutingRow,
} from "./number-routing.shared";

const weightedAgents = z
  .array(z.object({ agent_id: z.string().uuid(), weight: z.number().positive() }))
  .max(10);

const countryList = z.array(z.string().trim().regex(/^[A-Za-z]{2}$/, "Use two-letter country codes")).max(250);

export const updatePhoneNumberRouting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        phoneNumberId: z.string().uuid(),
        inboundAgents: weightedAgents.optional(),
        outboundAgents: weightedAgents.optional(),
        inboundWebhookUrl: z.string().trim().max(2048).nullable().optional(),
        fallbackNumber: z.string().trim().nullable().optional(),
        allowedInboundCountries: countryList.optional(),
        allowedOutboundCountries: countryList.optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const { data: row, error } = await supabaseAdmin
      .from("phone_numbers")
      .select("id, provider")
      .eq("id", data.phoneNumberId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Phone number not found in this workspace.");
    if (row.provider === "retell_sip") {
      throw new Error("This number is managed in Retell. Change its routing in the agent's deployment settings.");
    }

    for (const list of [data.inboundAgents, data.outboundAgents]) {
      if (!list) continue;
      const problem = validateAgentWeights(list);
      if (problem) throw new Error(problem);
    }
    const agentIds = [
      ...new Set([...(data.inboundAgents ?? []), ...(data.outboundAgents ?? [])].map((a) => a.agent_id)),
    ];
    if (agentIds.length) {
      const { data: owned, error: agentError } = await supabaseAdmin
        .from("agents")
        .select("id")
        .eq("workspace_id", workspaceId)
        .in("id", agentIds);
      if (agentError) throw new Error(agentError.message);
      const ownedIds = new Set((owned ?? []).map((a) => a.id as string));
      if (agentIds.some((id) => !ownedIds.has(id))) {
        throw new Error("One of the chosen agents is not in this workspace.");
      }
    }

    if (data.inboundWebhookUrl) {
      const problem = validateWebhookUrl(data.inboundWebhookUrl);
      if (problem) throw new Error(problem);
    }
    if (data.fallbackNumber && !E164.test(data.fallbackNumber)) {
      throw new Error("Fallback number must be in international format, e.g. +447700900123.");
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.inboundAgents) {
      const weights = normaliseAgentWeights(data.inboundAgents);
      patch.inbound_agents = weights.length > 1 ? weights : null;
      // The assigned agent stays the primary inbound agent: the one with the largest share.
      patch.agent_id = weights.length
        ? [...weights].sort((a, b) => b.weight - a.weight)[0]!.agent_id
        : null;
    }
    if (data.outboundAgents) {
      const weights = normaliseAgentWeights(data.outboundAgents);
      patch.outbound_agents = weights.length ? weights : null;
    }
    if (data.inboundWebhookUrl !== undefined) patch.inbound_webhook_url = data.inboundWebhookUrl || null;
    if (data.fallbackNumber !== undefined) patch.fallback_number = data.fallbackNumber || null;
    if (data.allowedInboundCountries) {
      const list = normaliseCountryList(data.allowedInboundCountries);
      patch.allowed_inbound_countries = list.length ? list : null;
    }
    if (data.allowedOutboundCountries) {
      const list = normaliseCountryList(data.allowedOutboundCountries);
      patch.allowed_outbound_countries = list.length ? list : null;
    }

    const { error: updateError } = await supabaseAdmin
      .from("phone_numbers")
      .update(patch as never)
      .eq("id", data.phoneNumberId)
      .eq("workspace_id", workspaceId);
    if (updateError) {
      if (/column .* does not exist|schema cache/i.test(updateError.message)) {
        throw new Error(
          "Number routing isn't set up in the database yet. Apply migration 20261015000000_phone_number_routing.sql.",
        );
      }
      throw new Error(updateError.message);
    }
    return { success: true };
  });

export const placeCallFromNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        phoneNumberId: z.string().uuid(),
        to: z.string().trim().regex(E164, "Enter the number in international format, e.g. +447700900123"),
        /** Optional: a specific outbound agent; otherwise the number's outbound agents decide. */
        agentId: z.string().uuid().nullable().optional(),
        dynamicVariables: z.record(z.string(), z.string().max(2000)).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const { data: row, error } = await supabaseAdmin
      .from("phone_numbers")
      .select("*")
      .eq("id", data.phoneNumberId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Phone number not found in this workspace.");
    if (row.provider === "retell_sip") {
      throw new Error("This number is managed in Retell — place calls to it from Retell.");
    }

    const agentId = data.agentId ?? chooseOutboundAgent(row as NumberRoutingRow);
    if (!agentId) throw new Error("Assign an outbound agent to this number first.");
    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("id", agentId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!agent) throw new Error("The outbound agent is not in this workspace.");

    const dial = await placeNativeOutboundCall({
      sb: supabaseAdmin as never,
      workspaceId,
      agentId,
      to: data.to,
      fromNumber: row.phone_number as string,
      dynamicVariables: data.dynamicVariables ?? null,
      metadata: { trigger: "phone_number_page", workspace_id: workspaceId },
    });
    return { callId: dial.callId, status: dial.status, fromNumber: dial.fromNumber, agentId };
  });
