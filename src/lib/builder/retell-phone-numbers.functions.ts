/** Builder — Retell phone numbers: buy, import SIP, list, delete, assign to an agent. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  retellFetchForAgent,
  buyRetellPhoneNumberService,
  importSipPhoneNumberService,
  listRetellPhoneNumbersService,
  assignNumberToAgentService,
} from "@/lib/builder/retell-telephony.server";

/**
 * Buy a new phone number from Retell (Twilio-backed by default).
 * Markup is purely display-side; Retell bills its own rate.
 * Logic lives in retell-telephony.server.ts (shared with the orchestrator).
 */
export const buyRetellPhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
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
    return buyRetellPhoneNumberService({
      userId: context.userId,
      workspaceId: context.workspaceId,
      ...data,
    });
  });

/**
 * Import an existing phone number via SIP trunking.
 */
export const importSipPhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
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
    return importSipPhoneNumberService({
      userId: context.userId,
      workspaceId: context.workspaceId,
      ...data,
    });
  });

/** List phone numbers the workspace owns (for the deploy dialog). */
export const listRetellPhoneNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { productionApiKey?: string; agentRowId?: string } | undefined) => input ?? {},
  )
  .handler(async ({ data, context }) => {
    return listRetellPhoneNumbersService({
      userId: context.userId,
      workspaceId: context.workspaceId,
      agentRowId: data?.agentRowId,
      productionApiKey: data?.productionApiKey,
    });
  });

/**
 * Permanently release / delete a phone number from Retell.
 * This cancels the number and stops billing — it cannot be undone.
 */
export const deleteRetellPhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      phoneNumber: string;
      productionApiKey?: string;
      agentRowId?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    await retellFetchForAgent(
      `/delete-phone-number/${encodeURIComponent(data.phoneNumber)}`,
      null,
      "DELETE",
      context.userId,
      data.agentRowId,
      data.productionApiKey,
      context.workspaceId,
    );
    return { ok: true };
  });

/** Attach an already-owned number to a specific agent (for inbound). */
export const assignNumberToAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      phoneNumber: string;
      inboundAgentId?: string;
      outboundAgentId?: string;
      productionApiKey?: string;
      agentRowId?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    return assignNumberToAgentService({
      userId: context.userId,
      workspaceId: context.workspaceId,
      ...data,
    });
  });
