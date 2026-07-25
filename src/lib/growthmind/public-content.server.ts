/**
 * Public Content Publishing — authoritative content model (master programme
 * continuation §2–§5, §9).
 *
 * Owns: site registry lookups, content items, immutable versions, reserved
 * slugs, the single publication-readiness validator, preview tokens, and the
 * published-only public read mappers used by /api/public/v1/sites/*.
 *
 * Rules honoured:
 *  - Published-only enforcement lives HERE (database-level status filter),
 *    not in route handlers.
 *  - Public mappers whitelist fields — internal columns never leak.
 *  - Preview tokens: random 256-bit secrets stored as SHA-256 hashes,
 *    article-scoped, short-lived, revocable. The raw token is never stored.
 *  - "API published" never implies Live or Indexed — separate states.
 */
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const sb = supabaseAdmin as any;

export const PREVIEW_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour

/** Slugs the public site reserves for non-article routes. */
export const RESERVED_SLUGS = new Set([
  "blog", "index", "home", "sitemap", "sitemap.xml", "robots.txt", "rss",
  "feed", "atom", "admin", "api", "login", "signup", "preview", "categories",
  "tags", "search", "contact", "about", "privacy", "terms", "null", "undefined",
]);

export function validateSlug(slug: string): { ok: boolean; reason?: string } {
  if (!slug || typeof slug !== "string") return { ok: false, reason: "Slug is required." };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return { ok: false, reason: "Slug must be lowercase letters, numbers and single hyphens." };
  }
  if (slug.length > 120) return { ok: false, reason: "Slug is too long (max 120 chars)." };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: `"${slug}" is a reserved slug.` };
  return { ok: true };
}

// ── Sites ─────────────────────────────────────────────────────────────────────

export async function getSiteByKey(siteKey: string): Promise<any | null> {
  const { data } = await sb
    .from("growthmind_public_sites")
    .select("*")
    .eq("site_key", siteKey)
    .eq("status", "active")
    .maybeSingle();
  return data ?? null;
}

export async function getSiteForWorkspace(workspaceId: string): Promise<any | null> {
  const { data } = await sb
    .from("growthmind_public_sites")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1);
  return data?.[0] ?? null;
}

// ── Item access (always workspace-scoped) ─────────────────────────────────────

export async function getContentItem(workspaceId: string, itemId: string): Promise<any | null> {
  const { data } = await sb
    .from("growthmind_public_content_items")
    .select("*")
    .eq("id", itemId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data ?? null;
}

async function touch(itemId: string, patch: Record<string, unknown>): Promise<{ error: any }> {
  const { error } = await sb
    .from("growthmind_public_content_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  return { error };
}

// ── Creation (draft) ─────────────────────────────────────────────────────────

export async function createContentItem(input: {
  workspaceId: string;
  siteId?: string | null;
  fields: Record<string, unknown>;
  createdBy?: string | null;
}): Promise<{ ok: boolean; itemId?: string; error?: string }> {
  // WBAH exclusion
  const { data: ws } = await sb.from("workspaces").select("name").eq("id", input.workspaceId).maybeSingle();
  if ((ws?.name ?? "").toLowerCase().includes("wbah")) {
    return { ok: false, error: "Public content publishing is not available for this workspace." };
  }
  const site = input.siteId
    ? (await sb.from("growthmind_public_sites").select("*").eq("id", input.siteId).eq("workspace_id", input.workspaceId).maybeSingle()).data
    : await getSiteForWorkspace(input.workspaceId);
  if (!site) return { ok: false, error: "No public website is connected for this workspace." };

  const slug = String(input.fields.slug ?? "");
  const slugCheck = validateSlug(slug);
  if (!slugCheck.ok) return { ok: false, error: slugCheck.reason };

  const { data, error } = await sb
    .from("growthmind_public_content_items")
    .insert({
      workspace_id: input.workspaceId,
      site_id: site.id,
      status: "draft",
      created_by: input.createdBy ?? null,
      ...input.fields,
      slug,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: `Slug "${slug}" is already used on this site.` };
    return { ok: false, error: error.message };
  }
  await createVersionSnapshot(data.id, input.workspaceId, "Initial draft", input.createdBy ?? "system", null);
  return { ok: true, itemId: data.id };
}

// ── Immutable versions ────────────────────────────────────────────────────────

const VERSIONED_FIELDS = [
  "title", "slug", "excerpt", "body_format", "article_body", "rendered_body",
  "meta_title", "meta_description", "canonical_url", "og_title", "og_description",
  "og_image_url", "featured_image_url", "featured_image_alt", "author_name",
  "reviewer_name", "category", "tags", "target_product", "target_service",
  "target_audience", "target_country", "target_language", "primary_topic",
  "query_cluster", "internal_links", "external_sources", "structured_data",
  "cta", "noindex", "content_type",
] as const;

function versionSnapshotOf(item: any): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  for (const f of VERSIONED_FIELDS) snap[f] = item[f] ?? null;
  return snap;
}

export async function createVersionSnapshot(
  itemId: string,
  workspaceId: string,
  changeSummary: string,
  changedBy: string,
  approvalId: string | null,
  opts?: { executionId?: string | null; approved?: boolean },
): Promise<{ ok: boolean; versionNumber?: number; error?: string }> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) return { ok: false, error: "Item not found" };
  const next = (item.current_version ?? 0) + 1;
  const { error } = await sb.from("growthmind_public_content_versions").insert({
    item_id: itemId,
    workspace_id: workspaceId,
    version_number: next,
    snapshot: versionSnapshotOf(item),
    change_summary: changeSummary,
    changed_by: changedBy,
    approval_id: approvalId,
    publication_execution_id: opts?.executionId ?? null,
    approved: opts?.approved ?? false,
  });
  if (error) return { ok: false, error: error.message };
  await touch(itemId, { current_version: next, previous_version: item.current_version || null });
  return { ok: true, versionNumber: next };
}

