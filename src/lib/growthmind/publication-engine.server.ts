/**
 * Publication Execution Engine (master programme continuation §5–§8).
 *
 * Approval-first, revalidate-everything publication flow on top of the
 * authoritative public content model. Every consequential transition is a
 * growthmind_publication_executions row with recorded steps + evidence.
 *
 * Honest states: publishing → api_published (live verification stays
 * "awaiting_lovable_frontend" until the Lovable blog frontend exists and the
 * page actually renders). Publishing via the API NEVER claims Live/Indexed.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  computeReadiness,
  createVersionSnapshot,
  getContentItem,
  getPublicPost,
  getVersion,
  revokeArticlePreviews,
  validateSlug,
} from "./public-content.server";
import { runSeoSafetyGate } from "./seo-blog-campaign.server";

const sb = supabaseAdmin as any;

export const CONTENT_PUBLICATION_ACTION_TYPE = "content_publication_approval";

// ── SSRF guard for live-verification fetches ─────────────────────────────────
// canonical_host comes from the sites table, but verify it is a plain public
// hostname before fetching (never localhost / raw IPs / internal suffixes).
export function isSafeVerificationHost(host: unknown): boolean {
  if (typeof host !== "string") return false;
  const h = host.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) return false;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
  return true;
}

// ── Safety gate adapter ───────────────────────────────────────────────────────

const BLOCK_MAP: Record<string, string> = {
  restricted_claims: "restricted_claims",
  duplicate_title: "duplicate_content",
  cannibalisation: "cannibalisation",
  factuality: "factuality",
  privacy: "privacy",
};

/** Runs the existing SEO Safety Gate against the item's CURRENT content and stores the result. */
export async function runContentSafetyGate(workspaceId: string, itemId: string): Promise<{ ok: boolean; passed?: boolean; error?: string }> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) return { ok: false, error: "Article not found" };
  const gate = await runSeoSafetyGate(workspaceId, item.seo_campaign_id ?? null, {
    title: item.title ?? "",
    body: item.article_body ?? "",
    metaTitle: item.meta_title ?? "",
    metaDescription: item.meta_description ?? "",
    proposedUrl: `/blog/${item.slug}`,
  });
  const blocks = gate.failures.map((f) => BLOCK_MAP[f.check]).filter(Boolean);
  await sb.from("growthmind_public_content_items").update({
    safety_gate_result: { passed: gate.passed, checks: gate.checks, blocks, ranAt: gate.ranAt, forVersion: item.current_version },
    updated_at: new Date().toISOString(),
  }).eq("id", itemId);
  return { ok: true, passed: gate.passed };
}

// ── Approval actions ─────────────────────────────────────────────────────────

async function createPublicationApprovalAction(opts: {
  workspaceId: string; itemId: string; stage: "content" | "publication";
  title: string; description: string;
}): Promise<string | null> {
  const { data, error } = await sb
    .from("hivemind_actions")
    .insert({
      workspace_id: opts.workspaceId,
      action_type: CONTENT_PUBLICATION_ACTION_TYPE,
      title: opts.title,
      description: opts.description,
      status: "pending",
      proposed_by: "growthmind",
      sensitive: true,
      sensitive_category: "campaign",
      action_payload: { itemId: opts.itemId, stage: opts.stage, sensitive: true },
    })
    .select("id")
    .single();
  if (error) { console.warn("[publication] approval insert failed:", error.message); return null; }
  return data.id as string;
}

/** Submit a draft for content approval (runs the safety gate first). */
export async function requestContentApproval(workspaceId: string, itemId: string): Promise<{ ok: boolean; state?: string; error?: string }> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) return { ok: false, error: "Article not found" };
  if (!["draft", "updating", "live_verification_failed"].includes(item.status)) {
    return { ok: false, error: `Article is "${item.status}" — only drafts can be submitted for content approval.` };
  }
  await runContentSafetyGate(workspaceId, itemId);
  const readiness = await computeReadiness(workspaceId, itemId);
  if (readiness.state === "blocked") {
    await sb.from("growthmind_public_content_items").update({ status: "blocked", updated_at: new Date().toISOString() }).eq("id", itemId);
    return { ok: false, error: "Blocked by safety gate: " + readiness.checks.filter((c) => !c.passed).map((c) => c.detail).join(" ") };
  }
  if (readiness.state === "incomplete") {
    return { ok: false, error: "Incomplete: " + readiness.checks.filter((c) => !c.passed).map((c) => c.detail).join(" ") };
  }
  await createPublicationApprovalAction({
    workspaceId, itemId, stage: "content",
    title: `Approve article content: ${item.title}`,
    description: `Review and approve the article content for "/blog/${item.slug}". Safety gate passed. Approving content does NOT publish it — publication needs a separate approval.`,
  });
  await sb.from("growthmind_public_content_items").update({ status: "awaiting_content_approval", updated_at: new Date().toISOString() }).eq("id", itemId);
  return { ok: true, state: "awaiting_content_approval" };
}

