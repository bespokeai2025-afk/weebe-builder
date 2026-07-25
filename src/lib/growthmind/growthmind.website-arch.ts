// ── Website Ownership & Deployment Audit (Phase 4) ───────────────────────────
// Live, evidence-based classification of where the workspace's website is
// registered, DNS-hosted and deployed. Read-only: performs DNS-over-HTTPS
// lookups and a HEAD request — never modifies DNS, domains or hosting.
//
// Honest-state rule: WEBEE currently has NO Lovable / GitHub deployment
// integration, so the capability level is reported as "content_draft_only"
// and any SEO change packages must be marked "Awaiting Website Deployment"
// rather than claiming execution.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type WebsiteArchitecture = {
  siteUrl:        string | null;
  hostname:       string | null;
  nameservers:    string[];
  aRecords:       string[];
  cname:          string | null;
  dnsProvider:    string | null;       // e.g. "GoDaddy", "name.com", "Cloudflare"
  hostingPlatform:string | null;       // e.g. "Lovable Cloud", "Replit Deployments"
  proxyDetected:  string | null;       // e.g. "Cloudflare"
  classification:
    | "lovable_cloud"
    | "github_external"
    | "godaddy_hosted"
    | "godaddy_dns_only"
    | "replit_deployment"
    | "unknown";
  capability:     "content_draft_only" | "no_deployment_integration";
  deploymentNote: string;
  checkedAt:      string;
  errors:         string[];
};

const NS_PROVIDERS: Array<[RegExp, string]> = [
  [/domaincontrol\.com\.?$/i, "GoDaddy"],
  [/name\.com\.?$/i,          "name.com"],
  [/cloudflare\.com\.?$/i,    "Cloudflare"],
  [/awsdns/i,                 "AWS Route 53"],
  [/googledomains\.com\.?$/i, "Google Domains"],
];

// Documented ingress IPs (fingerprints, not guesses)
const LOVABLE_A = new Set(["185.158.133.1"]);
const REPLIT_GCP_PREFIX = "34.111.";

async function doh(name: string, type: string): Promise<string[]> {
  const res = await fetch(
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
  const j = await res.json() as { Answer?: Array<{ type: number; data: string }> };
  const want = type === "NS" ? 2 : type === "A" ? 1 : type === "CNAME" ? 5 : -1;
  return (j.Answer ?? []).filter(a => a.type === want).map(a => a.data);
}

export const auditWebsiteArchitecture = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WebsiteArchitecture> => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const errors: string[] = [];
    const { data: siteRow } = await sb
      .from("growthmind_seo_sites")
      .select("url")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const siteUrl = (siteRow?.url as string | null) ?? null;
    const base: WebsiteArchitecture = {
      siteUrl, hostname: null, nameservers: [], aRecords: [], cname: null,
      dnsProvider: null, hostingPlatform: null, proxyDetected: null,
      classification: "unknown", capability: "no_deployment_integration",
      deploymentNote:
        "WEBEE has no direct deployment integration for this website. SEO changes are prepared as approved change packages and marked 'Awaiting Website Deployment' — they are never auto-published.",
      checkedAt: new Date().toISOString(), errors,
    };
    if (!siteUrl) { errors.push("No website configured in GrowthMind SEO yet."); return base; }

    let hostname: string;
    try { hostname = new URL(siteUrl).hostname; }
    catch { errors.push("Configured site URL is not a valid URL."); return base; }
    base.hostname = hostname;

    const apex = hostname.replace(/^www\./i, "");
    try {
      const [ns, a, cname] = await Promise.all([
        doh(apex, "NS"), doh(hostname, "A"), doh(hostname, "CNAME"),
      ]);
      base.nameservers = ns;
      base.aRecords    = a;
      base.cname       = cname[0] ?? null;
      for (const [re, label] of NS_PROVIDERS) {
        if (ns.some(n => re.test(n))) { base.dnsProvider = label; break; }
      }
      if (a.some(ip => LOVABLE_A.has(ip))) {
        base.hostingPlatform = "Lovable Cloud";
        base.classification  = "lovable_cloud";
      } else if (a.some(ip => ip.startsWith(REPLIT_GCP_PREFIX))) {
        base.hostingPlatform = "Replit Deployments";
        base.classification  = "replit_deployment";
      } else if (base.dnsProvider === "GoDaddy") {
        base.classification = "godaddy_dns_only";
      }
    } catch (e: any) {
      errors.push(`DNS lookup failed: ${String(e?.message ?? e)}`);
    }

    try {
      // SSRF guard: workspace-controlled URL — block private/internal targets.
      const { assertSafeOutboundUrl } = await import("@/lib/systemmind/crm-connections/url-guard");
      await assertSafeOutboundUrl(siteUrl, "Website URL");
      const head = await fetch(siteUrl, {
        method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000),
      });
      if (head.headers.get("cf-ray") || /cloudflare/i.test(head.headers.get("server") ?? "")) {
        base.proxyDetected = "Cloudflare";
      }
    } catch (e: any) {
      errors.push(`Site reachability check failed: ${String(e?.message ?? e)}`);
    }

    if (base.classification === "lovable_cloud") {
      base.capability = "content_draft_only";
    }
    return base;
  });
