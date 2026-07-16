/**
 * Reseller Portal / White Label server functions.
 *
 * Guard model (fail closed):
 *   • Every fn resolves the active workspace, then requires the relevant
 *     package feature (`reseller_client_accounts` / `white_labelling`) AND
 *     settings-page access at the right level (owner/admin by default).
 *   • Feature-gated white-label fields (custom domain, hide-WEBEE-branding)
 *     are only applied when their own feature keys are enabled.
 *   • Resellers never gain Master Admin tools — everything is parent-scoped.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveActiveWorkspace } from "@/lib/workspace/context.server";
import { isWbahWorkspaceId } from "@/lib/wbah-exclusion.shared";

async function ctxGuard(
  context: any,
  opts: { feature: "reseller_client_accounts" | "white_labelling"; level: "view" | "edit" },
) {
  const { supabase, workspaceId, userId } = context;
  if (!workspaceId) throw new Error("No active workspace");
  const ws = await resolveActiveWorkspace(supabase, userId);
  if (isWbahWorkspaceId(ws.workspaceId)) {
    throw new Error("This feature is not available for this workspace.");
  }
  const { requireFeatureAccess, requirePageAccessEntitled } = await import(
    "@/lib/packages/entitlements.server"
  );
  await requireFeatureAccess(ws.workspaceId, userId, opts.feature);
  await requirePageAccessEntitled(ws.workspaceId, userId, "settings", opts.level);
  return { workspaceId: ws.workspaceId, userId: userId as string, role: ws.workspaceRole };
}

export const getResellerOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = await ctxGuard(context, {
      feature: "reseller_client_accounts",
      level: "view",
    });
    const { listChildAccounts, getChildAccountUsage, getWhiteLabelSettings, ALLOWED_CHILD_PACKAGE_KEYS } =
      await import("@/lib/reseller/reseller.server");
    const [clients, usage, whiteLabel] = await Promise.all([
      listChildAccounts(workspaceId),
      getChildAccountUsage(workspaceId),
      getWhiteLabelSettings(workspaceId),
    ]);
    return { clients, usage, whiteLabel, allowedPackages: [...ALLOWED_CHILD_PACKAGE_KEYS] };
  });

export const createChildClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientName: z.string().min(1).max(120),
        clientEmail: z.string().email().max(200),
        packageKey: z.string().min(1).max(60),
        brandingMode: z.enum(["inherit", "webee", "custom"]).default("inherit"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = await ctxGuard(context, {
      feature: "reseller_client_accounts",
      level: "edit",
    });
    const { createChildClientAccount } = await import("@/lib/reseller/reseller.server");
    return await createChildClientAccount({
      parentWorkspaceId: workspaceId,
      actingUserId: userId,
      clientName: data.clientName,
      clientEmail: data.clientEmail,
      packageKey: data.packageKey,
      brandingMode: data.brandingMode,
    });
  });

export const setChildSuspended = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), suspended: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = await ctxGuard(context, {
      feature: "reseller_client_accounts",
      level: "edit",
    });
    const { setChildAccountSuspended } = await import("@/lib/reseller/reseller.server");
    return await setChildAccountSuspended({
      parentWorkspaceId: workspaceId,
      actingUserId: userId,
      clientId: data.clientId,
      suspended: data.suspended,
    });
  });

export const requestClientUpgrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ clientId: z.string().uuid(), requestedPackageKey: z.string().min(1).max(60) })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = await ctxGuard(context, {
      feature: "reseller_client_accounts",
      level: "edit",
    });
    const { requestChildUpgrade } = await import("@/lib/reseller/reseller.server");
    return await requestChildUpgrade({
      parentWorkspaceId: workspaceId,
      actingUserId: userId,
      clientId: data.clientId,
      requestedPackageKey: data.requestedPackageKey,
    });
  });

export const getMyWhiteLabelSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = await ctxGuard(context, {
      feature: "white_labelling",
      level: "view",
    });
    const { getWhiteLabelSettings } = await import("@/lib/reseller/reseller.server");
    const { getWorkspaceEntitlements } = await import("@/lib/packages/entitlements.server");
    const [settings, ent] = await Promise.all([
      getWhiteLabelSettings(workspaceId),
      getWorkspaceEntitlements(workspaceId),
    ]);
    return {
      settings,
      canCustomDomain: ent.features["white_label_custom_domain"] === true,
      canHideBranding: ent.features["white_label_hide_webee_branding"] === true,
      isReseller: ent.features["reseller_client_accounts"] === true,
    };
  });

export const saveMyWhiteLabelSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        brand_name: z.string().max(120).optional(),
        logo_url: z.string().max(500).optional(),
        favicon_url: z.string().max(500).optional(),
        primary_color: z.string().max(20).optional(),
        secondary_color: z.string().max(20).optional(),
        accent_color: z.string().max(20).optional(),
        support_email: z.string().max(200).optional(),
        email_from_name: z.string().max(120).optional(),
        child_branding_mode: z.enum(["inherit", "custom", "webee"]).optional(),
        custom_domain: z.string().max(200).optional(),
        hide_webee_branding: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = await ctxGuard(context, {
      feature: "white_labelling",
      level: "edit",
    });
    const { upsertWhiteLabelSettings } = await import("@/lib/reseller/reseller.server");
    const { getWorkspaceEntitlements } = await import("@/lib/packages/entitlements.server");
    const ent = await getWorkspaceEntitlements(workspaceId);
    return await upsertWhiteLabelSettings({
      workspaceId,
      actingUserId: userId,
      patch: data,
      allowCustomDomain: ent.features["white_label_custom_domain"] === true,
      allowHideBranding: ent.features["white_label_hide_webee_branding"] === true,
    });
  });
