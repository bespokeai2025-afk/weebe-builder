// ── Public Content Publishing contract tests ─────────────────────────────────
// Guards the master-programme contract for the public content publishing
// backbone (Lovable blog API):
//  1. Public API serves ONLY published statuses; "updating" items serve the
//     published snapshot, never in-progress edits.
//  2. Dual human approvals (content + publication) precede any publication;
//     approval actions are sensitive HiveMind actions.
//  3. Honest status language — nothing claims "Live" without live verification;
//     the terminal API state is api_published ("API Published — Awaiting
//     Lovable Frontend").
//  4. Preview tokens are hashed, expiring, and previews are always noindex.
//  5. Sitemap remains data-only (sitemap-data endpoint) — WEBEE never claims
//     to host sitemap.xml; that is Lovable's job per the contract doc.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { SENSITIVE_ACTIONS, isSensitiveActionType } from "@/lib/hivemind/action-safety.shared";

const root = path.resolve(__dirname, "../..");
const lib = readFileSync(path.join(root, "src/lib/growthmind/public-content.server.ts"), "utf8");
const engine = readFileSync(path.join(root, "src/lib/growthmind/publication-engine.server.ts"), "utf8");
const tools = readFileSync(path.join(root, "src/lib/minds/register-content-tools.server.ts"), "utf8");
const audit = readFileSync(path.join(root, "src/lib/systemmind/seo-tech-audit.server.ts"), "utf8");

describe("public read layer contract", () => {
  it("public statuses whitelist excludes drafts and withdrawn", () => {
    expect(lib).toContain('PUBLIC_STATUSES = ["api_published", "awaiting_website_refresh", "live", "live_verification_failed"]');
    expect(lib).not.toMatch(/PUBLIC_STATUSES = \[[^\]]*"draft"/);
    expect(lib).not.toMatch(/PUBLIC_STATUSES = \[[^\]]*"withdrawn"/);
  });

  it("updating items serve the published snapshot, never live edits", () => {
    expect(lib).toContain("overlayPublishedSnapshots");
    // every public read applies the overlay
    const overlayUses = lib.split("overlayPublishedSnapshots(").length - 1;
    expect(overlayUses).toBeGreaterThanOrEqual(6); // definition + 5 read fns
    // updating items without a published version are dropped, not exposed
    expect(lib).toContain('i.status !== "updating" || byItem.has(i.id)');
  });

  it("previews are always noindex and tokens are hashed + expiring", () => {
    expect(lib).toMatch(/noindex: opts\?\.preview \? true/);
    expect(lib).toContain("token_hash");
    expect(lib).toContain("expires_at");
    // raw token never persisted
    expect(lib).not.toMatch(/insert\(\{[^}]*\btoken:\s/s);
  });

  it("slug rules: lowercase charset + reserved paths rejected", () => {
    expect(lib).toMatch(/\[a-z0-9\\?-\]/);
    expect(lib).toMatch(/RESERVED_SLUGS|reserved/i);
  });
});

describe("approval + publication contract", () => {
  it("dual approvals precede publication and are pending HiveMind actions", () => {
    expect(engine).toContain('CONTENT_PUBLICATION_ACTION_TYPE = "content_publication_approval"');
    expect(engine).toContain("action_type: CONTENT_PUBLICATION_ACTION_TYPE");
    expect(engine).toContain('status: "pending"');
    // dual approvals: content stage AND deployment/publication stage both raise actions
    expect(engine).toMatch(/stage: "content"/);
    expect(engine).toContain("Approve article content");
    expect(engine).toContain("awaiting_publication_approval");
  });

  it("the approval action type is sensitive (never auto-executed)", () => {
    expect(isSensitiveActionType("content_publication_approval")).toBe(true);
    expect(SENSITIVE_ACTIONS["content_publication_approval"]).toBe("campaign");
  });

  it("honest status: publication lands at api_published, never claims Live", () => {
    expect(engine).toContain('"api_published"');
    // "live" status may only be set by live verification, not by publish/schedule
    expect(engine).not.toMatch(/publishNow[\s\S]{0,800}status:\s*"live"/);
  });

  it("mind tools: publish/schedule/withdraw/rollback are sensitive-gated", () => {
    for (const t of [
      "growthmind.content.publish_article_now",
      "growthmind.content.schedule_publication",
      "growthmind.content.withdraw_article",
      "growthmind.content.rollback_article",
    ]) {
      const idx = tools.indexOf(t);
      expect(idx).toBeGreaterThan(-1);
      expect(tools.slice(idx, idx + 2000)).toMatch(/sensitive:\s*true/);
    }
  });
});

describe("schema-drift + SSRF guards", () => {
  it("parity surfaces select only real columns (no live_verified_at / last_error drift)", () => {
    const seo = readFileSync(path.join(root, "src/routes/api/v1/seo.ts"), "utf8");
    for (const src of [tools, seo]) {
      expect(src).not.toContain("live_verified_at");
    }
    expect(seo).not.toContain("last_error");
    expect(seo).toContain("live_verification_state");
    expect(seo).toContain("error_message");
    expect(tools).toContain("live_verification_state");
  });

  it("live-verification fetch is SSRF-guarded", () => {
    expect(engine).toContain("isSafeVerificationHost");
    expect(engine).toMatch(/isSafeVerificationHost\(site\.canonical_host\)/);
  });
});

describe("SystemMind health + sitemap honesty", () => {
  it("tech audit reports public content API and Lovable frontend separately", () => {
    expect(audit).toContain("public_content_api");
    expect(audit).toContain("lovable_blog_frontend");
  });

  it("sitemap.xml stays Lovable's responsibility (data endpoint only)", () => {
    expect(existsSync(path.join(root, "src/routes/api/public/v1/sites.$siteKey.sitemap-data.ts"))).toBe(true);
    expect(existsSync(path.join(root, "docs/LOVABLE_BLOG_INTEGRATION_CONTRACT.md"))).toBe(true);
    const doc = readFileSync(path.join(root, "docs/LOVABLE_BLOG_INTEGRATION_CONTRACT.md"), "utf8");
    expect(doc).toContain("Awaiting Lovable Frontend");
    expect(doc).toContain("sitemap.xml");
  });
});
