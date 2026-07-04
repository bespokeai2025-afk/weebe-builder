// ── SystemMind Knowledge Graph — server functions (admin-only) ────────────────
// Client-callable entry points for the Knowledge Graph explorer. Every function
// is gated by requireSupabaseAuth + requirePlatformAdmin and scoped to the
// caller's workspace. Descriptive only — the builder derives a graph from
// existing data and never mutates any source system or deploys anything.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";

export const buildKnowledgeGraphFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async ({ context }) => {
    const { workspaceId, userId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { buildKnowledgeGraph } = await import("@/lib/systemmind/knowledge-graph.server");
    return buildKnowledgeGraph(workspaceId, userId ?? null);
  });

export const getKnowledgeGraphSummaryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async ({ context }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { getKnowledgeGraphSummary } = await import("@/lib/systemmind/knowledge-graph.server");
    return getKnowledgeGraphSummary(workspaceId);
  });

export const listKnowledgeGraphNodesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        nodeType: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().int().positive().max(1000).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { listKnowledgeGraphNodes } = await import("@/lib/systemmind/knowledge-graph.server");
    return listKnowledgeGraphNodes(workspaceId, data);
  });

export const getKnowledgeGraphViewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z.object({ limit: z.number().int().positive().max(1000).optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { getKnowledgeGraphView } = await import("@/lib/systemmind/knowledge-graph.server");
    return getKnowledgeGraphView(workspaceId, data.limit ?? 400);
  });

export const getNodeDependenciesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        nodeId: z.string().uuid(),
        depth: z.number().int().positive().max(4).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { getNodeDependencies } = await import("@/lib/systemmind/knowledge-graph.server");
    return getNodeDependencies(workspaceId, data.nodeId, data.depth ?? 2);
  });
