// SERVER ONLY — TanStack Start server functions for webform management.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── List webform sources ───────────────────────────────────────────────────────
export const listWebformSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { data } = await supabaseAdmin
      .from("webform_sources")
      .select("id, name, form_token, status, allowed_domains, default_source_type, default_source_detail, notify_email, field_mapping_json, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    return { sources: data ?? [] };
  });

// ── Create webform source ─────────────────────────────────────────────────────
export const createWebformSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      name:                  z.string().min(1).max(100),
      default_source_type:   z.string().default("website_form"),
      default_source_detail: z.string().optional(),
      notify_email:          z.string().email().optional().or(z.literal("")),
      allowed_domains:       z.array(z.string()).default([]),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { data: row, error } = await supabaseAdmin
      .from("webform_sources")
      .insert({
        workspace_id:          workspaceId,
        name:                  data.name,
        default_source_type:   data.default_source_type,
        default_source_detail: data.default_source_detail ?? null,
        notify_email:          data.notify_email || null,
        allowed_domains:       data.allowed_domains,
      })
      .select("id, name, form_token, status, allowed_domains, default_source_type, default_source_detail, notify_email, field_mapping_json, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return { source: row };
  });

// ── Update webform source ─────────────────────────────────────────────────────
export const updateWebformSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:                    z.string().uuid(),
      name:                  z.string().min(1).max(100).optional(),
      status:                z.enum(["active", "paused", "archived"]).optional(),
      default_source_type:   z.string().optional(),
      default_source_detail: z.string().nullable().optional(),
      notify_email:          z.string().email().nullable().optional().or(z.literal("")),
      allowed_domains:       z.array(z.string()).optional(),
      field_mapping_json:    z.record(z.string()).optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { id, ...rest } = data;
    const update: any = { ...rest, updated_at: new Date().toISOString() };
    if (update.notify_email === "") update.notify_email = null;
    const { error } = await supabaseAdmin
      .from("webform_sources")
      .update(update)
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Delete webform source ─────────────────────────────────────────────────────
export const deleteWebformSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { error } = await supabaseAdmin
      .from("webform_sources")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── List webform submissions ───────────────────────────────────────────────────
export const listWebformSubmissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      webformSourceId: z.string().uuid().optional(),
      limit:           z.number().int().min(1).max(100).default(50),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    let q = supabaseAdmin
      .from("webform_submissions")
      .select("id, webform_source_id, lead_id, source_type, source_detail, mapped_payload, utm_source, utm_medium, utm_campaign, referrer, status, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.webformSourceId) {
      q = q.eq("webform_source_id", data.webformSourceId) as any;
    }
    const { data: rows } = await q;
    return { submissions: rows ?? [] };
  });

// ── Get webform stats ─────────────────────────────────────────────────────────
export const getWebformStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const since30d = new Date(Date.now() - 30 * 86400000).toISOString();
    const [sourcesRes, submissionsRes] = await Promise.all([
      supabaseAdmin.from("webform_sources").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "active"),
      supabaseAdmin.from("webform_submissions").select("id, status", { count: "exact" }).eq("workspace_id", workspaceId).gte("created_at", since30d),
    ]);
    const submissions = submissionsRes.data ?? [];
    return {
      activeForms:    sourcesRes.count ?? 0,
      leads30d:       submissions.filter(s => s.status === "processed").length,
      duplicates30d:  submissions.filter(s => s.status === "duplicate").length,
      spam30d:        submissions.filter(s => s.status === "spam").length,
      total30d:       submissions.length,
    };
  });
