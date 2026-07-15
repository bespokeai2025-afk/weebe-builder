// ── SystemMind Guided Requirements Assistant — server fns (client boundary) ────
// Thin wrappers: auth middleware + zod input validation + dynamic import of the
// server module (string-literal specifiers — required for the prod build).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function requireWorkspaceId(workspaceId: string | undefined): string {
  if (!workspaceId) throw new Error("No workspace selected — join or create a workspace first.");
  return workspaceId;
}

export const startRequirementsInterview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ agentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { startRequirementsInterviewServer } = await import(
      "@/lib/systemmind/requirements.server"
    );
    return startRequirementsInterviewServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      agentId:     data.agentId,
    });
  });

export const getRequirementsInterview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ interviewId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const { getRequirementsInterviewServer } = await import(
      "@/lib/systemmind/requirements.server"
    );
    return getRequirementsInterviewServer(
      requireWorkspaceId(context.workspaceId),
      data.interviewId,
    );
  });

export const answerRequirementsQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      interviewId: z.string().uuid(),
      answers:     z.record(z.union([z.string().max(2000), z.number(), z.boolean()]))
                    .refine((r) => Object.keys(r).length > 0 && Object.keys(r).length <= 40, "Provide 1–40 answers."),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { answerRequirementsQuestionsServer } = await import(
      "@/lib/systemmind/requirements.server"
    );
    return answerRequirementsQuestionsServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      interviewId: data.interviewId,
      answers:     data.answers,
    });
  });

export const generateRequirementsVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ interviewId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { generateRequirementsVersionServer } = await import(
      "@/lib/systemmind/requirements.server"
    );
    return generateRequirementsVersionServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      interviewId: data.interviewId,
    });
  });

export const setScriptAdditionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      interviewId: z.string().uuid(),
      additionId:  z.string().min(1).max(60),
      decision:    z.enum(["approved", "rejected"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { setScriptAdditionStatusServer } = await import(
      "@/lib/systemmind/requirements.server"
    );
    return setScriptAdditionStatusServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      interviewId: data.interviewId,
      additionId:  data.additionId,
      decision:    data.decision,
    });
  });

export const simulateRequirements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      interviewId: z.string().uuid(),
      outcome:     z.string().max(40).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { simulateRequirementsServer } = await import(
      "@/lib/systemmind/requirements.server"
    );
    return simulateRequirementsServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      interviewId: data.interviewId,
      outcome:     data.outcome ?? null,
    });
  });

export const repromptRequirements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      interviewId: z.string().uuid(),
      instruction: z.string().min(3).max(2000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { repromptRequirementsServer } = await import(
      "@/lib/systemmind/requirements.server"
    );
    return repromptRequirementsServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      interviewId: data.interviewId,
      instruction: data.instruction,
    });
  });
