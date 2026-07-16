/**
 * Reseller / white-label hierarchy server layer.
 *
 * Parent workspaces with the `reseller_client_accounts` entitlement can create
 * branded child client workspaces. Invariants:
 *   • All reads/writes are PARENT-scoped (children never see siblings;
 *     resellers only see their own children).
 *   • Child creation is capped by limits.maxChildAccounts + extra_child_account
 *     addon quantity (fail closed).
 *   • Children remain ordinary workspaces — always visible/auditable to WEBEE
 *     Master Admin via the existing admin workspace tools.
 *   • Billing provider integration is out of scope: billing_mode is recorded
 *     as an internal state only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAccessAudit } from "@/lib/permissions/permissions.server";
import {
  ADDON_EXTRA_CHILD_ACCOUNT,
  packageByKey,
} from "@/lib/packages/packages.shared";
import {
  FeatureLockedError,
  getWorkspaceEntitlements,
  invalidateEntitlementsCache,
  provisionWorkspacePackage,
} from "@/lib/packages/entitlements.server";
import { escapeHtml, renderBasicEmail } from "@/lib/email/resend.server";
import { sendWorkspaceEmail } from "@/lib/email/email-dispatch.server";

const sb = supabaseAdmin as any;

/** Packages a reseller may assign to child client accounts. */
export const ALLOWED_CHILD_PACKAGE_KEYS = [
  "trial",
  "receptionist_lite",
  "receptionist_pro",
  "executive_suite",
] as const;

export interface ChildAccountUsage {
  allowance: number; // included + addon slots (null limit → high sentinel)
  unlimited: boolean;
  used: number;
  remaining: number;
  /** false when usage could not be verified (reads failed) — treat as no capacity. */
  verified: boolean;
}

/** Child-account allowance = package limit + active extra_child_account addons. */
export async function getChildAccountUsage(workspaceId: string): Promise<ChildAccountUsage> {
  try {
    const [ent, { data: addons, error: aErr }, { count, error: cErr }] = await Promise.all([
      getWorkspaceEntitlements(workspaceId),
      sb.from("workspace_addons").select("addon_key, quantity, status").eq("workspace_id", workspaceId),
      sb.from("reseller_client_accounts")
        .select("id", { count: "exact", head: true })
        .eq("parent_workspace_id", workspaceId)
        .neq("status", "terminated"),
    ]);
    if (aErr || cErr) throw new Error(aErr?.message ?? cErr?.message);
    const extra = (addons ?? [])
      .filter((a: any) => a.addon_key === ADDON_EXTRA_CHILD_ACCOUNT && a.status === "active")
      .reduce((n: number, a: any) => n + Number(a.quantity ?? 0), 0);
    const limit = ent.limits.maxChildAccounts;
    const unlimited = limit === null;
    const allowance = unlimited ? Number.MAX_SAFE_INTEGER : (limit ?? 0) + extra;
    const used = count ?? 0;
    return { allowance, unlimited, used, remaining: Math.max(allowance - used, 0), verified: true };
  } catch {
    // Fail closed: unable to verify → no capacity.
    return { allowance: 0, unlimited: false, used: 0, remaining: 0, verified: false };
  }
}

export async function requireChildAccountCapacity(workspaceId: string): Promise<void> {
  const usage = await getChildAccountUsage(workspaceId);
  if (usage.remaining <= 0) {
    throw new FeatureLockedError(
      ADDON_EXTRA_CHILD_ACCOUNT,
      usage.allowance === 0
        ? "Your package does not include reseller client accounts. Upgrade your package or add client account slots."
        : `You have reached your client account limit (${usage.allowance} account${usage.allowance === 1 ? "" : "s"}). Add extra client account slots to create more.`,
    );
  }
}

// ── White label settings ─────────────────────────────────────────────────────

