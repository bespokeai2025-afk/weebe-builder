import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, user_id, email, full_name, user_type, default_workspace_id, created_at, spend_limit_cents, spend_used_cents",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator(
    (input: { email: string; password: string; fullName?: string; userType?: "admin" | "user" }) =>
      input,
  )
  .handler(async ({ data }) => {
    const userType = data.userType ?? "user";

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email.trim().toLowerCase(),
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, user_type: userType },
    });
    if (error) throw new Error(error.message);
    if (!created.user) throw new Error("User creation failed");

    if (userType === "admin") {
      const { error: updateErr } = await supabaseAdmin
        .from("profiles")
        .update({ user_type: "admin" })
        .eq("user_id", created.user.id);
      if (updateErr) throw updateErr;
    }

    return { ok: true, userId: created.user.id };
  });

export const updateUserType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input: { userId: string; userType: "admin" | "user" }) => input)
  .handler(async ({ data }) => {
    if (data.userType === "user") {
      const { count, error: countErr } = await supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("user_type", "admin")
        .neq("user_id", data.userId);
      if (countErr) throw countErr;
      if (count === 0) throw new Error("Cannot demote the last admin");
    }

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ user_type: data.userType })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deactivateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: "36500d",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addUserCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input: { profileId: string; dollars: number }) => input)
  .handler(async ({ data }) => {
    if (!Number.isFinite(data.dollars) || data.dollars <= 0 || data.dollars > 10000)
      throw new Error("Enter a dollar amount between 0.01 and 10000");
    const cents = Math.round(data.dollars * 100);
    const { data: cur, error: readErr } = await supabaseAdmin
      .from("profiles")
      .select("spend_limit_cents")
      .eq("id", data.profileId)
      .maybeSingle();
    if (readErr) throw readErr;
    const next = (cur?.spend_limit_cents ?? 500) + cents;
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ spend_limit_cents: next })
      .eq("id", data.profileId);
    if (error) throw new Error(error.message);
    return { spendLimitCents: next };
  });

export const resetUserSpend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input: { profileId: string }) => input)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ spend_used_cents: 0 })
      .eq("id", data.profileId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
