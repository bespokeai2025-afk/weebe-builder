/**
 * SystemMind SEO technical health audit (§12 master programme).
 *
 * Deterministic, evidence-attached checks — no generic advice:
 *  - Search Console connection, token health, property permission
 *  - Sync job state (baseline_pending is a state, not a failure)
 *  - Sitemap accessibility (live HTTP fetch of submitted sitemap URLs)
 *  - robots.txt accessibility + blanket-disallow detection
 *  - noindex / canonical verification of deployed campaign URLs
 *  - GitHub repository status (READ-ONLY; uses GITHUB_PERSONAL_ACCESS_TOKEN)
 *  - Deployment package health (stuck packages, unverified live URLs)
 *
 * All external fetches are limited to URLs WEBEE already stores for this
 * workspace (GSC sitemap paths, deployed live URLs, the connected property
 * host) — never arbitrary caller-supplied URLs.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const sb = supabaseAdmin as any;

export interface SeoAuditCheck {
  check: string;
  status: "pass" | "warn" | "fail" | "skipped";
  detail: string;
  evidence?: unknown;
}

export interface SeoTechAuditResult {
  generatedAt: string;
  checksPerformed: number;
  recordsInspected: number;
  checks: SeoAuditCheck[];
  rootCauses: string[];
  proposedFixes: string[];
}

/** Block obviously-private / internal targets and enforce the property-domain allowlist (SSRF guard). */
function isAllowedAuditUrl(url: string, allowedHost: string | null): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") // raw IPv4 / IPv6 literals
  ) return false;
  if (!allowedHost) return false;
  const base = allowedHost.toLowerCase().replace(/^www\./, "");
  const h = host.replace(/^www\./, "");
  return h === base || h.endsWith(`.${base}`);
}

async function safeFetch(url: string, timeoutMs = 8000): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "WEBEE-SystemMind-SEO-Audit/1.0" } });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text: text.slice(0, 20000) };
  } catch (e: any) {
    return { ok: false, status: 0, text: e?.message ?? "fetch failed" };
  } finally {
    clearTimeout(t);
  }
}

function propertyHost(propertyUrl: string | null): string | null {
  if (!propertyUrl) return null;
  if (propertyUrl.startsWith("sc-domain:")) return propertyUrl.slice("sc-domain:".length);
  try { return new URL(propertyUrl).host; } catch { return null; }
}

