import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin");
  if (!data || data.length === 0) throw new Error("Forbidden");
}

export type UserActivityRow = {
  profileId: string;
  userId: string;
  email: string;
  signedUpAt: string;
  approved: boolean;
  denied: boolean;
  adminReviewedAt: string | null;
  emails: Array<{
    id: string;
    template: string;
    status: string;
    createdAt: string;
    error: string | null;
  }>;
};

/** Admin: list users with their recent email send activity. */
export const listUserActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { onlyUnreviewed?: boolean } = {}) => input)
  .handler(async ({ context, data }): Promise<UserActivityRow[]> => {
    await assertAdmin(context.userId);

    let q = supabaseAdmin
      .from("profiles")
      .select("id, user_id, email, approved, denied, created_at, admin_reviewed_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.onlyUnreviewed) q = q.is("admin_reviewed_at", null);

    const { data: profiles, error } = await q;
    if (error) throw new Error(error.message);
    if (!profiles?.length) return [];

    const emails = profiles.map((p) => p.email).filter(Boolean) as string[];
    const { data: logs } = await supabaseAdmin
      .from("email_send_log")
      .select("id, message_id, template_name, recipient_email, status, error_message, created_at")
      .in("recipient_email", emails)
      .order("created_at", { ascending: false })
      .limit(500);

    // Dedupe by message_id (latest status wins).
    const latestByMsg = new Map<string, any>();
    for (const row of logs ?? []) {
      const key = row.message_id ?? row.id;
      if (!latestByMsg.has(key)) latestByMsg.set(key, row);
    }
    const byEmail = new Map<string, any[]>();
    for (const row of latestByMsg.values()) {
      const list = byEmail.get(row.recipient_email) ?? [];
      list.push(row);
      byEmail.set(row.recipient_email, list);
    }

    return profiles.map((p) => ({
      profileId: p.id,
      userId: p.user_id,
      email: p.email,
      signedUpAt: p.created_at,
      approved: p.approved,
      denied: p.denied,
      adminReviewedAt: p.admin_reviewed_at as string | null,
      emails: (byEmail.get(p.email) ?? []).map((r) => ({
        id: r.id,
        template: r.template_name,
        status: r.status,
        createdAt: r.created_at,
        error: r.error_message,
      })),
    }));
  });

/** Admin: toggle reviewed state on a user profile. */
export const setUserReviewed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string; reviewed: boolean }) => input)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        admin_reviewed_at: data.reviewed ? new Date().toISOString() : null,
        admin_reviewed_by: data.reviewed ? context.userId : null,
      })
      .eq("id", data.profileId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