export async function getVersion(workspaceId: string, itemId: string, versionNumber: number): Promise<any | null> {
  const { data } = await sb
    .from("growthmind_public_content_versions")
    .select("*")
    .eq("item_id", itemId)
    .eq("workspace_id", workspaceId)
    .eq("version_number", versionNumber)
    .maybeSingle();
  return data ?? null;
}

export async function listVersions(workspaceId: string, itemId: string): Promise<any[]> {
  const { data } = await sb
    .from("growthmind_public_content_versions")
    .select("id, version_number, change_summary, changed_by, approval_id, approved, is_published_version, created_at")
    .eq("item_id", itemId)
    .eq("workspace_id", workspaceId)
    .order("version_number", { ascending: false })
    .limit(50);
  return data ?? [];
}

// ── Publication readiness validator (single authoritative) ───────────────────

export type ReadinessCheck = { check: string; passed: boolean; detail: string };
export type ReadinessState = "incomplete" | "ready_for_content_approval" | "ready_for_publication_approval" | "ready_to_publish" | "blocked";

export async function computeReadiness(workspaceId: string, itemId: string): Promise<{
  state: ReadinessState;
  checks: ReadinessCheck[];
  error?: string;
}> {
  const item = await getContentItem(workspaceId, itemId);
  if (!item) return { state: "blocked", checks: [], error: "Item not found" };

  const checks: ReadinessCheck[] = [];
  const add = (check: string, passed: boolean, detail: string) => checks.push({ check, passed, detail });

  // Content completeness
  add("title", !!item.title?.trim(), item.title?.trim() ? "Title present." : "Title is missing.");
  add("article_body", !!item.article_body?.trim() && item.article_body.trim().length >= 300,
    item.article_body?.trim()?.length >= 300 ? "Article body present." : "Article body missing or under 300 characters.");
  add("meta_title", !!item.meta_title?.trim(), item.meta_title?.trim() ? "Meta title present." : "Meta title is missing.");
  add("meta_description", !!item.meta_description?.trim(), item.meta_description?.trim() ? "Meta description present." : "Meta description is missing.");
  add("cta", !!item.cta && Object.keys(item.cta ?? {}).length > 0, item.cta ? "CTA present." : "CTA is missing.");
  add("author_or_reviewer", !!(item.author_name?.trim() || item.reviewer_name?.trim()),
    item.author_name || item.reviewer_name ? "Author/reviewer present." : "No author or reviewer set.");

  const slugCheck = validateSlug(item.slug ?? "");
  add("slug", slugCheck.ok, slugCheck.ok ? `Slug "${item.slug}" valid.` : slugCheck.reason!);
  if (slugCheck.ok) {
    const { data: dup } = await sb
      .from("growthmind_public_content_items")
      .select("id")
      .eq("site_id", item.site_id)
      .eq("slug", item.slug)
      .neq("id", item.id)
      .limit(1);
    add("slug_unique", !(dup?.length), dup?.length ? "Slug already used by another article on this site." : "Slug unique on site.");
  }

  add("website_selected", !!item.site_id, item.site_id ? "Website selected." : "No website selected.");

  // Canonical
  const canonicalOk = !item.canonical_url || /^https:\/\/[a-z0-9.-]+\/[a-z0-9\-\/]*$/i.test(item.canonical_url);
  add("canonical", canonicalOk, canonicalOk ? "Canonical valid (or defaulted)." : "Canonical URL is malformed.");

  // Images: alt text where images exist
  const imgOk = !item.featured_image_url || !!item.featured_image_alt?.trim();
  add("image_alt", imgOk, imgOk ? "Image alt text OK." : "Featured image has no alt text.");

  // Internal links must be site-relative paths
  const links: any[] = Array.isArray(item.internal_links) ? item.internal_links : [];
  const badLink = links.find((l) => typeof (l?.url ?? l) !== "string" || !String(l?.url ?? l).startsWith("/"));
  add("internal_links", !badLink, badLink ? "An internal link is not a site-relative path." : "Internal links validated.");

  // Structured data must be an object when provided
  const sdOk = item.structured_data == null || (typeof item.structured_data === "object" && !Array.isArray(item.structured_data));
  add("structured_data", sdOk, sdOk ? "Structured data valid (or absent)." : "Structured data must be a JSON object.");

  // Accidental noindex
  add("noindex_intent", !item.noindex || !!(item.cta as any)?.noindex_intended || item.status === "withdrawn",
    item.noindex ? "noindex is set — confirm this is intentional (set cta.noindex_intended)." : "No accidental noindex.");

  // Safety gate
  const gate = item.safety_gate_result;
  const gatePassed = !!gate && gate.passed === true;
  add("safety_gate", gatePassed, gatePassed ? "SEO Safety Gate passed." : "SEO Safety Gate has not passed for the current version.");
  const gateBlocks: string[] = Array.isArray(gate?.blocks) ? gate.blocks : [];
  add("no_restricted_claims", !gateBlocks.includes("restricted_claims"), gateBlocks.includes("restricted_claims") ? "Unresolved restricted-claim block." : "No restricted-claim block.");
  add("no_duplicate_block", !gateBlocks.includes("duplicate_content"), gateBlocks.includes("duplicate_content") ? "Unresolved duplicate-content block." : "No duplicate-content block.");
  add("no_cannibalisation_block", !gateBlocks.includes("cannibalisation"), gateBlocks.includes("cannibalisation") ? "Unresolved keyword-cannibalisation block." : "No cannibalisation block.");
  add("no_factuality_block", !gateBlocks.includes("factuality"), gateBlocks.includes("factuality") ? "Unresolved factuality block." : "No factuality block.");
  add("no_privacy_block", !gateBlocks.includes("privacy"), gateBlocks.includes("privacy") ? "Unresolved privacy issue." : "No privacy block.");

  // Approvals
  add("content_approval", !!item.content_approval_id, item.content_approval_id ? "Content approved." : "Content approval not complete.");
  add("publication_approval", !!item.publication_approval_id, item.publication_approval_id ? "Publication approved." : "Publication approval not complete.");

  const failed = checks.filter((c) => !c.passed).map((c) => c.check);
  const contentReady = !failed.some((f) => !["content_approval", "publication_approval"].includes(f));
  const hardBlock = ["no_restricted_claims", "no_duplicate_block", "no_cannibalisation_block", "no_factuality_block", "no_privacy_block"]
    .some((f) => failed.includes(f));

  let state: ReadinessState;
  if (hardBlock || item.status === "blocked") state = "blocked";
  else if (!contentReady) state = "incomplete";
  else if (!item.content_approval_id) state = "ready_for_content_approval";
  else if (!item.publication_approval_id) state = "ready_for_publication_approval";
  else state = "ready_to_publish";

  return { state, checks };
}

