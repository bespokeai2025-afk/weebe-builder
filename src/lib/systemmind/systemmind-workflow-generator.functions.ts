import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── generateWorkflowDraft ─────────────────────────────────────────────────────
export const generateWorkflowDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      description:  z.string().min(10),
      workflowType: z.string(),
      title:        z.string().min(1),
    }),
  )
  .handler(async ({ data, context }) => {
    const { generateWorkflowDraftFromDescription } = await import(
      "@/lib/systemmind/systemmind-workflow-generator.server"
    );
    return generateWorkflowDraftFromDescription(
      context.workspaceId,
      context.userId,
      data.description,
      data.workflowType as any,
      data.title,
    );
  });

// ── listWorkflowDrafts ────────────────────────────────────────────────────────
export const listGeneratorDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listWorkflowDraftsServer } = await import(
      "@/lib/systemmind/systemmind-workflow-generator.server"
    );
    return listWorkflowDraftsServer(context.workspaceId);
  });

// ── getWorkflowDraftById ──────────────────────────────────────────────────────
export const getGeneratorDraftById = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ draftId: z.string() }))
  .handler(async ({ data, context }) => {
    const { getWorkflowDraftByIdServer } = await import(
      "@/lib/systemmind/systemmind-workflow-generator.server"
    );
    return getWorkflowDraftByIdServer(context.workspaceId, data.draftId);
  });

// ── updateWorkflowDraftStatus ─────────────────────────────────────────────────
export const updateGeneratorDraftStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ draftId: z.string(), status: z.string() }))
  .handler(async ({ data, context }) => {
    const { updateWorkflowDraftStatusServer } = await import(
      "@/lib/systemmind/systemmind-workflow-generator.server"
    );
    await updateWorkflowDraftStatusServer(context.workspaceId, data.draftId, data.status);
    return { ok: true };
  });

// ── proposeSendDraftToBuilder ─────────────────────────────────────────────────
export const proposeSendDraftToBuilder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      draftId:                  z.string(),
      draftTitle:               z.string(),
      nodeCount:                z.number(),
      variableCount:            z.number(),
      toolCount:                z.number(),
      missingCapabilitiesCount: z.number(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { proposeSendDraftToBuilderServer } = await import(
      "@/lib/systemmind/systemmind-workflow-generator.server"
    );
    const actionId = await proposeSendDraftToBuilderServer(
      context.workspaceId,
      data.draftId,
      data.draftTitle,
      data.nodeCount,
      data.variableCount,
      data.toolCount,
      data.missingCapabilitiesCount,
    );
    return { actionId };
  });