/** Explicit action: Approve Article Content. */
export async function approveArticleContent(workspaceId: string, itemId: string, approvalId: string | null, approvedBy: string): Promise<{ ok: boolean; state?: string; error?: string }> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) return { ok: false, error: "Article not found" };
  if (item.status !== "awaiting_content_approval") return { ok: false, error: `Article is "${item.status}" — not awaiting content approval.` };
  const snap = await createVersionSnapshot(itemId, workspaceId, `Content approved by ${approvedBy}`, approvedBy, approvalId, { approved: true });
  if (!snap.ok) return { ok: false, error: snap.error };
  await sb.from("growthmind_public_content_items").update({
    content_approval_id: approvalId ?? itemId,
    status: "awaiting_publication_approval",
    updated_at: new Date().toISOString(),
  }).eq("id", itemId);
  await createPublicationApprovalAction({
    workspaceId, itemId, stage: "publication",
    title: `Approve publication: ${item.title}`,
    description: `Content is approved (version ${snap.versionNumber}). Approve PUBLICATION to allow "Publish now" or scheduling for "/blog/${item.slug}".`,
  });
  return { ok: true, state: "awaiting_publication_approval" };
}

/** Explicit action: Approve Publication. */
export async function approvePublication(workspaceId: string, itemId: string, approvalId: string | null, approvedBy: string): Promise<{ ok: boolean; state?: string; error?: string }> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) return { ok: false, error: "Article not found" };
  if (item.status !== "awaiting_publication_approval") return { ok: false, error: `Article is "${item.status}" — not awaiting publication approval.` };
  await sb.from("growthmind_public_content_items").update({
    publication_approval_id: approvalId ?? itemId,
    updated_at: new Date().toISOString(),
  }).eq("id", itemId);
  return { ok: true, state: "ready_to_publish" };
}

/** Explicit action: Reject Publication / Request Changes → back to draft, approvals cleared. */
export async function rejectPublication(workspaceId: string, itemId: string, reason: string, by: string): Promise<{ ok: boolean; error?: string }> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) return { ok: false, error: "Article not found" };
  await sb.from("growthmind_public_content_items").update({
    status: "draft",
    content_approval_id: null,
    publication_approval_id: null,
    scheduled_for: null,
    updated_at: new Date().toISOString(),
  }).eq("id", itemId);
  await createVersionSnapshot(itemId, workspaceId, `Publication rejected by ${by}: ${reason}`, by, null);
  return { ok: true };
}

// ── Execution engine ─────────────────────────────────────────────────────────

type StepLog = Array<{ step: string; ok: boolean; detail: string; at: string }>;

