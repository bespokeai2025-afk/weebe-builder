import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ADMIN_EMAIL = "sales@webespokeai.com";

/**
 * Try to send the admin a "new signup awaiting approval" email.
 * Uses Lovable Emails if configured; otherwise logs the approval URL so the
 * admin can approve from the in-app admin page instead. Never throws —
 * signup itself must succeed even if email sending fails.
 */
async function notifyAdmin(opts: {
  userEmail: string;
  approveUrl: string;
  denyUrl: string;
  origin: string;
}) {
  const subject = `New Webespoke signup pending: ${opts.userEmail}`;
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;">New signup awaiting approval</h2>
      <p style="color:#444;margin:0 0 16px;">
        <strong>${opts.userEmail}</strong> just signed up for the Webespoke AI builder.
      </p>
      <p style="margin:24px 0;">
        <a href="${opts.approveUrl}" style="background:#16a34a;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;margin-right:8px;">Approve</a>
        <a href="${opts.denyUrl}" style="background:#dc2626;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">Deny</a>
      </p>
      <p style="color:#888;font-size:12px;">
        You can also manage all users at <a href="${opts.origin}/admin">${opts.origin}/admin</a>.
      </p>
    </div>
  `.trim();

  // Attempt 1: Lovable Email via fetch — works only after an email domain is configured.
  try {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (apiKey) {
      const res = await fetch("https://email.lovable.dev/v1/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: ADMIN_EMAIL,
          subject,
          html,
        }),
      });
      if (res.ok) return;
      console.warn("[notifyAdmin] Lovable email send failed:", res.status, await res.text());
    }
  } catch (e) {
    console.warn("[notifyAdmin] Lovable email error:", (e as Error).message);
  }

  // Fallback: log the approval URL so the admin can approve from the email
  // they get later, or from the /admin page.
  console.info(
    `[notifyAdmin] New signup: ${opts.userEmail}\n  Approve: ${opts.approveUrl}\n  Deny: ${opts.denyUrl}`,
  );
}

/**
 * Sign up a new user. We use the admin client so we can mint the user even
 * with auto-confirm flows, then push the admin a notification email.
 */
export const signUpUser = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; password: string }) => {
    if (!input.email || !input.email.includes("@")) throw new Error("Valid email required");
    if (!input.password || input.password.length < 8)
      throw new Error("Password must be at least 8 characters");
    return input;
  })
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    // Derive origin server-side from the request — never trust client input.
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    const reqUrl = new URL(req.url);
    const forwardedHost = req.headers.get("x-forwarded-host");
    const forwardedProto = req.headers.get("x-forwarded-proto");
    const host = forwardedHost ?? req.headers.get("host") ?? reqUrl.host;
    const proto = forwardedProto ?? reqUrl.protocol.replace(":", "") ?? "https";
    const origin = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? `${proto}://${host}`;

    // Create the user (auto-confirmed so they can log in immediately,
    // approval gate is enforced at the app layer).
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    if (!created.user) throw new Error("Signup failed");

    // The on_auth_user_created trigger already inserted a profile row.
    // Read it back to get the approval token.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("approval_token")
      .eq("user_id", created.user.id)
      .maybeSingle();

    const token = profile?.approval_token ?? "";
    const approveUrl = `${origin}/api/public/approve-user?token=${token}&action=approve`;
    const denyUrl = `${origin}/api/public/approve-user?token=${token}&action=deny`;

    await notifyAdmin({
      userEmail: email,
      approveUrl,
      denyUrl,
      origin,
    });

    return { ok: true };
  });

/**
 * Read the current user's profile (approval status). Used by the auth guard.
 */
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("approved, denied, email, created_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? { approved: false, denied: false, email: "", created_at: null };
  });

export const getMyAdminStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin");
    if (error) throw new Error(error.message);
    return { isAdmin: Array.isArray(data) && data.length > 0 };
  });

/** Admin: list pending + all profiles for the admin page. */
export const listAllProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Check admin role via the secure has_role function used in policies.
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin");
    if (!roleRows || roleRows.length === 0) throw new Error("Forbidden");

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, user_id, email, approved, denied, created_at, approval_decided_at, spend_limit_cents, spend_used_cents",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Admin: approve or deny a user. */
export const setUserApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string; approve: boolean }) => input)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin");
    if (!roleRows || roleRows.length === 0) throw new Error("Forbidden");

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        approved: data.approve,
        denied: !data.approve,
        approval_decided_at: new Date().toISOString(),
      })
      .eq("id", data.profileId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function assertAdmin(supabase: { from: typeof supabaseAdmin.from }, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin");
  if (!data || data.length === 0) throw new Error("Forbidden");
}

/** Admin: add credits (dollars) to a user's spend cap. */
export const addUserCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string; dollars: number }) => {
    if (!input.profileId) throw new Error("profileId required");
    if (!Number.isFinite(input.dollars) || input.dollars <= 0 || input.dollars > 10000)
      throw new Error("Enter a dollar amount between 0.01 and 10000");
    return input;
  })
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
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

/** Admin: reset a user's used spend back to zero. */
export const resetUserSpend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string }) => input)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ spend_used_cents: 0 })
      .eq("id", data.profileId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Current user: read own spend cap + usage. */
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

/**
 * Current user: record seconds of test-call cost into spend_used_cents.
 * Cost basis: $0.36/min = 0.6 cents/sec.
 * Returns the new totals and whether the cap is exceeded.
 */
export const recordTestCallCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { seconds: number }) => input)
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const seconds = Math.max(0, Math.floor(data.seconds));
    const addedCents = Math.ceil(seconds * 0.6);
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

    // Notify admin (best-effort) when a user first crosses their cap.
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
              to: ADMIN_EMAIL,
              subject: `User over spend cap: ${prof?.email ?? userId}`,
              html: `<p><strong>${prof?.email ?? userId}</strong> has hit their $${(limit / 100).toFixed(2)} test-call cap (used $${(used / 100).toFixed(2)}). Top up credits in the admin panel.</p>`,
            }),
          });
        }
      } catch (e) {
        console.warn("[recordTestCallCost] notify admin failed:", (e as Error).message);
      }
    }
    return { spendLimitCents: limit, spendUsedCents: used, overLimit: used >= limit };
  });
