/**
 * Public Content Publishing mind-tools (continuation programme §13).
 *
 * GrowthMind operates the publishing backbone through the shared registry —
 * executeMindTool enforces membership, entitlements, mode gates and (for
 * sensitive tools) explicit human approval. Publication itself is ALSO
 * approval-gated inside the engine (hivemind_actions content_publication_approval),
 * so nothing goes public from a chat alone.
 *
 * Honest status rule: articles are "API Published — Awaiting Lovable Frontend"
 * until live verification on the canonical host succeeds. Never claim Live.
 */
import { z } from "zod";
import { registerMindTool, type MindToolContext, type MindToolRunResult } from "./tool-registry.server";

// ── Read tools ───────────────────────────────────────────────────────────────

registerMindTool({
  name: "growthmind.content.list_public_articles",
  mind: "growthmind",
  title: "List public content articles",
  description: "List articles in the public content publishing pipeline with their honest lifecycle state (draft → approvals → api_published/awaiting_website_refresh → live only after verification), slug, scheduled time and current version.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  inputSchema: z.object({ status: z.string().max(60).optional(), limit: z.number().int().min(1).max(200).default(50) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = (supabaseAdmin as any)
      .from("growthmind_public_content_items")
      .select("id, site_id, slug, title, status, content_type, category, tags, scheduled_for, published_at, live_verification_state, current_version, updated_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(input?.limit ?? 50);
    if (input?.status) q = q.eq("status", input.status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { result: { articles: data ?? [] } };
  },
});

registerMindTool({
  name: "growthmind.content.get_article_readiness",
  mind: "growthmind",
  title: "Check article publication readiness",
  description: "Run the publication readiness validator for one article: slug validity/uniqueness, required fields, approval states, safety-gate outcome. Returns pass/fail per check — the same validator the publication engine enforces.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  inputSchema: z.object({ itemId: z.string().min(8).max(80) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { computeReadiness } = await import("@/lib/growthmind/public-content.server");
    const r = await computeReadiness(ctx.workspaceId, input.itemId);
    return { result: r as any };
  },
});

registerMindTool({
  name: "growthmind.content.list_article_versions",
  mind: "growthmind",
  title: "List article version history",
  description: "List immutable version snapshots for an article (version number, title, created time, publication note) — the basis for rollback.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  inputSchema: z.object({ itemId: z.string().min(8).max(80) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { listVersions } = await import("@/lib/growthmind/public-content.server");
    const versions = await listVersions(ctx.workspaceId, input.itemId);
    return { result: { versions: versions.map((v: any) => ({ version: v.version_number, title: v.title, createdAt: v.created_at, note: v.note ?? null })) } };
  },
});

// ── Write tools ──────────────────────────────────────────────────────────────

