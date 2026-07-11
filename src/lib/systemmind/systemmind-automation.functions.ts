import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── generateAutomationDraft ───────────────────────────────────────────────────
export const generateAutomationDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      description: z.string().min(10).max(4000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { generateAutomationDraftServer } = await import(
      "@/lib/systemmind/systemmind-automation.server"
    );
    return generateAutomationDraftServer({
      workspaceId: context.workspaceId,
      userId:      context.userId ?? null,
      description: data.description,
      instructedBy: "user",
    });
  });

// ── listAutomationDrafts ──────────────────────────────────────────────────────
export const listAutomationDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listAutomationDraftsServer, isClaudeEnabled } = await import(
      "@/lib/systemmind/systemmind-automation.server"
    );
    const drafts = await listAutomationDraftsServer(context.workspaceId);
    return { drafts, claudeEnabled: isClaudeEnabled() };
  });

// ── listAutomationRuns ────────────────────────────────────────────────────────
export const listAutomationRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listAutomationRunsServer } = await import(
      "@/lib/systemmind/systemmind-automation.server"
    );
    return listAutomationRunsServer(context.workspaceId);
  });

// ── listAutomationAudit ───────────────────────────────────────────────────────
export const listAutomationAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ targetId: z.string().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { listAutomationAuditServer } = await import(
      "@/lib/systemmind/systemmind-automation.server"
    );
    return listAutomationAuditServer(context.workspaceId, data.targetId);
  });

// ── submitDraftForApproval ────────────────────────────────────────────────────
export const submitDraftForApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ draftId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { submitDraftForApprovalServer } = await import(
      "@/lib/systemmind/systemmind-automation.server"
    );
    return submitDraftForApprovalServer(context.workspaceId, context.userId ?? null, data.draftId);
  });

// ── rejectAutomationDraft ─────────────────────────────────────────────────────
export const rejectAutomationDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ draftId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { rejectDraftServer } = await import(
      "@/lib/systemmind/systemmind-automation.server"
    );
    await rejectDraftServer(context.workspaceId, context.userId ?? null, data.draftId);
    return { ok: true };
  });

// ── setAutomationPaused ───────────────────────────────────────────────────────
export const setAutomationPaused = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ draftId: z.string().uuid(), paused: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { setDraftPausedServer } = await import(
      "@/lib/systemmind/systemmind-automation.server"
    );
    await setDraftPausedServer(context.workspaceId, context.userId ?? null, data.draftId, data.paused);
    return { ok: true };
  });
