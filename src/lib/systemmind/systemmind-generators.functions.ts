import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function requireWorkspaceId(workspaceId: string | undefined): string {
  if (!workspaceId) throw new Error("No workspace selected — join or create a workspace first.");
  return workspaceId;
}

// ── generateWhatsAppSetupDraft ────────────────────────────────────────────────
export const generateWhatsAppSetupDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      provider:    z.enum(["twilio", "wati", "meta"]),
      description: z.string().min(10).max(4000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { generateWhatsAppSetupDraftServer } = await import(
      "@/lib/systemmind/systemmind-generators.server"
    );
    return generateWhatsAppSetupDraftServer({
      workspaceId:  requireWorkspaceId(context.workspaceId),
      userId:       context.userId ?? null,
      provider:     data.provider,
      description:  data.description,
      instructedBy: "user",
    });
  });

// ── generateFollowUpSequenceDraft ─────────────────────────────────────────────
export const generateFollowUpSequenceDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      description: z.string().min(10).max(4000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { generateFollowUpSequenceDraftServer } = await import(
      "@/lib/systemmind/systemmind-generators.server"
    );
    return generateFollowUpSequenceDraftServer({
      workspaceId:  requireWorkspaceId(context.workspaceId),
      userId:       context.userId ?? null,
      description:  data.description,
      instructedBy: "user",
    });
  });

// ── convertN8nWorkflowToDraft ─────────────────────────────────────────────────
export const convertN8nWorkflowToDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      n8nRowId: z.string().uuid(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { convertN8nWorkflowServer } = await import(
      "@/lib/systemmind/systemmind-generators.server"
    );
    return convertN8nWorkflowServer({
      workspaceId:  requireWorkspaceId(context.workspaceId),
      userId:       context.userId ?? null,
      n8nRowId:     data.n8nRowId,
      instructedBy: "user",
    });
  });

// ── getAutomationDraftDetail ──────────────────────────────────────────────────
export const getAutomationDraftDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ draftId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const { getDraftDetailServer } = await import(
      "@/lib/systemmind/systemmind-generators.server"
    );
    return getDraftDetailServer(requireWorkspaceId(context.workspaceId), data.draftId);
  });

// ── listConvertibleN8nWorkflows (picker for the conversion tab) ───────────────
export const listConvertibleN8nWorkflows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const { listN8nWorkflows } = await import(
      "@/lib/systemmind/n8n-discovery.server"
    );
    return listN8nWorkflows(requireWorkspaceId(context.workspaceId));
  });
