/**
 * Server fns for cross-Mind orchestration (Executive Operator mode).
 * Thin wrappers over orchestration.server.ts — auth + workspace scoping here,
 * business logic in the shared service so mobile/API surfaces reuse it.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const playbookSchema = z.enum(["campaign_underperforming", "invoice_missing", "lead_not_followed_up"]);

export const runOrchestrationPlaybookFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ playbook: playbookSchema }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = (context as any).supabase;
    const workspaceId = (context as any).workspaceId as string;
    const userId = (context as any).userId;
    if (!workspaceId) throw new Error("No workspace");

    const { requirePageAccessEntitled } = await import("@/lib/packages/entitlements.server");
    await requirePageAccessEntitled(workspaceId, userId, "hivemind", "view");

    const { runOrchestrationPlaybook } = await import("@/lib/hivemind/orchestration.server");
    return runOrchestrationPlaybook(sb, workspaceId, data.playbook, {
      triggerSource: "manual",
      userId: (context as any).userId ?? null,
    });
  });

export const listOrchestrationRunsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = (context as any).supabase;
    const workspaceId = (context as any).workspaceId as string;
    const userId = (context as any).userId;
    if (!workspaceId) throw new Error("No workspace");

    const { requirePageAccessEntitled } = await import("@/lib/packages/entitlements.server");
    await requirePageAccessEntitled(workspaceId, userId, "hivemind", "view");

    const { listOrchestrationRuns } = await import("@/lib/hivemind/orchestration.server");
    return listOrchestrationRuns(sb, workspaceId);
  });
