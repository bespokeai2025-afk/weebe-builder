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

export interface WhitelabelPartner {
  id?: string;
  partner_name: string;
  slug: string;
  custom_domain?: string | null;
  logo_url?: string | null;
  favicon_url?: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  brand_name: string;
  tagline?: string | null;
  support_email?: string | null;
  support_url?: string | null;
  hide_powered_by: boolean;
  custom_css?: string | null;
  allowed_modules: string[];
  partner_tier: string;
  monthly_fee_pence: number;
  revenue_share_pct?: number | null;
  active: boolean;
  notes?: string | null;
  workspace_id?: string | null;
}

export const adminListWhitelabelPartners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("whitelabel_partners")
      .select(`
        *,
        workspaces ( name )
      `)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminCreateWhitelabelPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: WhitelabelPartner) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { data: created, error } = await supabaseAdmin
      .from("whitelabel_partners")
      .insert({
        partner_name: data.partner_name,
        slug: data.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        custom_domain: data.custom_domain || null,
        logo_url: data.logo_url || null,
        favicon_url: data.favicon_url || null,
        primary_color: data.primary_color,
        secondary_color: data.secondary_color,
        accent_color: data.accent_color,
        brand_name: data.brand_name,
        tagline: data.tagline || null,
        support_email: data.support_email || null,
        support_url: data.support_url || null,
        hide_powered_by: data.hide_powered_by,
        custom_css: data.custom_css || null,
        allowed_modules: data.allowed_modules,
        partner_tier: data.partner_tier,
        monthly_fee_pence: data.monthly_fee_pence,
        revenue_share_pct: data.revenue_share_pct ?? 0,
        active: data.active,
        notes: data.notes || null,
        workspace_id: data.workspace_id || null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return created;
  });

export const adminUpdateWhitelabelPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: WhitelabelPartner & { id: string }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { id, ...rest } = data;
    const { error } = await supabaseAdmin
      .from("whitelabel_partners")
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminToggleWhitelabelPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; active: boolean }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("whitelabel_partners")
      .update({ active: data.active, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteWhitelabelPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("whitelabel_partners")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
