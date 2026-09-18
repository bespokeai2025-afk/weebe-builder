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
import { resolveOrCreateWorkspaceSubaccount } from "./twilio-credentials.server";
import {
  computePhoneNumberPrice,
  fetchTwilioNumberPrice,
  resolveMarkupRule,
  type TwilioNumberType,
} from "./twilio-pricing.server";

const E164 = /^\+[1-9]\d{6,14}$/;

// ── Shared helper: enforce workspace owner/admin ───────────────────────────────
// Same pattern as providers.functions.ts's requireWorkspaceAdmin — this codebase
// keeps one local copy per file rather than a shared export, so this matches
// that existing convention instead of introducing a new authorization system.
async function requireWorkspaceAdmin(
  supabase: any,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const { data } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  const role: string | undefined = data?.role;
  if (role !== "owner" && role !== "admin") {
    throw new Error("Forbidden: only workspace owners and admins can release phone numbers.");
  }
}

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
    return searchAvailableNumbers({ ...data, workspaceId: context.workspaceId });
  });

export interface PreviewPriceDeps {
  fetchPrice: typeof fetchTwilioNumberPrice;
  resolveMarkup: typeof resolveMarkupRule;
  computePrice: typeof computePhoneNumberPrice;
}

const defaultPreviewDeps: PreviewPriceDeps = {
  fetchPrice: fetchTwilioNumberPrice,
  resolveMarkup: resolveMarkupRule,
  computePrice: computePhoneNumberPrice,
};

/**
 * Read-only price preview for a search result set, shown before purchase.
 * Twilio's cost for a number is the same for every number of a given
 * (country, number type) pair, so one preview call covers an entire search
 * — it does not purchase anything or touch Twilio's purchase API, only the
 * Pricing API (via fetchTwilioNumberPrice, already built for the purchase
 * flow) and the same markup calculation the real purchase snapshots.
 *
 * Extracted as a core function (same pattern as purchaseVoiceNumberCore)
 * so it's directly testable without a createServerFn harness.
 */
export async function previewVoiceNumberPriceCore(
  sb: PurchaseDbClient,
  workspaceId: string,
  input: { country: string; tollFree: boolean },
  deps: PreviewPriceDeps = defaultPreviewDeps,
): Promise<{ priceGbpPence: number }> {
  const numberType: TwilioNumberType = input.tollFree ? "toll free" : "local";
  const price = await deps.fetchPrice(sb, { isoCountry: input.country, numberType });
  const markupRule = await deps.resolveMarkup(sb, workspaceId);
  const computed = deps.computePrice(price.currentPriceUsd, markupRule);
  return { priceGbpPence: computed.priceGbpPence };
}

export const previewVoiceNumberPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        country: z.string().length(2).default("US"),
        tollFree: z.boolean().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    return previewVoiceNumberPriceCore(supabaseAdmin, workspaceId, data);
  });

export interface PurchaseVoiceNumberInput {
  phoneNumber: string;
  friendlyName?: string;
  agentId?: string | null;
  capabilities?: { voice: boolean; sms: boolean };
  country: string;
  tollFree: boolean;
}

type PurchaseDbClient = Parameters<typeof resolveOrCreateWorkspaceSubaccount>[0];

export interface PurchaseVoiceNumberDeps {
  resolveSubaccount: typeof resolveOrCreateWorkspaceSubaccount;
  fetchPrice: typeof fetchTwilioNumberPrice;
  resolveMarkup: typeof resolveMarkupRule;
  computePrice: typeof computePhoneNumberPrice;
  purchase: typeof purchaseNumber;
  saveRow: typeof savePhoneNumberRow;
}

const defaultPurchaseDeps: PurchaseVoiceNumberDeps = {
  resolveSubaccount: resolveOrCreateWorkspaceSubaccount,
  fetchPrice: fetchTwilioNumberPrice,
  resolveMarkup: resolveMarkupRule,
  computePrice: computePhoneNumberPrice,
  purchase: purchaseNumber,
  saveRow: savePhoneNumberRow,
};

/**
 * Buy a number, wire it to our webhooks and record it — using WEBEE's
 * managed Twilio Subaccount model (no BYOK) and the reseller pricing/markup
 * system.
 *
 * Extracted from the createServerFn handler below so it's directly
 * testable, with every external dependency injectable (this codebase has
 * no test harness for a createServerFn handler itself).
 *
 * Ordering: idempotency lock -> subaccount credentials -> price + markup
 * (snapshotted now, never recomputed later) -> Twilio purchase -> DB save,
 * with the lock always released in `finally`. If the DB save fails after a
 * real Twilio purchase succeeded, that's logged loudly (not swallowed) —
 * it means Twilio is now billing WEBEE for a number with no billing record,
 * which needs manual reconciliation; this step doesn't build that tool.
 */