async function createExecution(opts: {
  workspaceId: string; itemId: string; versionNumber: number;
  kind: "publish" | "scheduled_publish" | "update" | "withdraw" | "restore" | "rollback";
  requestedBy: string; approvalId?: string | null; scheduledFor?: string | null;
}): Promise<{ ok: boolean; executionId?: string; error?: string }> {
  const { data, error } = await sb.from("growthmind_publication_executions").insert({
    workspace_id: opts.workspaceId,
    item_id: opts.itemId,
    version_number: opts.versionNumber,
    kind: opts.kind,
    status: "pending",
    requested_by: opts.requestedBy,
    approval_id: opts.approvalId ?? null,
    scheduled_for: opts.scheduledFor ?? null,
    next_attempt_at: opts.scheduledFor ?? new Date().toISOString(),
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, executionId: data.id };
}

/**
 * Full revalidate-then-publish execution (§6, 18 steps). Never marks Live —
 * ends at api_published + awaiting_lovable_frontend (or live if the page
 * actually renders on the canonical host).
 */
export async function runPublicationExecution(executionId: string): Promise<{ ok: boolean; finalStatus?: string; error?: string }> {
  const now = () => new Date().toISOString();
  const { data: exec } = await sb.from("growthmind_publication_executions").select("*").eq("id", executionId).maybeSingle();
  if (!exec) return { ok: false, error: "Execution not found" };
  if (!["pending", "running"].includes(exec.status)) return { ok: false, error: `Execution is "${exec.status}".` };

  // CAS claim (multi-instance safe)
  const { data: claimed } = await sb.from("growthmind_publication_executions")
    .update({ status: "running", attempts: (exec.attempts ?? 0) + 1, updated_at: now() })
    .eq("id", executionId).eq("status", exec.status).eq("attempts", exec.attempts ?? 0)
    .select("id");
  if (!claimed?.length) return { ok: false, error: "Execution already claimed by another worker." };

  const steps: StepLog = [];
  const log = (step: string, ok: boolean, detail: string) => steps.push({ step, ok, detail, at: now() });

  const fail = async (msg: string): Promise<{ ok: boolean; error: string }> => {
    const attempts = (exec.attempts ?? 0) + 1;
    const dead = attempts >= (exec.max_attempts ?? 3);
    await sb.from("growthmind_publication_executions").update({
      status: dead ? "dead_letter" : "pending",
      next_attempt_at: dead ? null : new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      steps, error_message: msg, updated_at: now(),
    }).eq("id", executionId);
    if (dead) {
      await sb.from("growthmind_public_content_items").update({ status: "failed", updated_at: now() }).eq("id", exec.item_id);
    }
    return { ok: false, error: msg };
  };

  // 1–2. Workspace + WBAH exclusion
  const { data: ws } = await sb.from("workspaces").select("id, name").eq("id", exec.workspace_id).maybeSingle();
  if (!ws) return fail("Workspace no longer exists.");
  if ((ws.name ?? "").toLowerCase().includes("wbah")) return fail("Publishing not available for this workspace.");
  log("revalidate_workspace", true, `Workspace ${ws.id} valid.`);

  // 3. Item + website
  const item = await getContentItem(exec.workspace_id, exec.item_id);
  if (!item) return fail("Article no longer exists.");
  const { data: site } = await sb.from("growthmind_public_sites").select("*").eq("id", item.site_id).eq("workspace_id", exec.workspace_id).maybeSingle();
  if (!site || site.status !== "active") return fail("Website is disconnected or disabled.");
  log("revalidate_website", true, `Site ${site.site_key} active.`);

  // Withdraw / restore / rollback are simpler paths
  if (exec.kind === "withdraw") {
    await sb.from("growthmind_public_content_items").update({
      status: "withdrawn", withdrawn_at: now(), sitemap_state: "not_in_sitemap", updated_at: now(),
    }).eq("id", item.id);
    log("withdraw", true, "Article withdrawn — removed from public API and sitemap data immediately.");
    await sb.from("growthmind_publication_executions").update({ status: "completed", steps, completed_at: now(), updated_at: now(), evidence: { withdrawnAt: now() } }).eq("id", executionId);
    return { ok: true, finalStatus: "withdrawn" };
  }
  if (exec.kind === "restore" || exec.kind === "rollback") {
    const version = await getVersion(exec.workspace_id, item.id, exec.version_number);
    if (!version) return fail(`Version ${exec.version_number} not found.`);
    if (!version.approved && exec.kind === "rollback") return fail(`Version ${exec.version_number} was never approved — rollback must target an approved version.`);
    if (exec.kind === "rollback") {
      await sb.from("growthmind_public_content_items").update({ ...version.snapshot, updated_at: now() }).eq("id", item.id);
      await createVersionSnapshot(item.id, exec.workspace_id, `Rolled back to version ${exec.version_number}`, exec.requested_by ?? "system", exec.approval_id, { executionId, approved: true });
      log("rollback_content", true, `Content restored from approved version ${exec.version_number}.`);
    }
    await sb.from("growthmind_public_content_items").update({
      status: "api_published",
      published_at: item.published_at ?? now(),
      withdrawn_at: null,
      published_version: exec.kind === "rollback" ? exec.version_number : item.published_version,
      sitemap_state: "eligible",
      live_verification_state: "awaiting_lovable_frontend",
      updated_at: now(),
    }).eq("id", item.id);
    await sb.from("growthmind_publication_executions").update({ status: "completed", steps, completed_at: now(), updated_at: now() }).eq("id", executionId);
    return { ok: true, finalStatus: "api_published" };
  }

  // publish / scheduled_publish / update — full revalidation chain
  // 4. Approval validity (revoked after approval?)
  if (!item.content_approval_id || !item.publication_approval_id) return fail("Content or publication approval is missing (possibly revoked).");
  log("revalidate_approvals", true, "Content + publication approvals present.");

  // 5. Version unchanged since approval
  if (item.current_version !== exec.version_number) {
    return fail(`Article changed after approval (approved v${exec.version_number}, now v${item.current_version}). Re-approve before publishing.`);
  }
  const version = await getVersion(exec.workspace_id, item.id, exec.version_number);
  if (!version?.approved) return fail(`Version ${exec.version_number} is not an approved version.`);
  log("revalidate_version", true, `Publishing approved version ${exec.version_number}.`);

  // 6. Safety gate still valid for this version
  const gate = item.safety_gate_result;
  if (!gate?.passed || gate.forVersion == null || gate.forVersion > item.current_version) {
    const rerun = await runContentSafetyGate(exec.workspace_id, item.id);
    if (!rerun.ok || !rerun.passed) return fail("SEO Safety Gate is no longer passing for the approved version.");
  }
  log("revalidate_safety_gate", true, "Safety gate valid.");

  // 7. Readiness (includes slug uniqueness, metadata, entitlements via approvals)
  const readiness = await computeReadiness(exec.workspace_id, item.id);
  if (readiness.state !== "ready_to_publish") {
    return fail(`Readiness check failed (${readiness.state}): ` + readiness.checks.filter((c) => !c.passed).map((c) => c.detail).join(" "));
  }
  const slugCheck = validateSlug(item.slug);
  if (!slugCheck.ok) return fail(slugCheck.reason!);
  log("revalidate_readiness", true, "Ready to publish.");

  // 8. Publish through the public-content service (state change = API visibility)
  await sb.from("growthmind_public_content_items").update({ status: "publishing", updated_at: now() }).eq("id", item.id);
  const canonicalUrl = item.canonical_url ?? `https://${site.canonical_host}/blog/${item.slug}`;
  await sb.from("growthmind_public_content_items").update({
    status: "api_published",
    published_at: item.published_at ?? now(),
    published_version: exec.version_number,
    canonical_url: canonicalUrl,
    scheduled_for: null,
    withdrawn_at: null,
    sitemap_state: "eligible",
    updated_at: now(),
  }).eq("id", item.id);
  await sb.from("growthmind_public_content_versions").update({ is_published_version: true, publication_execution_id: executionId }).eq("item_id", item.id).eq("version_number", exec.version_number);
  await sb.from("growthmind_public_content_versions").update({ is_published_version: false }).eq("item_id", item.id).neq("version_number", exec.version_number);
  log("api_publish", true, "Record published through the public content service.");

  // 9. Confirm the public API returns the item
  const apiCheck = await getPublicPost(site.site_key, item.slug);
  if (!apiCheck.ok) return fail("Public API did not return the article after publishing.");
  log("api_confirm", true, `GET /api/public/v1/sites/${site.site_key}/posts/${item.slug} returns the article.`);

  // 10. Record expected Lovable URL + attempt live verification (canonical host ONLY — no arbitrary fetches)
  const expectedUrl = `https://${site.canonical_host}/blog/${item.slug}`;
  let liveState = "awaiting_lovable_frontend";
  let liveEvidence: Record<string, unknown> = { expectedUrl, note: "Lovable blog frontend not yet implemented — API Published, Awaiting Lovable Frontend." };
  if (!isSafeVerificationHost(site.canonical_host)) {
    liveEvidence = { expectedUrl, note: "canonical_host failed the SSRF safety check — live verification skipped.", checkedAt: now() };
  } else try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(expectedUrl, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "WEBEE-Publication-Verify/1.0" } });
    clearTimeout(t);
    const text = res.ok ? await res.text() : "";
    const rendersTitle = res.ok && item.title && text.toLowerCase().includes(String(item.title).toLowerCase().slice(0, 40));
    liveEvidence = { expectedUrl, httpStatus: res.status, rendersTitle: !!rendersTitle, checkedAt: now() };
    liveState = rendersTitle ? "verified" : "awaiting_lovable_frontend";
  } catch (e: any) {
    liveEvidence = { expectedUrl, fetchError: String(e?.message ?? e).slice(0, 200), checkedAt: now() };
  }
  await sb.from("growthmind_public_content_items").update({
    live_url: liveState === "verified" ? expectedUrl : null,
    live_verification_state: liveState,
    status: liveState === "verified" ? "live" : "api_published",
    gsc_monitoring_state: "monitoring",
    updated_at: now(),
  }).eq("id", item.id);
  log("live_verification", liveState === "verified", liveState === "verified" ? `Live at ${expectedUrl}.` : `Not yet rendered by the Lovable frontend — honest state: API Published, Awaiting Lovable Frontend.`);

  // 11. Revoke outstanding preview links for the published version
  await revokeArticlePreviews(exec.workspace_id, item.id);
  log("revoke_previews", true, "Outstanding preview tokens revoked.");

  // 12. Notify executives (best-effort)
  try {
    const { publishExecutiveEvent } = await import("@/lib/hivemind/executive-events.shared");
    await publishExecutiveEvent(sb, {
      workspaceId: exec.workspace_id,
      eventType: "content_published",
      sourceSystem: "growthmind",
      severity: "info",
      title: `Article ${liveState === "verified" ? "live" : "API-published"}: ${item.title}`,
      summary: liveState === "verified"
        ? `"${item.title}" is live at ${expectedUrl}.`
        : `"${item.title}" is published through the public content API (version ${exec.version_number}). It will appear on the website once the Lovable blog frontend is implemented.`,
      dedupKey: `content_published:${item.id}:${exec.version_number}`,
      entityType: "public_content_item",
      entityId: item.id,
    } as any);
    log("notify_executives", true, "HiveMind/GrowthMind notified.");
  } catch (e: any) {
    log("notify_executives", false, `Notification skipped: ${String(e?.message ?? e).slice(0, 120)}`);
  }

  await sb.from("growthmind_publication_executions").update({
    status: "completed", steps, evidence: { apiConfirmed: true, live: liveEvidence }, completed_at: now(), updated_at: now(),
  }).eq("id", executionId);
  return { ok: true, finalStatus: liveState === "verified" ? "live" : "api_published" };
}

