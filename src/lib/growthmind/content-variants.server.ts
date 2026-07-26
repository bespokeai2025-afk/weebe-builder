/**
 * Content Studio cross-channel variants — Task #489.
 *
 * One content project can fan out into MANY per-channel adapted variants
 * (growthmind_content_variants). Rules enforced here:
 *  - Variant copy must be genuinely ADAPTED (never identical to the master) —
 *    checkVariantAdaptation gates the awaiting_channel_approval transition.
 *  - Each variant is approved independently; approving one channel never
 *    authorises another.
 *  - Deployment states are HONEST: only Meta-family channels have an API
 *    publish path (existing growthmind_publishing_jobs pipeline); a variant is
 *    only ever "published" with a verified provider record (external_post_id).
 *    Every other channel goes to awaiting_manual_publication — never a
 *    fabricated "published".
 *  - The table is server-write-only (authenticated grants revoked) so all
 *    writes go through the admin client with explicit workspace scoping.
 */

import {
  CONTENT_VARIANT_CHANNELS,
  VARIANT_CHANNEL_RULES,
  checkVariantAdaptation,
  deploymentPathForChannel,
  isValidVariantTransition,
  type ContentVariantChannel,
  type VariantDeploymentState,
} from "@/lib/minds/social-packets.shared";

type Sb = any;

async function admin(): Promise<Sb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export interface VariantDraftInput {
  channel: ContentVariantChannel;
  headline?: string | null;
  bodyCopy?: string | null;
  caption?: string | null;
  cta?: string | null;
  hook?: string | null;
  script?: string | null;
  mediaUrl?: string | null;
  formatNotes?: string | null;
}

export interface CreatedVariant {
  id: string;
  channel: ContentVariantChannel;
  deploymentState: VariantDeploymentState;
  deploymentPath: "api" | "manual";
  adaptationOk: boolean;
  problems: string[];
}

function variantCopyText(d: VariantDraftInput): string {
  return [d.headline, d.hook, d.bodyCopy, d.caption, d.script, d.cta]
    .filter(Boolean).join("\n").trim();
}

export function isContentVariantChannel(c: string): c is ContentVariantChannel {
  return (CONTENT_VARIANT_CHANNELS as readonly string[]).includes(c);
}

/**
 * Create (or refresh) per-channel variants for a project. Adaptation is
 * enforced: a variant whose copy fails the adaptation gate stays in `draft`
 * with the problems recorded as blockers; only adapted copy reaches
 * `awaiting_channel_approval`.
 */
export async function createContentVariants(
  workspaceId: string,
  projectId: string,
  drafts: VariantDraftInput[],
  opts: { workOrderId?: string | null } = {},
): Promise<{ project: any; variants: CreatedVariant[] }> {
  const sb = await admin();
  const { data: project, error: pe } = await sb
    .from("growthmind_content_projects")
    .select("id, workspace_id, title, caption, script, cta, media_url, status, target_platform, format")
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (pe) throw new Error(pe.message);
  if (!project) throw new Error("Content project not found in this workspace.");

  const masterCopy = [project.title, project.caption, project.script, project.cta]
    .filter(Boolean).join("\n").trim();

  const out: CreatedVariant[] = [];
  for (const d of drafts) {
    if (!isContentVariantChannel(d.channel)) {
      throw new Error(`Unknown variant channel "${d.channel}".`);
    }
    const copy = variantCopyText(d);
    const adaptation = checkVariantAdaptation({
      channel: d.channel,
      masterCopy,
      variantCopy: copy,
    });
    const path = deploymentPathForChannel(d.channel);
    const state: VariantDeploymentState = adaptation.ok ? "awaiting_channel_approval" : "draft";
    const row = {
      workspace_id: workspaceId,
      project_id: projectId,
      work_order_id: opts.workOrderId ?? null,
      channel: d.channel,
      headline: d.headline ?? null,
      body_copy: d.bodyCopy ?? null,
      caption: d.caption ?? null,
      cta: d.cta ?? null,
      hook: d.hook ?? null,
      script: d.script ?? null,
      media_url: d.mediaUrl ?? project.media_url ?? null,
      format_notes: d.formatNotes ?? VARIANT_CHANNEL_RULES[d.channel].format,
      deployment_state: state,
      deployment_path: path,
      blockers: adaptation.ok
        ? []
        : adaptation.problems.map((p) => ({ kind: "adaptation_required", detail: p })),
      updated_at: new Date().toISOString(),
    };
    const { data: upserted, error: ue } = await sb
      .from("growthmind_content_variants")
      .upsert(row, { onConflict: "project_id,channel" })
      .select("id, channel, deployment_state, deployment_path")
      .single();
    if (ue) throw new Error(ue.message);
    out.push({
      id: upserted.id,
      channel: d.channel,
      deploymentState: upserted.deployment_state,
      deploymentPath: upserted.deployment_path,
      adaptationOk: adaptation.ok,
      problems: adaptation.problems,
    });
  }
  return { project, variants: out };
}