registerMindTool({
  name: "growthmind.content.create_preview_link",
  mind: "growthmind",
  title: "Create article preview link",
  description: "Issue a short-lived (1 hour), single-article preview token so a human can review the draft exactly as the public API will serve it. Tokens are hashed at rest and revocable; previews are noindex and never expose other drafts.",
  access: "write",
  surface: "registry",
  sensitive: false,
  idempotent: false,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  inputSchema: z.object({ itemId: z.string().min(8).max(80) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { createArticlePreview } = await import("@/lib/growthmind/public-content.server");
    const r = await createArticlePreview({ workspaceId: ctx.workspaceId, itemId: input.itemId, createdBy: ctx.userId ?? "mind" });
    if (!(r as any).ok) throw new Error((r as any).error ?? "Preview creation failed");
    return { result: r as any, affectedRecordType: "growthmind_content_preview_tokens", affectedRecordId: input.itemId };
  },
});

registerMindTool({
  name: "growthmind.content.request_content_approval",
  mind: "growthmind",
  title: "Request article content approval",
  description: "Run the safety gate on a draft article and, if it passes, raise a content-approval request for a human. Nothing is published by this step.",
  access: "write",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api", "system"],
  inputSchema: z.object({ itemId: z.string().min(8).max(80) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { requestContentApproval } = await import("@/lib/growthmind/publication-engine.server");
    const r = await requestContentApproval(ctx.workspaceId, input.itemId);
    if (!r.ok) throw new Error(r.error ?? "Content approval request failed");
    return { result: r as any, affectedRecordType: "growthmind_public_content_items", affectedRecordId: input.itemId };
  },
});

registerMindTool({
  name: "growthmind.content.publish_article_now",
  mind: "growthmind",
  title: "Publish article to public API now",
  description: "Publish a fully approved article to the public content API immediately. Requires prior content AND publication approval in the engine; result state is honest — 'api_published / awaiting Lovable frontend' until live verification succeeds on the canonical host. Consequential — requires explicit approval.",
  access: "write",
  surface: "registry",
  sensitive: true,
  idempotent: false,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api", "system"],
  inputSchema: z.object({ itemId: z.string().min(8).max(80) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { publishNow } = await import("@/lib/growthmind/publication-engine.server");
    const r = await publishNow(ctx.workspaceId, input.itemId, ctx.userId ?? "mind");
    if (!r.ok) throw new Error(r.error ?? "Publish failed");
    return { result: r as any, affectedRecordType: "growthmind_public_content_items", affectedRecordId: input.itemId };
  },
});

registerMindTool({
  name: "growthmind.content.schedule_publication",
  mind: "growthmind",
  title: "Schedule article publication",
  description: "Schedule an approved article for future publication (worker publishes at the stored time; duplicate execution prevented by atomic claims). Consequential — requires explicit approval.",
  access: "write",
  surface: "registry",
  sensitive: true,
  idempotent: false,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api", "system"],
  inputSchema: z.object({
    itemId: z.string().min(8).max(80),
    scheduledFor: z.string().datetime(),
    timezone: z.string().max(60).default("Europe/London"),
  }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { schedulePublication } = await import("@/lib/growthmind/publication-engine.server");
    const r = await schedulePublication(ctx.workspaceId, input.itemId, input.scheduledFor, input.timezone ?? "Europe/London", ctx.userId ?? "mind");
    if (!r.ok) throw new Error(r.error ?? "Scheduling failed");
    return { result: r as any, affectedRecordType: "growthmind_publication_executions", affectedRecordId: input.itemId };
  },
});

registerMindTool({
  name: "growthmind.content.cancel_scheduled_publication",
  mind: "growthmind",
  title: "Cancel scheduled publication",
  description: "Cancel a pending scheduled publication before the worker runs it. The article returns to its approved, unpublished state.",
  access: "write",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  inputSchema: z.object({ itemId: z.string().min(8).max(80) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { cancelScheduledPublication } = await import("@/lib/growthmind/publication-engine.server");
    const r = await cancelScheduledPublication(ctx.workspaceId, input.itemId, ctx.userId ?? "mind");
    if (!r.ok) throw new Error(r.error ?? "Cancel failed");
    return { result: r as any, affectedRecordType: "growthmind_public_content_items", affectedRecordId: input.itemId };
  },
});

registerMindTool({
  name: "growthmind.content.withdraw_article",
  mind: "growthmind",
  title: "Withdraw published article",
  description: "Withdraw a published article from the public API (it disappears from listings, single-article reads and sitemap-data immediately). Reversible via restore. Consequential — requires explicit approval.",
  access: "write",
  surface: "registry",
  sensitive: true,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  inputSchema: z.object({ itemId: z.string().min(8).max(80) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { withdrawArticle } = await import("@/lib/growthmind/publication-engine.server");
    const r = await withdrawArticle(ctx.workspaceId, input.itemId, ctx.userId ?? "mind");
    if (!r.ok) throw new Error(r.error ?? "Withdraw failed");
    return { result: r as any, affectedRecordType: "growthmind_public_content_items", affectedRecordId: input.itemId };
  },
});

registerMindTool({
  name: "growthmind.content.rollback_article",
  mind: "growthmind",
  title: "Roll article back to a previous version",
  description: "Restore a previously published, safety-checked version of an article as the live content. Only snapshot versions can be targeted. Consequential — requires explicit approval.",
  access: "write",
  surface: "registry",
  sensitive: true,
  idempotent: false,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  inputSchema: z.object({ itemId: z.string().min(8).max(80), targetVersion: z.number().int().min(1) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { rollbackArticle } = await import("@/lib/growthmind/publication-engine.server");
    const r = await rollbackArticle(ctx.workspaceId, input.itemId, input.targetVersion, ctx.userId ?? "mind");
    if (!r.ok) throw new Error(r.error ?? "Rollback failed");
    return { result: r as any, affectedRecordType: "growthmind_public_content_items", affectedRecordId: input.itemId };
  },
});

// ── AccountsMind cost visibility (§15 — evidence-only, no invented attribution) ──

registerMindTool({
  name: "accountsmind.public_content_costs",
  mind: "accountsmind",
  title: "Public content publishing costs",
  description: "Evidence-based cost summary for the publishing backbone: article generation / research / image / safety-check costs from recorded generation logs, publication execution counts, cost per published article. Attribution is reported as Attributed / Partially Attributed / Unknown — never invented.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    const { getPublicContentCostSummary } = await import("@/lib/accountsmind/public-content-costs.server");
    const r = await getPublicContentCostSummary(ctx.workspaceId);
    return { result: r as any };
  },
});