export async function purchaseVoiceNumberCore(
  sb: PurchaseDbClient,
  workspaceId: string,
  input: PurchaseVoiceNumberInput,
  deps: PurchaseVoiceNumberDeps = defaultPurchaseDeps,
): Promise<{ id: string; phoneNumber: string; sid: string; priceGbpPence: number }> {
  const { error: lockError } = await sb
    .from("phone_number_purchase_locks")
    .insert({ workspace_id: workspaceId, phone_number: input.phoneNumber });
  if (lockError) {
    if (lockError.code === "23505") {
      throw new Error(
        `A purchase for ${input.phoneNumber} is already in progress for this workspace. Please wait and try again.`,
      );
    }
    throw new Error(`Could not acquire purchase lock: ${lockError.message}`);
  }

  try {
    const credentials = await deps.resolveSubaccount(sb, workspaceId);

    const numberType: TwilioNumberType = input.tollFree ? "toll free" : "local";
    const price = await deps.fetchPrice(sb, { isoCountry: input.country, numberType });
    const markupRule = await deps.resolveMarkup(sb, workspaceId);
    const computed = deps.computePrice(price.currentPriceUsd, markupRule);

    const purchased = await deps.purchase({
      phoneNumber: input.phoneNumber,
      friendlyName: input.friendlyName,
      workspaceId,
      credentials,
    });

    let id: string;
    try {
      id = await deps.saveRow({
        workspaceId,
        phoneNumber: purchased.phoneNumber,
        providerSid: purchased.sid,
        friendlyName: input.friendlyName ?? purchased.friendlyName,
        agentId: input.agentId ?? null,
        capabilities: input.capabilities,
        twilioSubaccountSid: credentials.accountSid,
        costUsdCentsMonthly: computed.costUsdCents,
        priceGbpPenceMonthly: computed.priceGbpPence,
      });
    } catch (err) {
      console.error(
        `[phone-provisioning] CRITICAL: purchased ${purchased.phoneNumber} (SID ${purchased.sid}) on Twilio but failed to save it — this number is being billed with no record. Needs manual reconciliation.`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }

    return { id, phoneNumber: purchased.phoneNumber, sid: purchased.sid, priceGbpPence: computed.priceGbpPence };
  } finally {
    await sb
      .from("phone_number_purchase_locks")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("phone_number", input.phoneNumber);
  }
}

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
        country: z.string().length(2).default("US"),
        tollFree: z.boolean().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    return purchaseVoiceNumberCore(supabaseAdmin, workspaceId, data);
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

    const owned = await findOwnedNumber(data.phoneNumber, workspaceId);
    if (!owned) {
      throw new Error(
        `${data.phoneNumber} is not in the connected Twilio account. Buy it first, or check the credentials.`,
      );
    }
    // Import means "route this number to WEBEE", so repointing it is the job,
    // not a side effect.
    await configureNumberWebhooks(owned.sid, workspaceId);

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
        await configureNumberWebhooks(row.provider_sid as string, workspaceId);
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

export interface ReleaseVoiceNumberDeps {
  requireAdmin: typeof requireWorkspaceAdmin;
  release: typeof releaseNumber;
}

const defaultReleaseDeps: ReleaseVoiceNumberDeps = {
  requireAdmin: requireWorkspaceAdmin,
  release: releaseNumber,
};

/**
 * Release a number back to Twilio and drop the row.
 *
 * Irreversible, so it takes an explicit `confirm` rather than trusting a click.
 * Restricted to workspace owners/admins — verified server-side via
 * requireWorkspaceAdmin, independent of any UI visibility.
 *
 * Extracted as a core function (same pattern as purchaseVoiceNumberCore) so
 * it's directly testable without a createServerFn harness. Takes the
 * user's own RLS-bound client (for the role check — matches the calling
 * user's real session, same as providers.functions.ts's precedent) and the
 * admin client separately, mirroring exactly what the real handler does.
 */
export async function releaseVoiceNumberCore(
  userSupabase: PurchaseDbClient,
  adminSupabase: PurchaseDbClient,
  userId: string,
  workspaceId: string,
  input: { phoneNumberId: string },
  deps: ReleaseVoiceNumberDeps = defaultReleaseDeps,
): Promise<{ success: boolean; released: boolean }> {
  await deps.requireAdmin(userSupabase, userId, workspaceId);

  const { data: row } = await adminSupabase
    .from("phone_numbers")
    .select("id, provider, provider_sid")
    .eq("id", input.phoneNumberId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!row) throw new Error("Phone number not found in this workspace.");

  let released = false;
  if (row.provider === "twilio" && row.provider_sid) {
    await deps.release(row.provider_sid as string, workspaceId);
    released = true;
  }

  const { error } = await adminSupabase
    .from("phone_numbers")
    .delete()
    .eq("id", input.phoneNumberId)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  return { success: true, released };
}

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
    return releaseVoiceNumberCore(context.supabase, supabaseAdmin, context.userId, workspaceId, data);
  });
