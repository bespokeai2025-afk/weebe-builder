import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertPlatformAdmin(supabase: typeof supabaseAdmin, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("user_type")
    .eq("user_id", userId)
    .eq("user_type", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("email, full_name, user_type, default_workspace_id, created_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (
      data ?? {
        email: "",
        full_name: null,
        user_type: "user",
        default_workspace_id: null,
        created_at: null,
      }
    );
  });

export const getMyAdminStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("user_type")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { isAdmin: data?.user_type === "admin" };
  });

/**
 * Admin: list all profiles for the admin page.
 */
export const listAllProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    await assertPlatformAdmin(supabaseAdmin, userId);

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, user_id, email, full_name, user_type, created_at, spend_limit_cents, spend_used_cents, default_workspace_id",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Admin: add credits (dollars) to a user's spend cap.
 */
export const addUserCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string; dollars: number }) => input)
  .handler(async ({ context, data }) => {
    const { userId } = context;
    await assertPlatformAdmin(supabaseAdmin, userId);

    if (!Number.isFinite(data.dollars) || data.dollars <= 0 || data.dollars > 10000)
      throw new Error("Enter a dollar amount between 0.01 and 10000");
    const cents = Math.round(data.dollars * 100);
    const { data: cur, error: readErr } = await supabaseAdmin
      .from("profiles")
      .select("spend_limit_cents")
      .eq("id", data.profileId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const next = (cur?.spend_limit_cents ?? 500) + cents;
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ spend_limit_cents: next })
      .eq("id", data.profileId);
    if (error) throw new Error(error.message);
    return { spendLimitCents: next };
  });

/**
 * Admin: reset a user's used spend back to zero.
 */
export const resetUserSpend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string }) => input)
  .handler(async ({ context, data }) => {
    const { userId } = context;
    await assertPlatformAdmin(supabaseAdmin, userId);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ spend_used_cents: 0 })
      .eq("id", data.profileId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Current user: read own spend cap + usage.
 */
export const getMySpend = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("spend_limit_cents, spend_used_cents, email")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      spendLimitCents: data?.spend_limit_cents ?? 500,
      spendUsedCents: data?.spend_used_cents ?? 0,
      email: data?.email ?? "",
    };
  });

// Per-second cost rates in cents, keyed by deployment mode.
// OmniVoice default: $0.36/min = 0.6 ¢/s
// VoxStream (ElevenLabs): $0.05/min ≈ 0.0833 ¢/s
// HyperStream (OpenAI Realtime): $0.09/min = 0.15 ¢/s (token-exact path preferred)
const CENTS_PER_SECOND: Record<string, number> = {
  ELEVENLABS_NATIVE: 0.05 / 60 * 100,   // ≈ 0.0833 ¢/s
  OPENAI_REALTIME:   0.09 / 60 * 100,   // ≈ 0.15 ¢/s
};
const DEFAULT_CENTS_PER_SECOND = 0.36 / 60 * 100; // ≈ 0.6 ¢/s (OmniVoice)

/**
 * Current user: record seconds of test-call cost into spend_used_cents.
 * Pass deploymentMode to apply the correct per-provider rate:
 *   - "ELEVENLABS_NATIVE" → $0.05/min (VoxStream)
 *   - "OPENAI_REALTIME"   → $0.09/min (HyperStream, fallback only)
 *   - omitted / other    → $0.36/min (OmniVoice default)
 */
export const recordTestCallCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { seconds: number; deploymentMode?: string | null }) => input)
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const seconds = Math.max(0, Math.floor(data.seconds));
    const ratePerSec = CENTS_PER_SECOND[data.deploymentMode ?? ""] ?? DEFAULT_CENTS_PER_SECOND;
    const addedCents = Math.ceil(seconds * ratePerSec);
    const { data: cur, error: readErr } = await supabaseAdmin
      .from("profiles")
      .select("spend_limit_cents, spend_used_cents")
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const limit = cur?.spend_limit_cents ?? 500;
    const used = (cur?.spend_used_cents ?? 0) + addedCents;
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ spend_used_cents: used })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    if (used >= limit && (cur?.spend_used_cents ?? 0) < limit) {
      try {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (apiKey) {
          const { data: prof } = await supabaseAdmin
            .from("profiles")
            .select("email")
            .eq("user_id", userId)
            .maybeSingle();
          await fetch("https://email.lovable.dev/v1/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              to: process.env.SEED_ADMIN_EMAIL ?? "admin@webespokeai.com",
              subject: `User over spend cap: ${prof?.email ?? userId}`,
              html: `<p><strong>${prof?.email ?? userId}</strong> has hit their $${(limit / 100).toFixed(2)} test-call cap.</p>`,
            }),
          });
        }
      } catch {
        // Email notification is non-critical
      }
    }
    return { spendLimitCents: limit, spendUsedCents: used, overLimit: used >= limit };
  });
