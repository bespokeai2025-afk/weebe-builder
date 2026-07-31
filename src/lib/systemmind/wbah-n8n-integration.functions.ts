import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireActiveWbahWorkspace } from "@/lib/wbah-exclusion.shared";

async function assertWbahOrAdmin(
  supabase: { from: (t: string) => any },
  userId: string | undefined,
  workspaceId: string | null | undefined,
) {
  if (!workspaceId) throw new Error("No workspace");
  if (workspaceId) {
    try {
      requireActiveWbahWorkspace(workspaceId);
      return;
    } catch {
      /* not WBAH — require platform admin */
    }
  }
  if (!userId) throw new Error("Forbidden");
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_type")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile?.user_type === "admin") return;
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin");
  if (!roles?.length) throw new Error("Forbidden: WBAH workspace or platform admin required");
}

export const getWbahN8nIntegrationStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as any;
    await assertWbahOrAdmin(ctx.supabase, ctx.userId, ctx.workspaceId);
    const { getWbahN8nIntegrationStatusServer } = await import(
      "@/lib/systemmind/wbah-n8n-integration.server"
    );
    return getWbahN8nIntegrationStatusServer((context as any).workspaceId);
  });

export const seedWbahN8nSystemMindFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as any;
    await assertWbahOrAdmin(ctx.supabase, ctx.userId, ctx.workspaceId);
    const { seedWbahN8nSystemMindIntegrationServer } = await import(
      "@/lib/systemmind/wbah-n8n-integration.server"
    );
    return seedWbahN8nSystemMindIntegrationServer({
      workspaceId: (context as any).workspaceId,
      userId: (context as any).userId ?? null,
    });
  });

export const createWbahNewLeadsBuildSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as any;
    await assertWbahOrAdmin(ctx.supabase, ctx.userId, ctx.workspaceId);
    const { createWbahNewLeadsBuildSessionServer, saveWbahCallScriptAgentConfigServer } =
      await import("@/lib/systemmind/wbah-n8n-integration.server");
    const workspaceId = (context as any).workspaceId;
    const userId = (context as any).userId ?? null;
    const script = await saveWbahCallScriptAgentConfigServer({ workspaceId, userId });
    const session = await createWbahNewLeadsBuildSessionServer({ workspaceId, userId });
    return { ...session, callScriptConfigId: script.configId };
  });

export const saveWbahCallScriptConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as any;
    await assertWbahOrAdmin(ctx.supabase, ctx.userId, ctx.workspaceId);
    const { saveWbahCallScriptAgentConfigServer } = await import(
      "@/lib/systemmind/wbah-n8n-integration.server"
    );
    return saveWbahCallScriptAgentConfigServer({
      workspaceId: (context as any).workspaceId,
      userId: (context as any).userId ?? null,
    });
  });