// ── User-facing operations ────────────────────────────────────────────────────

export async function publishNow(workspaceId: string, itemId: string, requestedBy: string): Promise<{ ok: boolean; executionId?: string; finalStatus?: string; error?: string }> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) return { ok: false, error: "Article not found" };
  const readiness = await computeReadiness(workspaceId, itemId);
  if (readiness.state !== "ready_to_publish") {
    return { ok: false, error: `Not ready to publish (${readiness.state}): ` + readiness.checks.filter((c) => !c.passed).map((c) => c.detail).join(" ") };
  }
  const exec = await createExecution({ workspaceId, itemId, versionNumber: item.current_version, kind: "publish", requestedBy, approvalId: item.publication_approval_id });
  if (!exec.ok) return { ok: false, error: exec.error };
  const run = await runPublicationExecution(exec.executionId!);
  return { ok: run.ok, executionId: exec.executionId, finalStatus: run.finalStatus, error: run.error };
}

export async function schedulePublication(workspaceId: string, itemId: string, scheduledForIso: string, timezone: string, requestedBy: string): Promise<{ ok: boolean; executionId?: string; error?: string }> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) return { ok: false, error: "Article not found" };
  const readiness = await computeReadiness(workspaceId, itemId);
  if (readiness.state !== "ready_to_publish") {
    return { ok: false, error: `Not ready to schedule (${readiness.state}).` };
  }
  const when = new Date(scheduledForIso);
  if (isNaN(when.getTime()) || when.getTime() < Date.now() - 60_000) return { ok: false, error: "Scheduled time must be in the future." };
  // No duplicate schedules
  const { data: existing } = await sb.from("growthmind_publication_executions")
    .select("id").eq("item_id", itemId).eq("kind", "scheduled_publish").in("status", ["pending", "running"]).limit(1);
  if (existing?.length) return { ok: false, error: "A scheduled publication already exists — cancel or change it first." };
  const exec = await createExecution({
    workspaceId, itemId, versionNumber: item.current_version, kind: "scheduled_publish",
    requestedBy, approvalId: item.publication_approval_id, scheduledFor: when.toISOString(),
  });
  if (!exec.ok) return { ok: false, error: exec.error };
  await sb.from("growthmind_public_content_items").update({
    status: "scheduled", scheduled_for: when.toISOString(), scheduled_timezone: timezone || "Europe/London", updated_at: new Date().toISOString(),
  }).eq("id", itemId);
  return { ok: true, executionId: exec.executionId };
}

