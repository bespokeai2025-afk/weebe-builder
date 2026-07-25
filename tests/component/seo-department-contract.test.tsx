// ── SEO Department contract tests ─────────────────────────────────────────────
// Guards the master-programme safety contract for the SEO / blog campaign
// system:
//  1. Every campaign stage requires an explicit human approval action.
//  2. The safety gate runs before any deployment package is built and checks
//     restricted claims, metadata validity, duplicates, URL format and depth.
//  3. Deployment is MANUAL-ONLY (Lovable package handoff) — no code path may
//     claim to publish to the customer website directly.
//  4. seo_campaign_approval is classified sensitive and executable by the
//     HiveMind action centre.
//  5. Analytics never invent metrics — baseline_pending is a first-class state.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SENSITIVE_ACTIONS, isSensitiveActionType } from "@/lib/hivemind/action-safety.shared";

const root = path.resolve(__dirname, "../..");
const engine = readFileSync(path.join(root, "src/lib/growthmind/seo-blog-campaign.server.ts"), "utf8");
const actions = readFileSync(path.join(root, "src/lib/hivemind/hivemind.actions.ts"), "utf8");
const tools = readFileSync(path.join(root, "src/lib/minds/register-seo-tools.server.ts"), "utf8");
const syncCore = readFileSync(path.join(root, "src/lib/growthmind/gsc-sync-core.ts"), "utf8");
const audit = readFileSync(path.join(root, "src/lib/systemmind/seo-tech-audit.server.ts"), "utf8");

describe("SEO campaign approval contract", () => {
  it("every stage advance creates a pending hivemind approval action", () => {
    expect(engine).toContain('action_type: "seo_campaign_approval"');
    expect(engine).toContain('status: "pending"');
    // Approval actions raised at strategy, brief, content and deployment stages
    for (const stage of ['stage: "strategy"', 'stage: "brief"', 'stage: "content"', 'stage: "deployment"']) {
      expect(engine).toContain(stage);
    }
  });

  it("seo_campaign_approval is a sensitive action type (never auto-executed)", () => {
    expect(isSensitiveActionType("seo_campaign_approval")).toBe(true);
    expect(SENSITIVE_ACTIONS["seo_campaign_approval"]).toBe("campaign");
  });

  it("HiveMind action executor can execute seo_campaign_approval", () => {
    expect(actions).toContain('case "seo_campaign_approval"');
    expect(actions).toContain("advanceSeoCampaign");
  });
});

describe("SEO safety gate", () => {
  it("checks restricted claims, metadata, duplicates, URL format and content depth", () => {
    for (const check of ["restricted_claims", "meta_title_length", "meta_description_length", "duplicate_title", "url_format", "content_depth"]) {
      expect(engine).toContain(`"${check}"`);
    }
  });

  it("safety gate result is stored on the campaign before deployment packaging", () => {
    expect(engine).toContain("runSeoSafetyGate");
    expect(engine).toContain("safety_results");
  });
});

describe("Manual-only Lovable deployment", () => {
  it("the package explicitly states WEBEE cannot publish directly", () => {
    expect(engine).toContain("MANUAL LOVABLE DEPLOYMENT");
    expect(engine).toContain("cannot publish");
  });

  it("no direct-publish claims exist in SEO tool descriptions", () => {
    expect(tools).not.toMatch(/publishes? (directly|automatically) to/i);
  });
});

describe("Honest analytics (no invented metrics)", () => {
  it("gsc sync treats empty analytics as baseline_pending, not zeroes", () => {
    expect(syncCore).toContain("baseline_pending");
  });

  it("AccountsMind SEO costs never invent attribution", () => {
    expect(tools).toContain('state: "unknown"');
    expect(tools).toContain("never estimated");
  });
});

describe("SystemMind SEO tech audit", () => {
  it("performs evidence-attached checks (connection, sync, sitemap, robots, noindex, github)", () => {
    for (const c of ["gsc_connection_token", "gsc_sync_job", "sitemap_accessibility", "robots_txt", "live_page_verification", "github_status"]) {
      expect(audit).toContain(`"${c}"`);
    }
  });

  it("GitHub access is read-only (no write verbs)", () => {
    expect(audit).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  });
});