/** Link variant rows to their proposing work order (called right after the work order is inserted). */
export async function linkVariantsToWorkOrder(
  workspaceId: string,
  variantIds: string[],
  workOrderId: string,
): Promise<void> {
  if (!variantIds.length) return;
  const sb = await admin();
  const { error } = await sb.from("growthmind_content_variants")
    .update({ work_order_id: workOrderId, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .in("id", variantIds);
  if (error) throw new Error(error.message);
}

/** Approve a single channel variant — never affects any other variant. */
export async function approveContentVariant(
  workspaceId: string,
  variantId: string,
  userId: string | null,
): Promise<any> {
  const sb = await admin();
  const { data: v, error } = await sb.from("growthmind_content_variants")
    .select("*").eq("id", variantId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!v) throw new Error("Variant not found in this workspace.");
  if (v.deployment_state !== "awaiting_channel_approval") {
    throw new Error(`Variant is in state "${v.deployment_state}" — only awaiting_channel_approval variants can be approved.`);
  }
  const next = deploymentPathForChannel(v.channel as ContentVariantChannel) === "api"
    ? "approved"
    : "approved";
  const { data: updated, error: ue } = await sb.from("growthmind_content_variants")
    .update({
      deployment_state: next,
      approval_state: "approved",
      approved_at: new Date().toISOString(),
      approved_by: userId,
      approved_copy_snapshot: {
        headline: v.headline, body_copy: v.body_copy, caption: v.caption,
        cta: v.cta, hook: v.hook, script: v.script, media_url: v.media_url,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", variantId)
    .eq("workspace_id", workspaceId)
    .eq("deployment_state", "awaiting_channel_approval") // CAS — no double approvals
    .select("*").maybeSingle();
  if (ue) throw new Error(ue.message);
  if (!updated) throw new Error("Variant approval raced with another update — reload and retry.");
  return updated;
}

/**
 * Honest deployment transition. Hard rules:
 *  - Only transitions allowed by the shared state machine.
 *  - "published" requires a verified provider record (external_post_id) for
 *    API-path variants — never claimed without one.
 *  - Manual-path variants move approved → awaiting_manual_publication, and to
 *    published only when a live URL / manual confirmation is recorded.
 */
export async function transitionVariantDeployment(
  workspaceId: string,
  variantId: string,
  to: VariantDeploymentState,
  extras: {
    externalPostId?: string | null;
    liveUrl?: string | null;
    providerRecord?: Record<string, unknown> | null;
    publishingJobId?: string | null;
    verificationNote?: string | null;
  } = {},
): Promise<any> {
  const sb = await admin();
  const { data: v, error } = await sb.from("growthmind_content_variants")
    .select("*").eq("id", variantId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!v) throw new Error("Variant not found in this workspace.");
  const from = v.deployment_state as VariantDeploymentState;
  if (!isValidVariantTransition(from, to)) {
    throw new Error(`Invalid deployment transition ${from} → ${to}.`);
  }
  if (to === "published") {
    if (v.deployment_path === "api" && !extras.externalPostId) {
      throw new Error("Refusing to mark published: no verified provider record (external_post_id). Nothing is claimed live without one.");
    }
    if (v.deployment_path === "manual" && !extras.liveUrl) {
      throw new Error("Refusing to mark published: manual-path variants need the live URL confirming manual publication.");
    }
  }
  const { data: updated, error: ue } = await sb.from("growthmind_content_variants")
    .update({
      deployment_state: to,
      external_post_id: extras.externalPostId ?? v.external_post_id,
      live_url: extras.liveUrl ?? v.live_url,
      provider_record: extras.providerRecord ?? v.provider_record,
      publishing_job_id: extras.publishingJobId ?? v.publishing_job_id,
      verification_note: extras.verificationNote ?? v.verification_note,
      updated_at: new Date().toISOString(),
    })
    .eq("id", variantId)
    .eq("workspace_id", workspaceId)
    .eq("deployment_state", from) // CAS
    .select("*").maybeSingle();
  if (ue) throw new Error(ue.message);
  if (!updated) throw new Error("Deployment transition raced with another update — reload and retry.");
  return updated;
}

/** List variants for a project (server-side read via admin, workspace-scoped). */
export async function listContentVariants(
  workspaceId: string,
  projectId: string,
): Promise<any[]> {
  const sb = await admin();
  const { data, error } = await sb.from("growthmind_content_variants")
    .select("*").eq("workspace_id", workspaceId).eq("project_id", projectId)
    .order("channel", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}