export async function runSeoTechAudit(workspaceId: string): Promise<SeoTechAuditResult> {
  const checks: SeoAuditCheck[] = [];
  const rootCauses: string[] = [];
  const proposedFixes: string[] = [];
  let recordsInspected = 0;

  // 1) Connection + token
  let propertyUrl: string | null = null;
  try {
    const { getValidGscToken } = await import("@/lib/growthmind/gsc-sync-core");
    const conn = await getValidGscToken(workspaceId);
    propertyUrl = conn.propertyUrl ?? null;
    checks.push({
      check: "gsc_connection_token",
      status: "pass",
      detail: `Search Console connected; token valid; property ${conn.propertyUrl ?? "not selected"}.`,
      evidence: { propertyUrl: conn.propertyUrl },
    });
    if (!conn.propertyUrl) {
      checks.push({ check: "gsc_property_selected", status: "fail", detail: "No Search Console property selected — SEO department cannot sync.", evidence: null });
      rootCauses.push("No property selected on the GSC connection");
      proposedFixes.push("Select the verified property (sc-domain form) in GrowthMind → SEO settings");
    }
  } catch (e: any) {
    checks.push({ check: "gsc_connection_token", status: "fail", detail: `Search Console token unavailable: ${e?.message}`, evidence: null });
    rootCauses.push("GSC OAuth token invalid or connection missing");
    proposedFixes.push("Reconnect Google Search Console from the SEO Department page");
  }

  // 2) Sync job state
  const { data: syncState } = await sb
    .from("growthmind_gsc_sync_state").select("*").eq("workspace_id", workspaceId).maybeSingle();
  if (syncState) {
    recordsInspected += 1;
    const stale = syncState.last_synced_at && Date.now() - new Date(syncState.last_synced_at).getTime() > 48 * 3600 * 1000;
    checks.push({
      check: "gsc_sync_job",
      status: syncState.status === "failed" ? "fail" : stale ? "warn" : "pass",
      detail: syncState.status === "baseline_pending"
        ? "Sync healthy — Google has not published performance rows for this property yet (normal for newly verified properties)."
        : `Last sync ${syncState.status} at ${syncState.last_synced_at ?? "never"}; ${syncState.rows_imported ?? 0} rows imported.${stale ? " Sync is >48h old." : ""}`,
      evidence: { status: syncState.status, lastSyncedAt: syncState.last_synced_at, rowsImported: syncState.rows_imported, lastError: syncState.error_message },
    });
    if (syncState.status === "failed") {
      rootCauses.push(`GSC sync failing: ${syncState.error_message ?? "unknown error"}`);
      proposedFixes.push("Trigger a manual sync from the SEO Department Overview and re-check the stored error");
    }
  } else {
    checks.push({ check: "gsc_sync_job", status: "warn", detail: "No sync state recorded yet — initial sync has not run.", evidence: null });
  }

  // 3) Sitemap accessibility (live fetch of stored sitemap paths)
  const { data: sitemaps } = await sb
    .from("growthmind_gsc_sitemaps").select("path, errors, warnings, is_pending").eq("workspace_id", workspaceId).limit(10);
  if ((sitemaps ?? []).length === 0) {
    const host = propertyHost(propertyUrl);
    if (host) {
      const guess = `https://${host}/sitemap.xml`;
      const res = await safeFetch(guess);
      checks.push({
        check: "sitemap_accessibility",
        status: res.ok ? "warn" : "fail",
        detail: res.ok
          ? `No sitemap submitted to Search Console, but ${guess} responds ${res.status} — submit it (requires approval).`
          : `No sitemap submitted and ${guess} is not reachable (HTTP ${res.status}). The Lovable site may not expose a sitemap.`,
        evidence: { url: guess, httpStatus: res.status },
      });
      if (!res.ok) {
        rootCauses.push("Website has no accessible sitemap.xml");
        proposedFixes.push("Add a sitemap to the Lovable site, then approve sitemap submission in WEBEE");
      } else {
        proposedFixes.push(`Approve submission of ${guess} via the submit_approved_sitemap tool`);
      }
    } else {
      checks.push({ check: "sitemap_accessibility", status: "skipped", detail: "No property host available to probe.", evidence: null });
    }
  } else {
    for (const s of sitemaps ?? []) {
      recordsInspected += 1;
      if (!isAllowedAuditUrl(s.path, propertyHost(propertyUrl))) {
        checks.push({ check: "sitemap_accessibility", status: "skipped", detail: `${s.path}: not on the connected property domain — fetch skipped (SSRF guard).`, evidence: { path: s.path } });
        continue;
      }
      const res = await safeFetch(s.path);
      checks.push({
        check: "sitemap_accessibility",
        status: res.ok && Number(s.errors) === 0 ? "pass" : "warn",
        detail: `${s.path}: HTTP ${res.status}; GSC reports ${s.errors} errors / ${s.warnings} warnings${s.is_pending ? " (pending)" : ""}.`,
        evidence: { path: s.path, httpStatus: res.status, gscErrors: s.errors, gscWarnings: s.warnings },
      });
    }
  }

  // 4) robots.txt
  const host = propertyHost(propertyUrl);
  if (host) {
    const res = await safeFetch(`https://${host}/robots.txt`);
    const blanketDisallow = /User-agent:\s*\*\s*[\r\n]+\s*Disallow:\s*\/\s*$/im.test(res.text);
    checks.push({
      check: "robots_txt",
      status: !res.ok ? "warn" : blanketDisallow ? "fail" : "pass",
      detail: !res.ok
        ? `robots.txt not reachable (HTTP ${res.status}) — Google treats missing robots.txt as allow-all.`
        : blanketDisallow
          ? "robots.txt DISALLOWS the entire site for all crawlers — pages cannot be indexed."
          : "robots.txt reachable and does not block the whole site.",
      evidence: { url: `https://${host}/robots.txt`, httpStatus: res.status, snippet: res.text.slice(0, 500) },
    });
    if (blanketDisallow) {
      rootCauses.push("robots.txt blocks all crawling");
      proposedFixes.push("Remove the blanket Disallow rule in the Lovable site settings");
    }
  }

  // 5) Deployed campaign URLs — live verification + noindex + canonical
  const { data: pkgs } = await sb
    .from("growthmind_seo_deployment_packages")
    .select("id, status, live_url, proposed_route, verified_at, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(10);
  for (const p of pkgs ?? []) {
    recordsInspected += 1;
    if (p.live_url) {
      if (!isAllowedAuditUrl(p.live_url, host)) {
        checks.push({
          check: "live_page_verification",
          status: "warn",
          detail: `${p.live_url} is not on the connected property domain (${host ?? "none"}) — fetch skipped (SSRF guard). Verify the stored live URL.`,
          evidence: { packageId: p.id, url: p.live_url },
        });
        continue;
      }
      const res = await safeFetch(p.live_url);
      const noindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(res.text);
      const canonicalMatch = res.text.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
      checks.push({
        check: "live_page_verification",
        status: !res.ok ? "fail" : noindex ? "fail" : "pass",
        detail: !res.ok
          ? `${p.live_url} returns HTTP ${res.status} — deployed page is not live.`
          : noindex
            ? `${p.live_url} carries a noindex meta tag — it will never be indexed.`
            : `${p.live_url} is live (HTTP ${res.status})${canonicalMatch ? `, canonical ${canonicalMatch[1]}` : ", no canonical tag found"}.`,
        evidence: { packageId: p.id, url: p.live_url, httpStatus: res.status, noindex, canonical: canonicalMatch?.[1] ?? null },
      });
      if (noindex) {
        rootCauses.push(`Deployed page ${p.live_url} has a noindex tag`);
        proposedFixes.push("Remove the noindex meta tag in Lovable and republish");
      }
    } else if (p.status === "awaiting_website_deployment" && Date.now() - new Date(p.created_at).getTime() > 7 * 86400_000) {
      checks.push({
        check: "deployment_package_health",
        status: "warn",
        detail: `Package for route ${p.proposed_route} has been awaiting manual Lovable deployment for over 7 days.`,
        evidence: { packageId: p.id, status: p.status, createdAt: p.created_at },
      });
    }
  }

  // 6) GitHub repository status (READ-ONLY)
  const ghToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (ghToken) {
    try {
      const res = await fetch("https://api.github.com/user/repos?per_page=5&sort=pushed", {
        headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json", "User-Agent": "WEBEE-SystemMind" },
      });
      if (res.ok) {
        const repos = (await res.json()) as any[];
        checks.push({
          check: "github_status",
          status: "pass",
          detail: `GitHub reachable (read-only). ${repos.length} recent repositories visible; latest push ${repos[0]?.pushed_at ?? "n/a"} (${repos[0]?.full_name ?? "n/a"}).`,
          evidence: repos.map((r) => ({ name: r.full_name, pushedAt: r.pushed_at, defaultBranch: r.default_branch })),
        });
      } else {
        checks.push({ check: "github_status", status: "warn", detail: `GitHub API returned ${res.status} — token may lack scope or be expired.`, evidence: { httpStatus: res.status } });
      }
    } catch (e: any) {
      checks.push({ check: "github_status", status: "warn", detail: `GitHub unreachable: ${e?.message}`, evidence: null });
    }
  } else {
    checks.push({ check: "github_status", status: "skipped", detail: "No GitHub token configured.", evidence: null });
  }

  // 7) Public Content Publishing backbone (§14 continuation programme)
  const { data: pubSite } = await sb
    .from("growthmind_public_sites").select("*").eq("workspace_id", workspaceId).eq("status", "active").limit(1).maybeSingle();
  if (pubSite) {
    recordsInspected += 1;
    const [{ count: publishedCount }, { count: deadCount }, { data: pendingExecs }] = await Promise.all([
      sb.from("growthmind_public_content_items").select("id", { count: "exact", head: true })
        .eq("site_id", pubSite.id).in("status", ["api_published", "awaiting_website_refresh", "live", "live_verification_failed"]),
      sb.from("growthmind_publication_executions").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).eq("status", "dead_letter"),
      sb.from("growthmind_publication_executions").select("id, status, next_attempt_at, kind")
        .eq("workspace_id", workspaceId).in("status", ["pending", "running"]).limit(20),
    ]);
    checks.push({
      check: "public_content_api",
      status: "pass",
      detail: `Public Content API: Ready. Site key "${pubSite.site_key}" (${pubSite.canonical_host}) is active with ${publishedCount ?? 0} published article(s) served at /api/public/v1/sites/${pubSite.site_key}/*.`,
      evidence: { siteKey: pubSite.site_key, canonicalHost: pubSite.canonical_host, publishedArticles: publishedCount ?? 0 },
    });
    // Lovable blog frontend availability (probe /blog on the canonical host — allowlisted by construction)
    const blogUrl = `https://${pubSite.canonical_host}/blog`;
    const blogRes = await safeFetch(blogUrl);
    const blogConnected = blogRes.ok && /article|blog|post/i.test(blogRes.text);
    checks.push({
      check: "lovable_blog_frontend",
      status: blogConnected ? "pass" : "warn",
      detail: blogConnected
        ? `Lovable Blog Frontend: Connected — ${blogUrl} responds ${blogRes.status}.`
        : `Lovable Blog Frontend: Not Connected — ${blogUrl} ${blogRes.ok ? "responds but does not render blog content" : `returns HTTP ${blogRes.status}`}. Published articles remain "API Published — Awaiting Lovable Frontend".`,
      evidence: { url: blogUrl, httpStatus: blogRes.status, connected: blogConnected },
    });
    checks.push({
      check: "publication_capability",
      status: "pass",
      detail: blogConnected
        ? "Publication Capability: API + Frontend."
        : "Publication Capability: API Only — WEBEE publishes to its public content API; the website renders nothing until Lovable implements the blog frontend. Sitemap.xml: Missing — awaiting Lovable implementation (sitemap-data endpoint is ready).",
      evidence: { sitemapDataEndpoint: `/api/public/v1/sites/${pubSite.site_key}/sitemap-data` },
    });
    if ((deadCount ?? 0) > 0) {
      checks.push({
        check: "failed_publication_jobs",
        status: "fail",
        detail: `${deadCount} publication execution(s) are dead-lettered after exhausting retries — review and re-run or reject them.`,
        evidence: { deadLetterCount: deadCount },
      });
      rootCauses.push("Publication executions in dead-letter state");
      proposedFixes.push("Open the article, resolve the recorded execution error and publish again");
    } else {
      checks.push({ check: "failed_publication_jobs", status: "pass", detail: "No dead-lettered publication executions.", evidence: { pendingOrRunning: (pendingExecs ?? []).length } });
    }
  } else {
    checks.push({ check: "public_content_api", status: "skipped", detail: "Public Content API: Not Ready — no public site registered for this workspace.", evidence: null });
  }

  return {
    generatedAt: new Date().toISOString(),
    checksPerformed: checks.length,
    recordsInspected,
    checks,
    rootCauses,
    proposedFixes,
  };
}