export async function cancelScheduledPublication(workspaceId: string, itemId: string, by: string): Promise<{ ok: boolean; error?: string }> {
  const { data: cancelled } = await sb.from("growthmind_publication_executions")
    .update({ status: "cancelled", error_message: `Cancelled by ${by}`, updated_at: new Date().toISOString() })
    .eq("item_id", itemId).eq("workspace_id", workspaceId).eq("kind", "scheduled_publish").eq("status", "pending")
    .select("id");
  if (!cancelled?.length) return { ok: false, error: "No pending scheduled publication found." };
  // Approvals stay intact; item returns to draft status but stays ready_to_publish per readiness.
  await sb.from("growthmind_public_content_items").update({
    status: "draft",
    scheduled_for: null, updated_at: new Date().toISOString(),
  }).eq("id", itemId);
  return { ok: true };
}

export async function withdrawArticle(workspaceId: string, itemId: string, requestedBy: string): Promise<{ ok: boolean; error?: string }> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) return { ok: false, error: "Article not found" };
  if (!["api_published", "awaiting_website_refresh", "live", "live_verification_failed"].includes(item.status)) {
    return { ok: false, error: `Article is "${item.status}" — only published articles can be withdrawn.` };
  }
  const exec = await createExecution({ workspaceId, itemId, versionNumber: item.published_version ?? item.current_version, kind: "withdraw", requestedBy });
  if (!exec.ok) return { ok: false, error: exec.error };
  const run = await runPublicationExecution(exec.executionId!);
  return { ok: run.ok, error: run.error };
}

