import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Client-safe server-function entry points for lead email actions.
 *
 * Keep the implementation in lead-email.server.ts behind dynamic imports so
 * node:crypto and provider credentials never enter the browser bundle.
 */
export const sendComposedEmailToLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        leadId: z.string().uuid(),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(20000),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { fetchLead, sendEmailToLeadCore } = await import("@/lib/lead-gen/lead-email.server");
    const sb = supabase as any;
    const lead = await fetchLead(sb, workspaceId, data.leadId);

    const result = await sendEmailToLeadCore(sb, {
      workspaceId,
      leadId: lead.id,
      toEmail: lead.email,
      subject: data.subject,
      bodyText: data.body,
      trigger: "manual_compose",
      createdBy: userId ?? null,
    });

    if (!result.success) throw new Error(result.error ?? "Failed to send email");
    return { ok: true, id: result.id };
  });

export const sendTemplateEmailToLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        leadId: z.string().uuid(),
        templateId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { fetchLead, sendTemplateEmailToLeadCore } = await import("@/lib/lead-gen/lead-email.server");
    const sb = supabase as any;
    const lead = await fetchLead(sb, workspaceId, data.leadId);

    const result = await sendTemplateEmailToLeadCore(sb, {
      workspaceId,
      leadId: lead.id,
      templateId: data.templateId,
      lead,
      trigger: "manual_template",
      createdBy: userId ?? null,
    });

    if (!result.success) throw new Error(result.error ?? "Failed to send email");
    return { ok: true, id: result.id };
  });

export const getLeadAutoEmailSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { data } = await (supabase as any)
      .from("workspace_settings")
      .select("lead_auto_email_enabled, lead_auto_email_template_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    return {
      enabled: !!data?.lead_auto_email_enabled,
      templateId: (data?.lead_auto_email_template_id as string | null) ?? null,
    };
  });

export const saveLeadAutoEmailSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        enabled: z.boolean(),
        templateId: z.string().uuid().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { error } = await (supabase as any).from("workspace_settings").upsert(
      {
        workspace_id: workspaceId,
        lead_auto_email_enabled: data.enabled,
        lead_auto_email_template_id: data.templateId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listLeadEmailLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { data: rows, error } = await (supabase as any)
      .from("lead_email_log")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("lead_id", data.leadId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      if (error.message?.includes("does not exist")) return [];
      throw new Error(error.message);
    }
    return rows ?? [];
  });