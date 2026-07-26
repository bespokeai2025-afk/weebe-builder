import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TemplateType =
  | "email"
  | "sms"
  | "whatsapp"
  | "document"
  | "proposal"
  | "quote"
  | "invoice"
  | "contract";

export type TemplateStatus = "active" | "archived";

export interface HexmailTemplate {
  id: string;
  workspace_id: string;
  name: string;
  type: TemplateType;
  subject: string | null;
  content: string;
  status: TemplateStatus;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export const listHexmailTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({ type: z.string().optional(), includeArchived: z.boolean().optional() })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    let q = sb
      .from("hexmail_templates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (data.type) q = q.eq("type", data.type);
    if (!data.includeArchived) q = q.eq("status", "active");
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as HexmailTemplate[];
  });

export const upsertHexmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        id: z.string().optional(),
        name: z.string().min(1),
        type: z.enum(["email", "sms", "whatsapp", "document", "proposal", "quote", "invoice", "contract"]),
        subject: z.string().optional().nullable(),
        content: z.string(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const now = new Date().toISOString();

    // ── Universal content safety gate (email templates only) ─────────────────
    // Run the gate on the email body before persisting, so violations surface to
    // the caller. The gate result is returned alongside the template id so the
    // UI can warn the user or block progression to Copy approval.
    let safetyPassed = true;
    let safetyViolations: string[] = [];
    let safetyWarnings: string[] = [];
    if (data.type === "email" && data.content.trim().length > 0) {
      try {
        const safetyMod = await import("@/lib/content-safety/universal-content-safety.server");
        const safetyResult = await safetyMod.runContentSafetyCheck(data.content, "email_campaign", workspaceId);
        safetyPassed      = safetyResult.passed;
        safetyViolations  = safetyResult.violations;
        safetyWarnings    = safetyResult.warnings;
      } catch (safetyErr: any) {
        console.error("[hexmail-template] Safety gate error:", safetyErr?.message ?? safetyErr);
        safetyPassed     = false;
        safetyViolations = ["gate_error: Content safety gate failed to run — resolve the error before this template can be used in campaigns."];
      }
    }

    if (data.id) {
      const { error } = await sb
        .from("hexmail_templates")
        .update({
          name: data.name,
          type: data.type,
          subject: data.subject ?? null,
          content: data.content,
          updated_at: now,
        })
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return { id: data.id, safetyPassed, safetyViolations, safetyWarnings };
    } else {
      const { data: row, error } = await sb
        .from("hexmail_templates")
        .insert({
          workspace_id: workspaceId,
          name: data.name,
          type: data.type,
          subject: data.subject ?? null,
          content: data.content,
          status: "active",
          usage_count: 0,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: row.id as string, safetyPassed, safetyViolations, safetyWarnings };
    }
  });

export const cloneHexmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { data: src, error: fetchErr } = await sb
      .from("hexmail_templates")
      .select("*")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .single();
    if (fetchErr || !src) throw new Error("Template not found");
    const { data: row, error } = await sb
      .from("hexmail_templates")
      .insert({
        workspace_id: workspaceId,
        name: `${src.name} (Copy)`,
        type: src.type,
        subject: src.subject,
        content: src.content,
        status: "active",
        usage_count: 0,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const archiveHexmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ id: z.string(), archive: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { error } = await sb
      .from("hexmail_templates")
      .update({ status: data.archive ? "archived" : "active", updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const incrementTemplateUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    await sb.rpc("increment_hexmail_template_usage", { template_id: data.id }).catch(() => {
      sb.from("hexmail_templates")
        .update({ usage_count: sb.raw("usage_count + 1") })
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
    });
    return { ok: true };
  });
