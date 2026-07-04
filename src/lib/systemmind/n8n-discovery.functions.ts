// ── SystemMind n8n Discovery — server functions (admin-only) ──────────────────
// Client-callable entry points for the Workflow Intelligence view.
// Every function is gated by requireSupabaseAuth + requirePlatformAdmin and
// scoped to the caller's workspace. Discovery is READ-ONLY against n8n.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";

// ── Connection status ─────────────────────────────────────────────────────────
export const getN8nStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { getN8nConnectionStatus } = await import(
      "@/lib/systemmind/n8n-discovery.server"
    );
    return getN8nConnectionStatus();
  });

// ── List discovered workflows ─────────────────────────────────────────────────
export const listN8nWorkflowsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async ({ context }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { listN8nWorkflows, getN8nConnectionStatus } = await import(
      "@/lib/systemmind/n8n-discovery.server"
    );
    const [workflows, status] = await Promise.all([
      listN8nWorkflows(workspaceId),
      Promise.resolve(getN8nConnectionStatus()),
    ]);
    return { ...status, workflows };
  });

// ── Workflow detail (full row incl. metadata + understanding) ─────────────────
export const getN8nWorkflowDetailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { getN8nWorkflowDetail } = await import(
      "@/lib/systemmind/n8n-discovery.server"
    );
    return getN8nWorkflowDetail(workspaceId, data.id);
  });

// ── Re-scan (READ-ONLY discovery) ─────────────────────────────────────────────
export const scanN8nWorkflowsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async ({ context }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { scanAndStoreN8nWorkflows } = await import(
      "@/lib/systemmind/n8n-discovery.server"
    );
    return scanAndStoreN8nWorkflows(workspaceId);
  });

// ── Generate / regenerate AI understanding for one workflow ────────────────────
export const understandN8nWorkflowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
    if (!apiKey) throw new Error("OpenAI API key not configured.");
    const { understandN8nWorkflow } = await import(
      "@/lib/systemmind/n8n-discovery.server"
    );
    return understandN8nWorkflow(workspaceId, data.id, apiKey);
  });
