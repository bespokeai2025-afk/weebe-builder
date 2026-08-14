/**
 * Server functions for owning phone numbers directly on Twilio.
 *
 * The Retell path (`buyRetellPhoneNumber`, `importSipPhoneNumber`,
 * `assignNumberToAgent`) provisions numbers we cannot point anywhere else. These
 * do the same jobs against Twilio and record the result in `phone_numbers`, which
 * is what the native engine's inbound webhook reads.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildNumberWebhooks,
  configureNumberWebhooks,
  findOwnedNumber,
  purchaseNumber,
  releaseNumber,
  savePhoneNumberRow,
  searchAvailableNumbers,
} from "./twilio-numbers.server";

const E164 = /^\+[1-9]\d{6,14}$/;

export const searchVoiceNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        country: z.string().length(2).default("US"),
        areaCode: z.string().regex(/^\d{2,5}$/).optional(),
        contains: z.string().max(20).optional(),
        tollFree: z.boolean().default(false),
        smsEnabled: z.boolean().default(false),
        limit: z.number().int().min(1).max(50).default(20),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    if (!context.workspaceId) throw new Error("No active workspace");
    return searchAvailableNumbers(data);
  });

/**
 * Buy a number, wire it to our webhooks and record it.
 *
 * Ordering matters: the number is registered in `phone_numbers` only after Twilio
 * confirms the purchase, so a failed buy cannot leave a row for a number we do
 * not own. The reverse (a purchased number with no row) is recoverable through
 * import.
 */
export const purchaseVoiceNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        phoneNumber: z.string().regex(E164, "Expected E.164, e.g. +14155552671"),
        friendlyName: z.string().max(64).optional(),
        agentId: z.string().uuid().nullable().optional(),
        capabilities: z
          .object({ voice: z.boolean(), sms: z.boolean() })
          .default({ voice: true, sms: false }),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const purchased = await purchaseNumber({
      phoneNumber: data.phoneNumber,
      friendlyName: data.friendlyName,
    });
    const id = await savePhoneNumberRow({
      workspaceId,
      phoneNumber: purchased.phoneNumber,
      providerSid: purchased.sid,
      friendlyName: data.friendlyName ?? purchased.friendlyName,
      agentId: data.agentId ?? null,
      capabilities: data.capabilities,
    });

    return { id, phoneNumber: purchased.phoneNumber, sid: purchased.sid };
  });

/** Adopt a number that is already in the Twilio account. */
export const importVoiceNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        phoneNumber: z.string().regex(E164, "Expected E.164, e.g. +14155552671"),
        friendlyName: z.string().max(64).optional(),
        agentId: z.string().uuid().nullable().optional(),
        capabilities: z
          .object({ voice: z.boolean(), sms: z.boolean() })
          .default({ voice: true, sms: false }),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const owned = await findOwnedNumber(data.phoneNumber);
    if (!owned) {
      throw new Error(
        `${data.phoneNumber} is not in the connected Twilio account. Buy it first, or check the credentials.`,
      );
    }
    // Import means "route this number to WEBEE", so repointing it is the job,
    // not a side effect.
    await configureNumberWebhooks(owned.sid);

    const id = await savePhoneNumberRow({
      workspaceId,
      phoneNumber: owned.phoneNumber,
      providerSid: owned.sid,
      friendlyName: data.friendlyName ?? owned.friendlyName,
      agentId: data.agentId ?? null,
      capabilities: data.capabilities,
    });

    return { id, phoneNumber: owned.phoneNumber, sid: owned.sid };
  });

/**
 * Point a number at an agent.
 *
 * Also re-applies the webhooks, because a number whose Voice URL drifted (edited
 * in the Twilio console, or imported before this existed) would otherwise stay
 * silently disconnected while the UI showed it as assigned.
 */
export const assignVoiceNumberToAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        phoneNumberId: z.string().uuid(),
        agentId: z.string().uuid().nullable(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const { data: row, error } = await supabaseAdmin
      .from("phone_numbers")
      .select("id, provider, provider_sid, phone_number")
      .eq("id", data.phoneNumberId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Phone number not found in this workspace.");

    let webhooksConfigured = false;
    if (row.provider === "twilio" && row.provider_sid) {
      try {
        await configureNumberWebhooks(row.provider_sid as string);
        webhooksConfigured = true;
      } catch (err) {
        // Assignment is a DB fact and still worth saving; the caller is told the
        // routing half did not land.
        console.warn(
          "[phone-provisioning] webhook refresh failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from("phone_numbers")
      .update({ agent_id: data.agentId, updated_at: new Date().toISOString() })
      .eq("id", data.phoneNumberId)
      .eq("workspace_id", workspaceId);
    if (updateError) throw new Error(updateError.message);

    return { success: true, webhooksConfigured, ...buildNumberWebhooks() };
  });

/**
 * Release a number back to Twilio and drop the row.
 *
 * Irreversible, so it takes an explicit `confirm` rather than trusting a click.
 */
export const releaseVoiceNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        phoneNumberId: z.string().uuid(),
        confirm: z.literal(true),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const { data: row } = await supabaseAdmin
      .from("phone_numbers")
      .select("id, provider, provider_sid")
      .eq("id", data.phoneNumberId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!row) throw new Error("Phone number not found in this workspace.");

    let released = false;
    if (row.provider === "twilio" && row.provider_sid) {
      await releaseNumber(row.provider_sid as string);
      released = true;
    }

    const { error } = await supabaseAdmin
      .from("phone_numbers")
      .delete()
      .eq("id", data.phoneNumberId)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);

    return { success: true, released };
  });
