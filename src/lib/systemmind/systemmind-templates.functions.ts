// ── SystemMind Template Library — server functions (admin-only) ───────────────
// Client-callable entry points for the Workflow Template Library view.
// Every function is gated by requireSupabaseAuth + requirePlatformAdmin and
// scoped to the caller's workspace. Reads discovery tables only — never re-scans
// n8n and never deploys anything.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";

const idInput = (input: unknown) => z.object({ id: z.string().uuid() }).parse(input);

// ── Classification ────────────────────────────────────────────────────────────

export const listWorkflowsForTemplatesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async ({ context }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { listWorkflowsForTemplates } = await import("@/lib/systemmind/systemmind-templates.server");
    return listWorkflowsForTemplates(workspaceId);
  });

export const classifyWorkflowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator(idInput)
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key ?? "";
    const { classifyWorkflow } = await import("@/lib/systemmind/systemmind-templates.server");
    return classifyWorkflow(workspaceId, data.id, apiKey);
  });

export const classifyAllWorkflowsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ force: z.boolean().optional() }).parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { classifyAllWorkflows } = await import("@/lib/systemmind/systemmind-templates.server");
    return classifyAllWorkflows(workspaceId, data.force ?? false);
  });

export const setWorkflowClassificationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        type: z.enum(["reusable_template", "customer_specific", "experimental", "legacy", "archive"]),
        category: z.string().min(1).max(120),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { setWorkflowClassification } = await import("@/lib/systemmind/systemmind-templates.server");
    return setWorkflowClassification(workspaceId, data.id, data.type, data.category, userId);
  });

// ── Template listing / detail ─────────────────────────────────────────────────

export const listTemplatesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        category: z.string().optional(),
        status: z.string().optional(),
        templateType: z.string().optional(),
        tag: z.string().optional(),
        search: z.string().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { listTemplates } = await import("@/lib/systemmind/systemmind-templates.server");
    return listTemplates(workspaceId, data);
  });

export const getTemplateDetailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator(idInput)
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { getTemplateDetail } = await import("@/lib/systemmind/systemmind-templates.server");
    return getTemplateDetail(workspaceId, data.id);
  });

// ── Create / edit / clone ─────────────────────────────────────────────────────

export const createTemplateFromWorkflowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ workflowId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { createTemplateFromWorkflow } = await import("@/lib/systemmind/systemmind-templates.server");
    return createTemplateFromWorkflow(workspaceId, data.workflowId, userId);
  });

export const updateTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), patch: z.record(z.string(), z.any()) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { updateTemplate } = await import("@/lib/systemmind/systemmind-templates.server");
    return updateTemplate(workspaceId, data.id, data.patch, userId);
  });

export const cloneTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), newName: z.string().max(300).optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { cloneTemplate } = await import("@/lib/systemmind/systemmind-templates.server");
    return cloneTemplate(workspaceId, data.id, data.newName ?? "", userId);
  });

// ── Export / import ───────────────────────────────────────────────────────────

export const exportTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator(idInput)
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { exportTemplate } = await import("@/lib/systemmind/systemmind-templates.server");
    return exportTemplate(workspaceId, data.id);
  });

export const importTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ payload: z.any() }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { importTemplate } = await import("@/lib/systemmind/systemmind-templates.server");
    return importTemplate(workspaceId, data.payload, userId);
  });

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export const submitTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator(idInput)
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { submitTemplateForApproval } = await import("@/lib/systemmind/systemmind-templates.server");
    return submitTemplateForApproval(workspaceId, data.id);
  });

export const approveTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator(idInput)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { approveTemplate } = await import("@/lib/systemmind/systemmind-templates.server");
    return approveTemplate(workspaceId, data.id, userId);
  });

export const rejectTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator(idInput)
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { rejectTemplate } = await import("@/lib/systemmind/systemmind-templates.server");
    return rejectTemplate(workspaceId, data.id);
  });

export const archiveTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator(idInput)
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { archiveTemplate } = await import("@/lib/systemmind/systemmind-templates.server");
    return archiveTemplate(workspaceId, data.id);
  });

export const deleteTemplateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator(idInput)
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { deleteTemplate } = await import("@/lib/systemmind/systemmind-templates.server");
    return deleteTemplate(workspaceId, data.id);
  });
