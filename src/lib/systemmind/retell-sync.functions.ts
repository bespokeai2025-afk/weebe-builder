/**
 * Server-fn wrappers for the Retell deployment sync + webhook management
 * layer (Task #458). All Retell API access stays server-side; responses are
 * redacted (hashes, states, counts) — raw keys/secrets never reach the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAction } from "@/lib/permissions/permissions.server";

function requireWorkspace(context: { workspaceId?: string | null }): string {
  const wsId = context.workspaceId;
  if (!wsId) throw new Error("No active workspace");
  return wsId;
}

// ── Sync status / compare ─────────────────────────────────────────────────────

/** List this workspace's builder agents for the sync panel selector. */
export const listRetellSyncAgents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = requireWorkspace(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("agents")
      .select("id, name, agent_type, retell_agent_id, settings, updated_at")
      .eq("workspace_id", wsId)
      .order("updated_at", { ascending: false })
      .limit(100);
    return {
      agents: (data ?? []).map((a) => {
        const s = (a.settings ?? {}) as Record<string, unknown>;
        return {
          id: a.id as string,
          name: (a.name as string | null) ?? "Untitled agent",
          agentType: (a.agent_type as string | null) ?? null,
          retellAgentId:
            ((s.deployedRetellAgentId as string | undefined) ||
              (a.retell_agent_id as string | null) ||
              null),
        };
      }),
    };
  });

export const getRetellSyncStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentRowId: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = requireWorkspace(context);
    const { getRetellSyncStatusServer } = await import(
      "@/lib/systemmind/retell-sync.server"
    );
    return getRetellSyncStatusServer(wsId, data.agentRowId);
  });

export const compareRetellConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentRowId: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = requireWorkspace(context);
    const { compareRetellConfigServer } = await import(
      "@/lib/systemmind/retell-sync.server"
    );
    return compareRetellConfigServer(wsId, data.agentRowId);
  });

/** Mark the live Retell config as imported (clears retell_not_imported). */
export const acknowledgeRetellImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentRowId: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = requireWorkspace(context);
    await requireAction(wsId, context.userId, "go_live");
    const { recordImportSnapshot } = await import(
      "@/lib/systemmind/retell-sync.server"
    );
    const res = await recordImportSnapshot(wsId, data.agentRowId);
    return { ok: true as const, ...res };
  });

// ── Extraction schema (post-call analysis) ────────────────────────────────────

/** Preview the extraction schema that WOULD be deployed (no Retell write). */
export const previewExtractionSchema = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentRowId: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = requireWorkspace(context);
    const [{ buildExtractionSchema }, { supabaseAdmin }] = await Promise.all([
      import("@/lib/systemmind/retell-sync.server"),
      import("@/integrations/supabase/client.server"),
    ]);
    const { data: vars } = await supabaseAdmin
      .from("systemmind_dynamic_variables")
      .select("name, label, description, data_type, status, direction, example_value, default_value")
      .eq("workspace_id", wsId)
      .eq("agent_id", data.agentRowId)
      .in("status", ["approved", "edited"]);
    return { fields: buildExtractionSchema((vars ?? []) as never[]) };
  });

/** Deploy the extraction schema to Retell with read-back verification. */
export const deployExtractionSchema = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentRowId: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = requireWorkspace(context);
    await requireAction(wsId, context.userId, "go_live");
    const { deployExtractionSchemaServer } = await import(
      "@/lib/systemmind/retell-sync.server"
    );
    return deployExtractionSchemaServer(wsId, data.agentRowId);
  });

// ── Webhook management ────────────────────────────────────────────────────────

export const getWebhookHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = requireWorkspace(context);
    const { getWebhookHealthServer } = await import(
      "@/lib/retell/retell-webhook-management.server"
    );
    return getWebhookHealthServer(wsId);
  });

export const retryFailedWebhooks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ledgerId?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const wsId = requireWorkspace(context);
    await requireAction(wsId, context.userId, "go_live");
    const { retryFailedWebhookDeliveries } = await import(
      "@/lib/retell/retell-webhook-management.server"
    );
    const results = await retryFailedWebhookDeliveries({
      workspaceId: wsId,
      ledgerId: data?.ledgerId,
    });
    return { results };
  });

export const sendTestWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { retellAgentId: string }) => input)
  .handler(async ({ data, context }) => {
    const wsId = requireWorkspace(context);
    await requireAction(wsId, context.userId, "go_live");
    const { sendTestWebhookPayload } = await import(
      "@/lib/retell/retell-webhook-management.server"
    );
    return sendTestWebhookPayload(wsId, data.retellAgentId);
  });

export const rotateRetellWebhookSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const wsId = requireWorkspace(context);
    await requireAction(wsId, context.userId, "go_live");
    const { rotateWebhookSecret } = await import(
      "@/lib/retell/retell-webhook-management.server"
    );
    return rotateWebhookSecret(wsId);
  });