export async function restoreArticle(workspaceId: string, itemId: string, requestedBy: string): Promise<{ ok: boolean; error?: string }> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) return { ok: false, error: "Article not found" };
  if (item.status !== "withdrawn") return { ok: false, error: "Only withdrawn articles can be restored." };
  if (!item.published_version) return { ok: false, error: "No previously published version to restore." };
  const exec = await createExecution({ workspaceId, itemId, versionNumber: item.published_version, kind: "restore", requestedBy });
  if (!exec.ok) return { ok: false, error: exec.error };
  const run = await runPublicationExecution(exec.executionId!);
  return { ok: run.ok, error: run.error };
}

export async function rollbackArticle(workspaceId: string, itemId: string, targetVersion: number, requestedBy: string): Promise<{ ok: boolean; error?: string }> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) return { ok: false, error: "Article not found" };
  const version = await getVersion(workspaceId, itemId, targetVersion);
  if (!version) return { ok: false, error: `Version ${targetVersion} not found.` };
  if (!version.approved) return { ok: false, error: `Version ${targetVersion} was never approved — rollback must target an approved version.` };
  const exec = await createExecution({ workspaceId, itemId, versionNumber: targetVersion, kind: "rollback", requestedBy });
  if (!exec.ok) return { ok: false, error: exec.error };
  const run = await runPublicationExecution(exec.executionId!);
  return { ok: run.ok, error: run.error };
}

/** Start an update draft on a published article — clears approvals, requires full re-approval chain (§7). */
export async function startUpdateDraft(workspaceId: string, itemId: string, by: string): Promise<{ ok: boolean; error?: string }> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) return { ok: false, error: "Article not found" };
  if (!["api_published", "live", "awaiting_website_refresh", "live_verification_failed"].includes(item.status)) {
    return { ok: false, error: `Article is "${item.status}" — updates start from a published article.` };
  }
  await createVersionSnapshot(itemId, workspaceId, `Update draft started by ${by} (published v${item.published_version} stays live)`, by, null);
  await sb.from("growthmind_public_content_items").update({
    status: "updating",
    content_approval_id: null,
    publication_approval_id: null,
    updated_at: new Date().toISOString(),
  }).eq("id", itemId);
  return { ok: true };
}

// ── Scheduler tick (called from campaign-executor) ───────────────────────────

export async function runPublicationTick(): Promise<{ ran: number; completed: number; failed: number }> {
  const nowIso = new Date().toISOString();
  const { data: due } = await sb
    .from("growthmind_publication_executions")
    .select("id")
    .eq("kind", "scheduled_publish")
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .limit(10);
  let completed = 0, failed = 0;
  for (const e of due ?? []) {
    try {
      const res = await runPublicationExecution(e.id);
      res.ok ? completed++ : failed++;
    } catch (err: any) {
      failed++;
      console.error("[publication-tick] execution failed:", err?.message ?? err);
    }
  }
  return { ran: (due ?? []).length, completed, failed };
}
