// Isomorphic server-function wrappers for call-script performance intelligence.
// UI imports these; server logic lives in growthmind.script-performance.server.ts
// and is dynamically imported so it never lands in the client bundle.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getScriptPerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { getLatestScriptAnalysis } = await import("@/lib/growthmind/growthmind.script-performance.server");
    return { analysis: await getLatestScriptAnalysis(sb, workspaceId) };
  });

export const runScriptPerformanceAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ force: z.boolean().optional() }).optional().parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { computeScriptPerformance } = await import("@/lib/growthmind/growthmind.script-performance.server");
    const analysis = await computeScriptPerformance(sb, workspaceId, { force: data?.force ?? true });
    return { analysis };
  });

export const createScriptRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      kind:     z.enum(["revision", "ab_experiment"]),
      agentKey: z.string().max(200).nullable().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { generateScriptRecommendation } = await import("@/lib/growthmind/growthmind.script-performance.server");
    return generateScriptRecommendation(sb, workspaceId, { kind: data.kind, agentKey: data.agentKey ?? null });
  });