export async function getWhiteLabelSettings(workspaceId: string) {
  const { data, error } = await sb
    .from("workspace_white_label_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

const WL_EDITABLE_FIELDS = [
  "brand_name", "logo_url", "favicon_url", "primary_color", "secondary_color",
  "accent_color", "support_email", "email_from_name", "child_branding_mode",
] as const;

export async function upsertWhiteLabelSettings(opts: {
  workspaceId: string;
  actingUserId: string | null;
  patch: Record<string, unknown>;
  /** Feature-gated fields, only applied when the caller verified the feature. */
  allowCustomDomain: boolean;
  allowHideBranding: boolean;
}) {
  const clean: Record<string, unknown> = {};
  for (const k of WL_EDITABLE_FIELDS) {
    if (k in opts.patch) {
      const v = opts.patch[k];
      clean[k] = v === "" || v === undefined ? null : v;
    }
  }
  if (clean.child_branding_mode != null &&
      !["inherit", "custom", "webee"].includes(String(clean.child_branding_mode))) {
    throw new Error("Invalid child branding mode");
  }
  if (opts.allowCustomDomain && "custom_domain" in opts.patch) {
    const dom = String(opts.patch.custom_domain ?? "").trim().toLowerCase();
    clean.custom_domain = dom || null;
    clean.custom_domain_status = dom ? "requested" : "none";
  }
  if (opts.allowHideBranding && "hide_webee_branding" in opts.patch) {
    clean.hide_webee_branding = opts.patch.hide_webee_branding === true;
  }
  const { data, error } = await sb
    .from("workspace_white_label_settings")
    .upsert(
      {
        workspace_id: opts.workspaceId,
        ...clean,
        updated_by: opts.actingUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await writeAccessAudit({
    workspaceId: opts.workspaceId,
    actingUserId: opts.actingUserId,
    objectType: "white_label_settings",
    objectId: opts.workspaceId,
    actionType: "update",
    afterState: clean,
    riskLevel: "low",
  });
  return data;
}

/**
 * Branding a CHILD workspace should render, resolved through the hierarchy:
 * child custom > parent inherit > WEBEE default (null).
 */
export async function resolveEffectiveBranding(workspaceId: string) {
  const own = await getWhiteLabelSettings(workspaceId);
  const { data: rel } = await sb
    .from("workspace_relationships")
    .select("parent_workspace_id, status")
    .eq("child_workspace_id", workspaceId)
    .maybeSingle();
  if (!rel || rel.status !== "active") return { source: own ? "own" : "webee", settings: own };
  const { data: client } = await sb
    .from("reseller_client_accounts")
    .select("branding_mode")
    .eq("child_workspace_id", workspaceId)
    .maybeSingle();
  const mode = client?.branding_mode ?? "inherit";
  if (mode === "custom" && own) return { source: "own" as const, settings: own };
  if (mode === "webee") return { source: "webee" as const, settings: null };
  const parent = await getWhiteLabelSettings(rel.parent_workspace_id);
  return parent
    ? { source: "parent" as const, settings: parent }
    : { source: "webee" as const, settings: own };
}

// ── Child account lifecycle ──────────────────────────────────────────────────

async function uniqueSlug(base: string): Promise<string> {
  const baseSlug =
    base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";
  let slug = baseSlug;
  let n = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data } = await sb.from("workspaces").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
    n++;
    slug = `${baseSlug}-${n}`;
  }
}

function getAppUrl(): string {
  return (
    process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || "https://webeereceptionist.com"
  );
}

export interface CreateChildInput {
  parentWorkspaceId: string;
  actingUserId: string;
  clientName: string;
  clientEmail: string;
  packageKey: string;
  brandingMode: "inherit" | "webee" | "custom";
}

/**
 * Create a child client workspace: workspace + relationship + client record +
 * package subscription + owner invite email. Rolls the workspace back if a
 * required step fails. Post-insert capacity re-check guards racing creates.
 */
export async function createChildClientAccount(input: CreateChildInput) {
  const clientName = input.clientName.trim();
  const clientEmail = input.clientEmail.trim().toLowerCase();
  if (!clientName) throw new Error("Client name is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) throw new Error("A valid client email is required");
  if (!(ALLOWED_CHILD_PACKAGE_KEYS as readonly string[]).includes(input.packageKey)) {
    throw new Error("That package cannot be assigned to client accounts.");
  }
  if (!["inherit", "webee", "custom"].includes(input.brandingMode)) {
    throw new Error("Invalid branding mode");
  }
  await requireChildAccountCapacity(input.parentWorkspaceId);

  // 1. Workspace
  const slug = await uniqueSlug(clientName);
  const { data: ws, error: wsErr } = await sb
    .from("workspaces")
    .insert({ name: clientName, slug, owner_id: input.actingUserId })
    .select("id")
    .single();
  if (wsErr) throw new Error(wsErr.message);
  const childWorkspaceId: string = ws.id;

  const rollback = async () => {
    await sb.from("workspace_relationships").delete().eq("child_workspace_id", childWorkspaceId);
    await sb.from("reseller_client_accounts").delete().eq("child_workspace_id", childWorkspaceId);
    await sb.from("workspace_subscriptions").delete().eq("workspace_id", childWorkspaceId);
    await sb.from("workspace_invites").delete().eq("workspace_id", childWorkspaceId);
    await sb.from("workspaces").delete().eq("id", childWorkspaceId);
  };

  try {
    // 2. Relationship link
    {
      const { error } = await sb.from("workspace_relationships").insert({
        parent_workspace_id: input.parentWorkspaceId,
        child_workspace_id: childWorkspaceId,
        relationship_type: "reseller_client",
        status: "active",
        created_by: input.actingUserId,
      });
      if (error) throw new Error(error.message);
    }
    // 3. Client account record
    const { data: client, error: cErr } = await sb
      .from("reseller_client_accounts")
      .insert({
        parent_workspace_id: input.parentWorkspaceId,
        child_workspace_id: childWorkspaceId,
        client_name: clientName,
        client_email: clientEmail,
        package_key: input.packageKey,
        status: "invited",
        branding_mode: input.brandingMode,
        billing_mode: "reseller_billed",
        created_by: input.actingUserId,
      })
      .select("*")
      .single();
    if (cErr) throw new Error(cErr.message);

    // Post-insert capacity re-check (racing creates roll back). Unknown usage
    // (verification failure) is treated as over-capacity — fail closed.
    const usage = await getChildAccountUsage(input.parentWorkspaceId);
    if (!usage.verified || usage.used > usage.allowance) {
      throw new FeatureLockedError(
        ADDON_EXTRA_CHILD_ACCOUNT,
        `You have reached your client account limit (${usage.allowance}).`,
      );
    }

    // 4. Package (explicit subscription row — same provisioning path as signup).
    await provisionWorkspacePackage({
      workspaceId: childWorkspaceId,
      packageKey: input.packageKey,
      status: input.packageKey === "trial" ? "trial" : "active",
      actingUserId: input.actingUserId,
    });

    // 5. Owner invite for the client (owner role can't be invited via the
    //    normal path; child owners get admin — the reseller retains ownership).
    const { data: invite, error: iErr } = await sb
      .from("workspace_invites")
      .insert({
        email: clientEmail,
        role: "admin",
        invited_role_key: "admin",
        invited_by: input.actingUserId,
        workspace_id: childWorkspaceId,
      })
      .select("id, token")
      .single();
    if (iErr) throw new Error(iErr.message);

    // Membership for the reseller acting user so the parent can administer.
    {
      const { error } = await sb.from("workspace_members").insert({
        workspace_id: childWorkspaceId,
        user_id: input.actingUserId,
        role: "owner",
      });
      if (error) throw new Error(error.message);
    }

    await writeAccessAudit({
      workspaceId: input.parentWorkspaceId,
      actingUserId: input.actingUserId,
      objectType: "reseller_client_account",
      objectId: client.id,
      actionType: "create",
      afterState: {
        childWorkspaceId,
        clientEmail,
        packageKey: input.packageKey,
        brandingMode: input.brandingMode,
      },
      riskLevel: "high",
    });

    // Notify the parent workspace that a client account was created (best-effort).
    try {
      const { emitCampaignNotification } = await import("@/lib/notifications/notification-engine.shared");
      await emitCampaignNotification(sb, {
        workspaceId: input.parentWorkspaceId,
        eventKey: "reseller_client_created",
        summary: `Client account "${clientName}" was created (${clientEmail}, package: ${input.packageKey}). An invite email has been sent to the client.`,
      });
    } catch (nErr: any) {
      console.warn("[reseller] client-created notification failed (non-fatal):", nErr?.message ?? nErr);
    }

    // Best-effort branded invite email.
    try {
      const parentWl = await getWhiteLabelSettings(input.parentWorkspaceId);
      const brand =
        input.brandingMode !== "webee" && parentWl?.brand_name ? parentWl.brand_name : "WEBEE";
      const url = `${getAppUrl()}/invite/${invite.token}`;
      await sendWorkspaceEmail(sb, {
        workspaceId: input.parentWorkspaceId,
        to: clientEmail,
        subject: `Your ${brand} account is ready`,
        html: renderBasicEmail({
          heading: `Welcome to ${escapeHtml(brand)}`,
          bodyHtml: `<p><strong>${escapeHtml(clientName)}</strong> has been set up for you on ${escapeHtml(brand)}.</p><p style="margin-top:20px;"><a href="${url}" style="background:#6d5df6;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Activate your account</a></p><p style="color:#7c7c8a;font-size:13px;">If you weren't expecting this, you can safely ignore this email.</p>`,
        }),
      });
    } catch (e: any) {
      console.warn("[reseller] client invite email failed (non-fatal):", e?.message ?? e);
    }

    return { client, childWorkspaceId, inviteId: invite.id };
  } catch (e) {
    await rollback();
    throw e;
  }
}

/** Assert the client row belongs to the parent workspace (IDOR guard). */
async function requireOwnClient(parentWorkspaceId: string, clientId: string) {
  const { data, error } = await sb
    .from("reseller_client_accounts")
    .select("*")
    .eq("id", clientId)
    .eq("parent_workspace_id", parentWorkspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Client account not found");
  return data;
}

export async function setChildAccountSuspended(opts: {
  parentWorkspaceId: string;
  actingUserId: string;
  clientId: string;
  suspended: boolean;
}) {
  const client = await requireOwnClient(opts.parentWorkspaceId, opts.clientId);
  const status = opts.suspended ? "suspended" : client.child_workspace_id ? "active" : "invited";
  const now = new Date().toISOString();
  const { error } = await sb
    .from("reseller_client_accounts")
    .update({ status, updated_at: now })
    .eq("id", client.id);
  if (error) throw new Error(error.message);
  if (client.child_workspace_id) {
    const { error: relErr } = await sb
      .from("workspace_relationships")
      .update({ status: opts.suspended ? "suspended" : "active", updated_at: now })
      .eq("child_workspace_id", client.child_workspace_id);
    if (relErr) {
      // Compensate: revert client status so hierarchy state stays consistent.
      await sb
        .from("reseller_client_accounts")
        .update({ status: client.status, updated_at: new Date().toISOString() })
        .eq("id", client.id);
      throw new Error(relErr.message);
    }
    // Suspend the child's subscription → entitlements degrade automatically.
    const { error: subErr } = await sb
      .from("workspace_subscriptions")
      .update({
        subscription_status: opts.suspended
          ? "suspended"
          : client.package_key === "trial" ? "trial" : "active",
        updated_at: now,
      })
      .eq("workspace_id", client.child_workspace_id);
    if (subErr) {
      // Compensate the earlier client + relationship updates so all three
      // hierarchy states stay consistent.
      const revertTs = new Date().toISOString();
      await sb
        .from("reseller_client_accounts")
        .update({ status: client.status, updated_at: revertTs })
        .eq("id", client.id);
      await sb
        .from("workspace_relationships")
        .update({
          status: client.status === "suspended" ? "suspended" : "active",
          updated_at: revertTs,
        })
        .eq("child_workspace_id", client.child_workspace_id);
      throw new Error(subErr.message);
    }
    invalidateEntitlementsCache(client.child_workspace_id);
  }
  await writeAccessAudit({
    workspaceId: opts.parentWorkspaceId,
    actingUserId: opts.actingUserId,
    objectType: "reseller_client_account",
    objectId: client.id,
    actionType: opts.suspended ? "suspend" : "reactivate",
    afterState: { status },
    riskLevel: "high",
  });
  return { ok: true, status };
}

export async function requestChildUpgrade(opts: {
  parentWorkspaceId: string;
  actingUserId: string;
  clientId: string;
  requestedPackageKey: string;
}) {
  const client = await requireOwnClient(opts.parentWorkspaceId, opts.clientId);
  if (!packageByKey(opts.requestedPackageKey) ||
      !(ALLOWED_CHILD_PACKAGE_KEYS as readonly string[]).includes(opts.requestedPackageKey)) {
    throw new Error("Invalid package for client accounts");
  }
  const { error } = await sb
    .from("reseller_client_accounts")
    .update({
      upgrade_requested_package_key: opts.requestedPackageKey,
      upgrade_requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", client.id);
  if (error) throw new Error(error.message);
  await writeAccessAudit({
    workspaceId: opts.parentWorkspaceId,
    actingUserId: opts.actingUserId,
    objectType: "reseller_client_account",
    objectId: client.id,
    actionType: "upgrade_requested",
    afterState: { requestedPackageKey: opts.requestedPackageKey },
    riskLevel: "medium",
  });
  return { ok: true };
}

/** Reseller-visible children with status/usage summary. PARENT-scoped only. */
export async function listChildAccounts(parentWorkspaceId: string) {
  const { data: clients, error } = await sb
    .from("reseller_client_accounts")
    .select("*")
    .eq("parent_workspace_id", parentWorkspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = clients ?? [];
  const childIds = rows.map((c: any) => c.child_workspace_id).filter(Boolean);
  const usage: Record<string, { members: number; agents: number; subscriptionStatus: string | null }> = {};
  if (childIds.length > 0) {
    const [{ data: members }, { data: agents }, { data: subs }] = await Promise.all([
      sb.from("workspace_members").select("workspace_id").in("workspace_id", childIds),
      sb.from("agents").select("workspace_id").in("workspace_id", childIds),
      sb.from("workspace_subscriptions").select("workspace_id, subscription_status").in("workspace_id", childIds),
    ]);
    for (const id of childIds) {
      usage[id] = {
        members: (members ?? []).filter((m: any) => m.workspace_id === id).length,
        agents: (agents ?? []).filter((a: any) => a.workspace_id === id).length,
        subscriptionStatus:
          (subs ?? []).find((s: any) => s.workspace_id === id)?.subscription_status ?? null,
      };
    }
  }
  return rows.map((c: any) => ({ ...c, usage: usage[c.child_workspace_id] ?? null }));
}
