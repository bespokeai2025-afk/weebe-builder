// ── SystemMind CRM connections — server function entry points (Task #457) ────
// Thin createServerFn wrappers over crm-connections.server.ts. workspace_id and
// user_id come ONLY from the auth middleware context — never from client input.
// Credentials are WRITE-ONLY through saveCrmConnectionFn; every read is masked.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function gate(context: any, mode: "view" | "edit") {
  const { requireSystemMindView, requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
  if (mode === "edit") await requireSystemMindEdit(context.workspaceId, context.userId);
  else await requireSystemMindView(context.workspaceId, context.userId);
}

export const getCrmConnectorCatalogFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    await gate(context, "view");
    const { listConnectorCatalog } = await import("@/lib/systemmind/crm-connections.server");
    return listConnectorCatalog();
  });

export const listCrmConnectionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    await gate(context, "view");
    const { listCrmConnectionsServer } = await import("@/lib/systemmind/crm-connections.server");
    return listCrmConnectionsServer({ workspaceId: context.workspaceId });
  });

export const saveCrmConnectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id?: string | null; provider: string; label?: string; credentials: Record<string, string> }) =>
    z.object({
      id: z.string().uuid().nullish(),
      provider: z.string().min(1).max(40),
      label: z.string().max(120).optional(),
      credentials: z.record(z.string().max(8000)),
    }).parse(i),
  )
  .handler(async ({ context, data }: any) => {
    await gate(context, "edit");
    const { saveCrmConnectionServer } = await import("@/lib/systemmind/crm-connections.server");
    return saveCrmConnectionServer({
      workspaceId: context.workspaceId,
      userId: context.userId ?? null,
      id: data.id ?? null,
      provider: data.provider,
      label: data.label,
      credentials: data.credentials,
    });
  });

export const deleteCrmConnectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }: any) => {
    await gate(context, "edit");
    const { deleteCrmConnectionServer } = await import("@/lib/systemmind/crm-connections.server");
    return deleteCrmConnectionServer({ workspaceId: context.workspaceId, userId: context.userId ?? null, id: data.id });
  });

export const testCrmConnectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }: any) => {
    await gate(context, "edit");
    const { testCrmConnectionServer } = await import("@/lib/systemmind/crm-connections.server");
    return testCrmConnectionServer({ workspaceId: context.workspaceId, userId: context.userId ?? null, id: data.id });
  });

export const refreshCrmCredentialsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }: any) => {
    await gate(context, "edit");
    const { refreshCrmCredentialsServer } = await import("@/lib/systemmind/crm-connections.server");
    return refreshCrmCredentialsServer({ workspaceId: context.workspaceId, userId: context.userId ?? null, id: data.id });
  });

export const runCrmDiscoveryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }: any) => {
    await gate(context, "edit");
    const { runCrmDiscoveryServer } = await import("@/lib/systemmind/crm-connections.server");
    return runCrmDiscoveryServer({ workspaceId: context.workspaceId, userId: context.userId ?? null, id: data.id });
  });

export const getCrmDiscoveryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { connectionId: string }) => z.object({ connectionId: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }: any) => {
    await gate(context, "view");
    const { getCrmDiscoveryServer } = await import("@/lib/systemmind/crm-connections.server");
    return getCrmDiscoveryServer({ workspaceId: context.workspaceId, connectionId: data.connectionId });
  });