// ── Preview tokens ────────────────────────────────────────────────────────────

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createArticlePreview(input: {
  workspaceId: string;
  itemId: string;
  createdBy: string;
}): Promise<{ ok: boolean; previewPath?: string; expiresAt?: string; error?: string }> {
  const item = await getContentItem(input.workspaceId, input.itemId);
  if (!item) return { ok: false, error: "Article not found" };
  const { data: site } = await sb.from("growthmind_public_sites").select("site_key").eq("id", item.site_id).maybeSingle();
  if (!site) return { ok: false, error: "Website not found" };
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PREVIEW_TOKEN_TTL_MS).toISOString();
  const { error } = await sb.from("growthmind_content_preview_tokens").insert({
    workspace_id: input.workspaceId,
    site_id: item.site_id,
    item_id: item.id,
    token_hash: hashToken(raw),
    expires_at: expiresAt,
    created_by: input.createdBy,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    previewPath: `/api/public/v1/sites/${site.site_key}/preview/${item.id}?token=${raw}`,
    expiresAt,
  };
}

export async function revokeArticlePreviews(workspaceId: string, itemId: string): Promise<{ ok: boolean; revoked: number }> {
  const { data } = await sb
    .from("growthmind_content_preview_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("item_id", itemId)
    .is("revoked_at", null)
    .select("id");
  return { ok: true, revoked: data?.length ?? 0 };
}

/** Public preview resolution — token must match THIS article, be unexpired and unrevoked. */
export async function resolvePreview(siteKey: string, itemId: string, rawToken: string): Promise<any | null> {
  if (!rawToken || rawToken.length < 20) return null;
  const site = await getSiteByKey(siteKey);
  if (!site) return null;
  const { data: tok } = await sb
    .from("growthmind_content_preview_tokens")
    .select("*")
    .eq("token_hash", hashToken(rawToken))
    .eq("item_id", itemId)
    .eq("site_id", site.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!tok) return null;
  if (new Date(tok.expires_at).getTime() < Date.now()) return null;
  const { data: item } = await sb
    .from("growthmind_public_content_items")
    .select("*")
    .eq("id", itemId)
    .eq("site_id", site.id)
    .eq("workspace_id", tok.workspace_id)
    .maybeSingle();
  return item ?? null;
}

// ── Public read layer (published-only, whitelisted fields) ───────────────────

export const PUBLIC_STATUSES = ["api_published", "awaiting_website_refresh", "live", "live_verification_failed"] as const;

/**
 * Statuses queried for public serving. "updating" is included ONLY so the
 * previously PUBLISHED version keeps serving while a new draft is edited —
 * in-progress edits are never exposed (the published snapshot is overlaid).
 */
const PUBLIC_QUERY_STATUSES = [...PUBLIC_STATUSES, "updating"] as string[];

/**
 * For items in "updating" status, replace live-edited fields with the stored
 * snapshot of the published version. Items updating without a published
 * version are dropped (nothing public exists for them).
 */
async function overlayPublishedSnapshots(items: any[]): Promise<any[]> {
  const updating = items.filter((i) => i.status === "updating");
  if (updating.length === 0) return items;
  const withPub = updating.filter((i) => i.published_version != null);
  const byItem = new Map<string, any>();
  if (withPub.length > 0) {
    const { data: vers } = await sb
      .from("growthmind_public_content_versions")
      .select("item_id, version_number, snapshot")
      .in("item_id", withPub.map((i) => i.id));
    for (const v of vers ?? []) {
      const it = withPub.find((i) => i.id === v.item_id && i.published_version === v.version_number);
      if (it && v.snapshot) byItem.set(it.id, v.snapshot);
    }
  }
  return items
    .filter((i) => i.status !== "updating" || byItem.has(i.id))
    .map((i) => (byItem.has(i.id) ? { ...i, ...byItem.get(i.id) } : i));
}

export function toPublicPost(item: any, site: any, opts?: { full?: boolean; preview?: boolean }): Record<string, unknown> {
  const base: Record<string, unknown> = {
    slug: item.slug,
    title: item.title,
    excerpt: item.excerpt ?? null,
    category: item.category ?? null,
    tags: item.tags ?? [],
    author_name: item.author_name ?? null,
    featured_image_url: item.featured_image_url ?? null,
    featured_image_alt: item.featured_image_alt ?? null,
    published_at: item.published_at ?? null,
    updated_at: item.updated_at ?? null,
  };
  if (opts?.full) {
    Object.assign(base, {
      body_format: item.body_format,
      article_body: item.article_body,
      meta_title: item.meta_title ?? item.title,
      meta_description: item.meta_description ?? null,
      canonical_url: item.canonical_url ?? `https://${site.canonical_host}/blog/${item.slug}`,
      og_title: item.og_title ?? item.meta_title ?? item.title,
      og_description: item.og_description ?? item.meta_description ?? null,
      og_image_url: item.og_image_url ?? item.featured_image_url ?? null,
      structured_data: item.structured_data ?? null,
      internal_links: item.internal_links ?? [],
      cta: item.cta ?? null,
      noindex: opts?.preview ? true : !!item.noindex,
    });
  }
  if (opts?.preview) Object.assign(base, { preview: true, status: "draft_preview" });
  return base;
}

export async function listPublicPosts(siteKey: string, q: {
  page?: number; pageSize?: number; category?: string | null; tag?: string | null; order?: "published" | "updated";
}): Promise<{ ok: boolean; status: number; body: any; version?: string }> {
  const site = await getSiteByKey(siteKey);
  if (!site) return { ok: false, status: 404, body: { error: "site_not_found" } };
  const page = Math.max(1, Math.floor(q.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(q.pageSize ?? 10)));
  let query = sb
    .from("growthmind_public_content_items")
    .select("*", { count: "exact" })
    .eq("site_id", site.id)
    .eq("workspace_id", site.workspace_id)
    .in("status", PUBLIC_QUERY_STATUSES);
  if (q.category) query = query.eq("category", q.category);
  if (q.tag) query = query.contains("tags", [q.tag]);
  query = q.order === "updated"
    ? query.order("updated_at", { ascending: false })
    : query.order("published_at", { ascending: false, nullsFirst: false });
  const { data, count, error } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return { ok: false, status: 500, body: { error: "internal_error" } };
  const served = await overlayPublishedSnapshots(data ?? []);
  const items = served.map((i: any) => toPublicPost(i, site));
  const latest = (data ?? []).reduce((m: string, i: any) => (i.updated_at > m ? i.updated_at : m), "");
  return {
    ok: true, status: 200,
    body: { items, page, pageSize, total: count ?? items.length, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    version: `${count ?? 0}:${latest}`,
  };
}

export async function getPublicPost(siteKey: string, slug: string): Promise<{ ok: boolean; status: number; body: any; version?: string }> {
  const site = await getSiteByKey(siteKey);
  if (!site) return { ok: false, status: 404, body: { error: "site_not_found" } };
  if (!/^[a-z0-9\-]{1,120}$/.test(slug)) return { ok: false, status: 404, body: { error: "not_found" } };
  const { data } = await sb
    .from("growthmind_public_content_items")
    .select("*")
    .eq("site_id", site.id)
    .eq("workspace_id", site.workspace_id)
    .eq("slug", slug)
    .in("status", PUBLIC_QUERY_STATUSES)
    .maybeSingle();
  if (!data) return { ok: false, status: 404, body: { error: "not_found" } };
  const [served] = await overlayPublishedSnapshots([data]);
  if (!served) return { ok: false, status: 404, body: { error: "not_found" } };
  return { ok: true, status: 200, body: { item: toPublicPost(served, site, { full: true }) }, version: `${data.id}:${data.updated_at}` };
}

export async function getPublicCategories(siteKey: string): Promise<{ ok: boolean; status: number; body: any; version?: string }> {
  const site = await getSiteByKey(siteKey);
  if (!site) return { ok: false, status: 404, body: { error: "site_not_found" } };
  const { data } = await sb
    .from("growthmind_public_content_items")
    .select("id, status, published_version, category, tags, updated_at")
    .eq("site_id", site.id)
    .eq("workspace_id", site.workspace_id)
    .in("status", PUBLIC_QUERY_STATUSES)
    .limit(1000);
  const servedCats = await overlayPublishedSnapshots(data ?? []);
  const catCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  let latest = "";
  for (const r of servedCats) {
    if (r.category) catCounts.set(r.category, (catCounts.get(r.category) ?? 0) + 1);
    for (const t of r.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    if (r.updated_at > latest) latest = r.updated_at;
  }
  return {
    ok: true, status: 200,
    body: {
      categories: [...catCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      tags: [...tagCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    },
    version: `${data?.length ?? 0}:${latest}`,
  };
}

/** Static (non-blog) pages of the Lovable site for the sitemap. Deliberately conservative. */
export const WEBESPOKEAI_STATIC_PAGES: Array<{ path: string; changefreq?: string; priority?: number }> = [
  { path: "/", changefreq: "weekly", priority: 1.0 },
  { path: "/blog", changefreq: "daily" },
];

export async function getSitemapData(siteKey: string): Promise<{ ok: boolean; status: number; body: any; version?: string }> {
  const site = await getSiteByKey(siteKey);
  if (!site) return { ok: false, status: 404, body: { error: "site_not_found" } };
  const { data } = await sb
    .from("growthmind_public_content_items")
    .select("id, published_version, slug, canonical_url, published_at, updated_at, noindex, status")
    .eq("site_id", site.id)
    .eq("workspace_id", site.workspace_id)
    .in("status", PUBLIC_QUERY_STATUSES)
    .order("published_at", { ascending: false })
    .limit(1000);
  const servedRows = await overlayPublishedSnapshots(data ?? []);
  const host = site.canonical_host;
  const urls = [
    ...(site.site_key === "webespokeai" ? WEBESPOKEAI_STATIC_PAGES : [{ path: "/" }]).map((p) => ({
      loc: `https://${host}${p.path}`,
      lastmod: null as string | null,
      ...( (p as any).changefreq ? { changefreq: (p as any).changefreq } : {}),
      ...( (p as any).priority != null ? { priority: (p as any).priority } : {}),
    })),
    ...servedRows
      .filter((r: any) => !r.noindex)
      .map((r: any) => ({
        loc: r.canonical_url ?? `https://${host}/blog/${r.slug}`,
        lastmod: (r.updated_at ?? r.published_at ?? "").slice(0, 10) || null,
      })),
  ];
  const latest = (data ?? []).reduce((m: string, i: any) => (i.updated_at > m ? i.updated_at : m), "");
  return { ok: true, status: 200, body: { canonical_host: host, urls }, version: `${urls.length}:${latest}` };
}

export async function getPublicFeed(siteKey: string): Promise<{ ok: boolean; status: number; body: string; version?: string }> {
  const site = await getSiteByKey(siteKey);
  if (!site) return { ok: false, status: 404, body: "not found" };
  const { data } = await sb
    .from("growthmind_public_content_items")
    .select("id, status, published_version, slug, title, excerpt, published_at, updated_at, canonical_url")
    .eq("site_id", site.id)
    .eq("workspace_id", site.workspace_id)
    .in("status", PUBLIC_QUERY_STATUSES)
    .order("published_at", { ascending: false })
    .limit(20);
  const servedFeed = await overlayPublishedSnapshots(data ?? []);
  const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const host = site.canonical_host;
  const items = servedFeed
    .map((r: any) => {
      const url = r.canonical_url ?? `https://${host}/blog/${r.slug}`;
      return `  <item>\n    <title>${esc(r.title)}</title>\n    <link>${esc(url)}</link>\n    <guid isPermaLink="true">${esc(url)}</guid>\n    ${r.excerpt ? `<description>${esc(r.excerpt)}</description>\n    ` : ""}<pubDate>${new Date(r.published_at ?? r.updated_at).toUTCString()}</pubDate>\n  </item>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n  <title>${esc(site.display_name ?? site.site_key)} Blog</title>\n  <link>https://${host}/blog</link>\n  <description>Latest articles</description>\n${items}\n</channel>\n</rss>`;
  const latest = (data ?? []).reduce((m: string, i: any) => (i.updated_at > m ? i.updated_at : m), "");
  return { ok: true, status: 200, body: xml, version: `${data?.length ?? 0}:${latest}` };
}
