// ── Executive Bridge — isomorphic server-function wrappers ─────────────────────
// UI imports these. Each handler dynamically imports `./executive-bridge.server`
// so the server-only builders are NEVER bundled into the client.
//
// Calling convention: GET fns take no/optional input; POST fns use { data: input }.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── GrowthMind (CMO) executive summary ─────────────────────────────────────────
export const getGrowthMindExecutiveSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { buildGrowthMindExecutiveSummary } = await import("./executive-bridge.server");
    return buildGrowthMindExecutiveSummary(sb, workspaceId);
  });

// ── Executive Council master summary (ops + marketing merged) ──────────────────
export const getExecutiveCouncilSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { buildExecutiveCouncilSummary } = await import("./executive-bridge.server");
    return buildExecutiveCouncilSummary(sb, workspaceId);
  });

// ── Record an executive event ──────────────────────────────────────────────────
export const recordExecutiveEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      source:     z.enum(["hivemind", "growthmind"]),
      event_type: z.string().min(1).max(120),
      summary:    z.string().min(1).max(2000),
      severity:   z.enum(["info", "warning", "critical"]).optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { insertExecutiveEvent } = await import("./executive-bridge.server");
    return insertExecutiveEvent(sb, workspaceId, data);
  });

// ── Read executive events ──────────────────────────────────────────────────────
export const getExecutiveEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(100).optional() }).optional().parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) return [];
    const { selectExecutiveEvents } = await import("./executive-bridge.server");
    return selectExecutiveEvents(sb, workspaceId, data?.limit ?? 20);
  });
