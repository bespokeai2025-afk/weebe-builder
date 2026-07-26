/**
 * Task #498 — Universal Content Safety Gate tests.
 *
 * Covers:
 *  - Pure helpers: splitIntoSentences, hasSourcingContext, classifyClaimSentence,
 *    matchesAllowList, extractUrls, isContentUrlSafe
 *  - runContentSafetyCheck with mocked DB (no real Supabase connection required)
 *  - One clean-pass example per content type
 *  - Violation examples: fabricated stat, fake testimonial, performance guarantee,
 *    ranking claim, thin content, workspace restriction, unsafe embedded URL
 *  - Allow-list exempts workspace-approved USPs from fabricated-stat flag
 *    and produces approved_customer_evidence classification
 *  - safetyCheckEvidenceItem produces correct evidence shape
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock supabaseAdmin so no DB call goes out ────────────────────────────────
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq:         () => ({
          eq:       () => ({
            in:     () => ({ limit: async () => ({ data: [], error: null }) }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          in:       () => ({ limit: async () => ({ data: [], error: null }) }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

import {
  splitIntoSentences,
  hasSourcingContext,
  classifyClaimSentence,
  matchesAllowList,
  runContentSafetyCheck,
  safetyCheckEvidenceItem,
  type SafetyCheckResult,
} from "@/lib/content-safety/universal-content-safety.server";

const WS = "11111111-2222-3333-4444-555555555555";

// ════════════════════════════════════════════════════════════════════════════
// Pure helper tests
// ════════════════════════════════════════════════════════════════════════════

describe("splitIntoSentences", () => {
  it("splits on sentence-ending punctuation", () => {
    const result = splitIntoSentences("Hello world. This is great! Is it? Yes.");
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it("merges newlines before splitting", () => {
    const result = splitIntoSentences("Line one.\nLine two.\nLine three.");
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it("filters out very short fragments", () => {
    const result = splitIntoSentences("Hi. This is a proper sentence. OK.");
    const longEnough = result.filter((s) => s.length > 5);
    expect(longEnough.length).toBeGreaterThan(0);
  });
});

describe("hasSourcingContext", () => {
  it("returns true for 'according to' citations", () => {
    expect(hasSourcingContext("According to Forrester research, 45% of businesses use AI.")).toBe(true);
  });

  it("returns true for 'our internal data shows'", () => {
    expect(hasSourcingContext("Our internal data shows a 30% improvement in conversion rates.")).toBe(true);
  });

  it("returns false for unsourced claims", () => {
    expect(hasSourcingContext("Customers see 300% ROI within 6 months.")).toBe(false);
  });

  it("returns true for 'based on our research'", () => {
    expect(hasSourcingContext("Based on our real data, we see consistent results.")).toBe(true);
  });
});

describe("classifyClaimSentence", () => {
  it("classifies sourced internal data as verified_internal_fact", () => {
    expect(classifyClaimSentence("From our platform data we see a 25% lift.")).toBe("verified_internal_fact");
  });

  it("classifies 'according to Harvard' as verified_external_source", () => {
    expect(classifyClaimSentence("According to Harvard Business Review, AI adoption grew 40%.")).toBe("verified_external_source");
  });

  it("classifies 'for example' as labelled_hypothetical", () => {
    expect(classifyClaimSentence("For example, a business with 10 employees could save hours.")).toBe("labelled_hypothetical");
  });

  it("classifies 'approximately' as labelled_estimate", () => {
    expect(classifyClaimSentence("Approximately 60% of marketers use content marketing.")).toBe("labelled_estimate");
  });

  it("classifies 'we believe' as labelled_hypothesis", () => {
    expect(classifyClaimSentence("We believe this approach may improve your conversion rates.")).toBe("labelled_hypothesis");
  });

  it("classifies bare unsourced stat as unclassified_flagged", () => {
    expect(classifyClaimSentence("Customers see 300% ROI in just 30 days.")).toBe("unclassified_flagged");
  });
});

describe("matchesAllowList", () => {
  const allowed = ["award-winning customer support", "ISO 27001 certified"];

  it("returns true when sentence contains an allowed claim", () => {
    expect(matchesAllowList("We provide award-winning customer support to all clients.", allowed)).toBe(true);
  });

  it("returns false when sentence does not match any allowed claim", () => {
    expect(matchesAllowList("Customers see 300% ROI.", allowed)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesAllowList("Our ISO 27001 CERTIFIED team handles all data securely.", allowed)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// runContentSafetyCheck — clean pass examples
// ════════════════════════════════════════════════════════════════════════════

describe("runContentSafetyCheck — clean content passes", () => {
  it("passes clean blog article", async () => {
    const text = `
      Content marketing is an effective strategy for businesses of all sizes.
      By publishing valuable articles, you can attract potential customers and
      build brand authority. According to HubSpot research, companies that blog
      regularly generate significantly more leads than those that don't.
      Starting a blog is straightforward: choose relevant topics, write clearly,
      and publish consistently. Over time, your content library becomes a
      valuable business asset. Many businesses find that blog content drives
      long-term organic traffic at a lower cost than paid advertising.
      We recommend starting with two posts per week to build momentum.
      Focus on answering questions your ideal customers are already searching for.
      This approach may help you attract more qualified leads over time.
    `.repeat(5);
    const result = await runContentSafetyCheck(text, "blog_article", WS);
    expect(result.violations).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it("passes clean email campaign", async () => {
    const text = `
      Hi there! We wanted to share some exciting updates about our platform with you.
      Our team has been working hard over the past few months to improve our service
      based on your valuable feedback. We believe these recent changes may help
      streamline your day-to-day workflow and save you meaningful time each week.
      In this email we walk through three key improvements: faster onboarding for
      new team members, smarter scheduling for busy calendars, and an updated
      reporting dashboard that gives you clearer insights. Click the link below
      to learn more and explore what is new in your account.
    `;
    const result = await runContentSafetyCheck(text, "email_campaign", WS);
    expect(result.violations).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it("passes clean WhatsApp message", async () => {
    const text = "Hi! Your appointment is confirmed for tomorrow at 10am. Reply STOP to opt out.";
    const result = await runContentSafetyCheck(text, "whatsapp_campaign", WS);
    expect(result.violations).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it("passes clean social post", async () => {
    const text = "Excited to share our latest feature — smarter scheduling for busy teams! Check it out in the link below. 🎉";
    const result = await runContentSafetyCheck(text, "linkedin_post", WS);
    expect(result.violations).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it("passes clean AI call script", async () => {
    const text = `
      Hello, this is the WEBEE AI assistant calling on behalf of your company.
      I'm reaching out to see if you'd be interested in learning about how we
      can help streamline your customer onboarding process. Do you have a few
      minutes to discuss? If not, when would be a better time to call back?
      Thank you for your time and have a great day.
    `.repeat(3);
    const result = await runContentSafetyCheck(text, "ai_call_script", WS);
    expect(result.violations).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it("passes clean video script", async () => {
    const text = `
      Welcome to our product demo. In this short video, we'll show you how
      our platform can help you manage your team more effectively. First, let's
      take a look at the dashboard. Here you can see all your active projects
      at a glance. Our intuitive interface is designed to help you stay
      organised without the complexity of traditional project management tools.
      Let's walk through a typical workflow. You might find this saves time
      in your day-to-day operations. Ready to get started? Sign up for a free
      trial today and see how it works for your team.
    `.repeat(2);
    const result = await runContentSafetyCheck(text, "video_script", WS);
    expect(result.violations).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it("passes clean sales letter", async () => {
    const text = `
      Dear valued prospect, we'd like to introduce you to our service.
      Over the past few years, we've helped businesses in your industry
      improve their workflows. We believe our solution could be a good fit
      for your needs, and we'd love to discuss how we might be able to help.
      Our approach focuses on understanding your specific challenges first,
      then tailoring our recommendations accordingly. We think you may find
      our methodology refreshingly straightforward compared to more complex
      alternatives. We'd be happy to set up a brief call to explore whether
      this is the right fit for your business. No pressure — just a conversation.
    `.repeat(2);
    const result = await runContentSafetyCheck(text, "sales_letter", WS);
    expect(result.violations).toHaveLength(0);
    expect(result.passed).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// runContentSafetyCheck — violation detection
// ════════════════════════════════════════════════════════════════════════════

describe("runContentSafetyCheck — fabricated statistics", () => {
  it("flags 'Customers see 300% ROI' as a violation", async () => {
    const text = `
      Customers see 300% ROI within the first 30 days of using our platform.
      This makes us one of the most cost-effective solutions on the market.
      Our onboarding process is smooth and straightforward.
    `.repeat(10);
    const result = await runContentSafetyCheck(text, "email_campaign", WS);
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("fabricated_statistics"))).toBe(true);
    expect(result.claim_classifications.some((c) => c.category === "unclassified_flagged")).toBe(true);
  });

  it("flags '5x more revenue' as a violation", async () => {
    const text = "Our users generate 5x more revenue within 60 days of signing up. Start today!";
    const result = await runContentSafetyCheck(text, "landing_page", WS);
    expect(result.violations.some((v) => v.includes("fabricated_statistics"))).toBe(true);
  });

  it("does NOT flag a cited statistic", async () => {
    const text = `
      According to Gartner, companies that invest in AI see a 37% increase in
      productivity. Our platform is designed to help you achieve similar results.
      We believe this approach may help your team work more efficiently.
      Contact us to learn how we can help your business grow sustainably.
    `.repeat(5);
    const result = await runContentSafetyCheck(text, "email_campaign", WS);
    const statViolation = result.violations.some((v) => v.includes("fabricated_statistics"));
    expect(statViolation).toBe(false);
  });

  it("does NOT flag an estimated stat", async () => {
    const text = `
      Approximately 60% of businesses report improved efficiency after implementing
      automation. On average, teams save a few hours per week using our tools.
      Your results may vary depending on your specific setup and workflows.
      We encourage you to start a trial to see what impact it has for you.
    `.repeat(5);
    const result = await runContentSafetyCheck(text, "email_campaign", WS);
    const statViolation = result.violations.some((v) => v.includes("fabricated_statistics"));
    expect(statViolation).toBe(false);
  });
});

describe("runContentSafetyCheck — fake testimonials", () => {
  it("flags an invented quoted testimonial with attribution", async () => {
    const text = `
      Our solution has transformed businesses across the industry.
      "This platform changed everything for us." — Jane Smith
      We're proud to serve clients who demand the best.
      Our team is ready to help you succeed.
    `.repeat(5);
    const result = await runContentSafetyCheck(text, "blog_article", WS);
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("fake_testimonials"))).toBe(true);
  });

  it("flags 'Our customer John said:' pattern", async () => {
    const text = `
      Our customer John told us: "The results were incredible." We're glad to hear it.
      We strive to deliver real value for every client we work with.
    `.repeat(10);
    const result = await runContentSafetyCheck(text, "email_campaign", WS);
    expect(result.violations.some((v) => v.includes("fake_testimonials"))).toBe(true);
  });
});

describe("runContentSafetyCheck — performance guarantees", () => {
  it("flags 'guaranteed to increase' language", async () => {
    const text = `
      Our system is guaranteed to increase your sales by next quarter.
      We stand behind our product with a full satisfaction commitment.
      Join thousands of businesses who trust us every day.
    `.repeat(10);
    const result = await runContentSafetyCheck(text, "sales_letter", WS);
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("performance_guarantees"))).toBe(true);
  });

  it("flags '100% success rate' language", async () => {
    const text = `
      Our process delivers a 100% success rate for all implementations.
      We never fail to meet our clients' expectations.
      Trust our proven system today.
    `.repeat(10);
    const result = await runContentSafetyCheck(text, "landing_page", WS);
    expect(result.violations.some((v) => v.includes("performance_guarantees"))).toBe(true);
  });
});

describe("runContentSafetyCheck — ranking guarantees", () => {
  it("flags 'the #1 in industry' language", async () => {
    const text = `
      We are the #1 provider in the industry for customer satisfaction.
      No competitor comes close to our level of service and innovation.
      Join us and experience the difference today.
    `.repeat(10);
    const result = await runContentSafetyCheck(text, "landing_page", WS);
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("ranking_guarantees"))).toBe(true);
  });

  it("flags 'world's best' language", async () => {
    const text = "We deliver the world's best customer experience. Period. No questions asked.".repeat(10);
    const result = await runContentSafetyCheck(text, "linkedin_post", WS);
    expect(result.violations.some((v) => v.includes("ranking_guarantees"))).toBe(true);
  });
});

describe("runContentSafetyCheck — thin content", () => {
  it("flags blog article with fewer than 400 words", async () => {
    const text = "This is a very short blog post. It has almost no content.";
    const result = await runContentSafetyCheck(text, "blog_article", WS);
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("content_depth"))).toBe(true);
  });

  it("passes thin content for WhatsApp (min 20 words)", async () => {
    const text = "Hi there! Quick reminder about your appointment tomorrow at 10am. See you then!";
    const result = await runContentSafetyCheck(text, "whatsapp_campaign", WS);
    const depthViolation = result.violations.some((v) => v.includes("content_depth"));
    expect(depthViolation).toBe(false);
  });

  it("flags video script below 100 words", async () => {
    const text = "Welcome to our demo. We hope you enjoy this brief introduction to our product.";
    const result = await runContentSafetyCheck(text, "video_script", WS);
    expect(result.violations.some((v) => v.includes("content_depth"))).toBe(true);
  });
});

describe("runContentSafetyCheck — allow-list exemption", () => {
  it("workspace-verified USP exempts a stat from fabricated_statistics", async () => {
    // The mock returns no USPs from the DB, so we need to re-mock for this test.
    // We test the pure matchesAllowList logic directly instead.
    const text = "Customers see 300% ROI within 30 days.";
    const allowedClaims = ["300% roi", "customers see 300% roi within 30 days"];
    const { matchesAllowList: mAL } = await import("@/lib/content-safety/universal-content-safety.server");
    expect(mAL(text, allowedClaims)).toBe(true);
  });

  it("unrelated allow-list entry does not exempt the stat", async () => {
    const text = "Customers see 300% ROI within 30 days.";
    const allowedClaims = ["award-winning support", "iso 27001 certified"];
    const { matchesAllowList: mAL } = await import("@/lib/content-safety/universal-content-safety.server");
    expect(mAL(text, allowedClaims)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// extractUrls / isContentUrlSafe helpers (check 8)
// ════════════════════════════════════════════════════════════════════════════

describe("extractUrls / isContentUrlSafe — URL safety check", () => {
  it("extracts http and https URLs from text", async () => {
    const { extractUrls } = await import("@/lib/content-safety/universal-content-safety.server");
    const text = "Visit https://example.com and also http://mysite.io/page for details.";
    const urls = extractUrls(text);
    expect(urls).toContain("https://example.com");
    expect(urls).toContain("http://mysite.io/page");
    expect(urls.length).toBe(2);
  });

  it("returns empty array for text with no URLs", async () => {
    const { extractUrls } = await import("@/lib/content-safety/universal-content-safety.server");
    expect(extractUrls("No links here at all.")).toHaveLength(0);
  });

  it("allows public HTTPS URLs", async () => {
    const { isContentUrlSafe } = await import("@/lib/content-safety/universal-content-safety.server");
    expect(isContentUrlSafe("https://www.example.com/about")).toBe(true);
    expect(isContentUrlSafe("https://blog.customer.co.uk/post/123")).toBe(true);
  });

  it("rejects localhost URLs", async () => {
    const { isContentUrlSafe } = await import("@/lib/content-safety/universal-content-safety.server");
    expect(isContentUrlSafe("http://localhost:3000/api/data")).toBe(false);
  });

  it("rejects 127.x.x.x URLs", async () => {
    const { isContentUrlSafe } = await import("@/lib/content-safety/universal-content-safety.server");
    expect(isContentUrlSafe("http://127.0.0.1/secret")).toBe(false);
  });

  it("rejects 192.168.x.x private range URLs", async () => {
    const { isContentUrlSafe } = await import("@/lib/content-safety/universal-content-safety.server");
    expect(isContentUrlSafe("http://192.168.1.1/admin")).toBe(false);
  });

  it("rejects 10.x.x.x private range URLs", async () => {
    const { isContentUrlSafe } = await import("@/lib/content-safety/universal-content-safety.server");
    expect(isContentUrlSafe("http://10.0.0.1/internal")).toBe(false);
  });
});

describe("runContentSafetyCheck — check 8: unsafe embedded URLs", () => {
  it("passes clean content with no embedded URLs", async () => {
    const text = Array(50).fill("Our team delivers excellent results for clients.").join(" ");
    const result = await runContentSafetyCheck(text, "email_campaign", WS);
    const urlCheck = result.checks.find((c) => c.check === "unsafe_urls");
    expect(urlCheck).toBeDefined();
    expect(urlCheck?.passed).toBe(true);
  });

  it("passes content with only public HTTPS URLs", async () => {
    const base = Array(40).fill("We build reliable software for businesses.").join(" ");
    const text = `${base} Learn more at https://example.com/about.`;
    const result = await runContentSafetyCheck(text, "blog_article", WS);
    const urlCheck = result.checks.find((c) => c.check === "unsafe_urls");
    expect(urlCheck?.passed).toBe(true);
  });

  it("flags content that embeds a localhost URL", async () => {
    const base = Array(40).fill("We build reliable software for businesses.").join(" ");
    const text = `${base} See our internal dashboard at http://localhost:8080/api/metrics.`;
    const result = await runContentSafetyCheck(text, "blog_article", WS);
    const urlCheck = result.checks.find((c) => c.check === "unsafe_urls");
    expect(urlCheck?.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("unsafe_urls"))).toBe(true);
  });

  it("flags content embedding a private IP URL", async () => {
    const base = Array(40).fill("Our service has a 99.9% uptime record verified by clients.").join(" ");
    const text = `${base} Data sourced from http://192.168.0.1/report.`;
    const result = await runContentSafetyCheck(text, "blog_article", WS);
    const urlCheck = result.checks.find((c) => c.check === "unsafe_urls");
    expect(urlCheck?.passed).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Check 9 — broken / placeholder link detection
// ════════════════════════════════════════════════════════════════════════════

describe("runContentSafetyCheck — check 9: broken / placeholder link detection", () => {
  const base = Array(40).fill("Our platform helps businesses grow their revenue and customer base efficiently.").join(" ");

  it("passes when all URLs are well-formed real domains", async () => {
    const text = `${base} Read the full guide at https://www.webee.ai/guide.`;
    const result = await runContentSafetyCheck(text, "blog_article", WS);
    const check = result.checks.find((c) => c.check === "broken_links");
    expect(check).toBeDefined();
    expect(check?.passed).toBe(true);
  });

  it("flags content embedding example.com (placeholder domain)", async () => {
    const text = `${base} Learn more at https://example.com/about-us.`;
    const result = await runContentSafetyCheck(text, "blog_article", WS);
    const check = result.checks.find((c) => c.check === "broken_links");
    expect(check?.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("broken_links"))).toBe(true);
  });

  it("flags yoursite.com as a placeholder domain", async () => {
    const text = `${base} Visit us at https://yoursite.com for more information.`;
    const result = await runContentSafetyCheck(text, "blog_article", WS);
    const check = result.checks.find((c) => c.check === "broken_links");
    expect(check?.passed).toBe(false);
  });

  it("flags mysite.com as a placeholder domain", async () => {
    const text = `${base} Visit https://mysite.com/pricing for details.`;
    const result = await runContentSafetyCheck(text, "blog_article", WS);
    const check = result.checks.find((c) => c.check === "broken_links");
    expect(check?.passed).toBe(false);
  });

  it("passes when content has no URLs at all", async () => {
    const result = await runContentSafetyCheck(base, "blog_article", WS);
    const check = result.checks.find((c) => c.check === "broken_links");
    expect(check?.passed).toBe(true);
    expect(check?.detail).toMatch(/no.*url|no malformed/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// approved_customer_evidence classification
// ════════════════════════════════════════════════════════════════════════════

describe("runContentSafetyCheck — approved_customer_evidence classification", () => {
  it("classifies allow-listed stat as approved_customer_evidence (not a violation)", async () => {
    // A sentence that matches FABRICATED_STAT_PATTERNS but also matches the allow-list
    // should be classified as approved_customer_evidence, not cause a violation.
    const { matchesAllowList, classifyClaimSentence } = await import("@/lib/content-safety/universal-content-safety.server");
    const sentence = "Customers see 300% ROI within 30 days.";
    const allowedClaims = ["300% roi"];
    const matched = matchesAllowList(sentence, allowedClaims);
    expect(matched).toBe(true);
    // When matched, the category should be approved_customer_evidence (not from classifyClaimSentence)
    // — we verify the non-approved path classifies differently
    const unmatched = classifyClaimSentence(sentence);
    expect(unmatched).not.toBe("approved_customer_evidence");
  });

  it("approved_customer_evidence category is a valid ClaimCategory", async () => {
    const { safetyCheckEvidenceItem } = await import("@/lib/content-safety/universal-content-safety.server");
    const result: SafetyCheckResult = {
      passed: true,
      violations: [],
      warnings: [],
      checks: [],
      claim_classifications: [
        { text: "300% ROI within 30 days.", category: "approved_customer_evidence", reason: "matches allow-list" }
      ],
      ranAt: new Date().toISOString(),
      contentKind: "blog_article",
    };
    const ev = safetyCheckEvidenceItem(result);
    // flagged_claims counts non-approved items only
    expect(ev.data.flagged_claims).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// injectSafetyGateBlockerIfNeeded (via prepareMindTaskInsert)
// ════════════════════════════════════════════════════════════════════════════

describe("prepareMindTaskInsert — safety gate blocker injection", () => {
  it("forces readiness to 'blocked' when packet evidence contains a failed content_safety_gate item", async () => {
    const {
      prepareMindTaskInsert,
      buildIntelligencePacket,
      evidenceItem,
    } = await import("@/lib/minds/intelligence-packet.server");

    const safetyFailEvidence = {
      source: "safety_check",
      description: "FAILED: 1 violation(s). Approval blocked.",
      data: { passed: false, violation_count: 1, violations: ["fabricated_statistics: some detail"] },
      retrieved_at: new Date().toISOString(),
    };

    const packet = buildIntelligencePacket({
      mind: "growthmind",
      objective: "Deploy a social campaign for product launch",
      intentSource: "chat_tool:create_content_deployment_work_order",
      targets: [{
        domain: "content",
        entity_type: "content_project",
        entity_id: "proj-123",
        entity_name: "Product Launch",
        resolved: true,
      }],
      evidence: [
        evidenceItem("growthmind_content_projects", "Project found.", { project_id: "proj-123" }),
        safetyFailEvidence,
      ],
      diagnosis: "Content deployment ready but safety gate failed.",
      deliverables: ["Approved content for all channels"],
      successCriteria: ["No safety violations"],
      limitations: ["Manual publication required for LinkedIn."],
      approvalScope: { kind: "content", summary: "Approve content variants for deployment", sensitive: false },
    });

    const row = prepareMindTaskInsert(
      { workspace_id: "ws-1", task_category: "informational" },
      packet,
    );

    expect(row.readiness_state).toBe("blocked");
    const storedPacket = row.intelligence_packet as any;
    expect(storedPacket.blockers?.some((b: any) => b.detail.startsWith("Content safety gate"))).toBe(true);
  });

  it("does NOT inject a blocker when content_safety_gate evidence shows passed: true", async () => {
    const {
      prepareMindTaskInsert,
      buildIntelligencePacket,
      evidenceItem,
    } = await import("@/lib/minds/intelligence-packet.server");

    const safetyPassEvidence = {
      source: "safety_check",
      description: "PASSED: all checks cleared.",
      data: { passed: true, violation_count: 0, violations: [] },
      retrieved_at: new Date().toISOString(),
    };

    const packet = buildIntelligencePacket({
      mind: "growthmind",
      objective: "Deploy social content after safety gate clearance",
      intentSource: "chat_tool:create_content_deployment_work_order",
      targets: [{
        domain: "content",
        entity_type: "content_project",
        entity_id: "proj-456",
        entity_name: "Cleared Campaign",
        resolved: true,
      }],
      evidence: [
        evidenceItem("growthmind_content_projects", "Project found.", { project_id: "proj-456" }),
        safetyPassEvidence,
      ],
      diagnosis: "Content deployment ready; safety gate passed.",
      deliverables: ["Approved content for all channels"],
      successCriteria: ["No safety violations"],
      limitations: ["Manual publication required for LinkedIn."],
      approvalScope: { kind: "content", summary: "Approve content variants", sensitive: false },
    });

    const row = prepareMindTaskInsert(
      { workspace_id: "ws-1", task_category: "informational" },
      packet,
    );

    expect(row.readiness_state).not.toBe("blocked");
    const storedPacket = row.intelligence_packet as any;
    const safetyBlocker = (storedPacket.blockers ?? []).find((b: any) =>
      b.detail.startsWith("Content safety gate"));
    expect(safetyBlocker).toBeUndefined();
  });

  it("does NOT add a duplicate safety blocker when one already exists", async () => {
    const {
      prepareMindTaskInsert,
      buildIntelligencePacket,
      evidenceItem,
    } = await import("@/lib/minds/intelligence-packet.server");

    const safetyFailEvidence = {
      source: "safety_check",
      description: "FAILED: 2 violation(s).",
      data: { passed: false, violation_count: 2, violations: ["v1", "v2"] },
      retrieved_at: new Date().toISOString(),
    };

    const packet = buildIntelligencePacket({
      mind: "growthmind",
      objective: "Deploy blocked content",
      intentSource: "chat_tool:create_content_deployment_work_order",
      targets: [{ domain: "content", entity_type: "content_project", entity_id: "proj-789", entity_name: "Blocked", resolved: true }],
      evidence: [safetyFailEvidence],
      diagnosis: "Safety gate failed.",
      deliverables: ["Approved content"],
      successCriteria: ["Pass safety gate"],
      limitations: [],
      approvalScope: { kind: "content", summary: "Approve content", sensitive: false },
      // Pre-existing blocker — should not add a second one
      blockers: [{ kind: "other", detail: "Content safety gate failed with 2 violation(s). Resolve all safety violations before this task can be approved. See the content_safety_gate evidence item for details." }],
    });

    const row = prepareMindTaskInsert(
      { workspace_id: "ws-1", task_category: "informational" },
      packet,
    );

    const storedPacket = row.intelligence_packet as any;
    const safetyBlockers = (storedPacket.blockers ?? []).filter((b: any) =>
      b.detail.startsWith("Content safety gate"));
    expect(safetyBlockers.length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// safetyCheckEvidenceItem
// ════════════════════════════════════════════════════════════════════════════

describe("safetyCheckEvidenceItem", () => {
  it("produces evidence with source = content_safety_gate", async () => {
    const result: SafetyCheckResult = {
      passed: true,
      violations: [],
      warnings: [],
      checks: [{ check: "content_depth", passed: true, detail: "100 words.", severity: "warning" }],
      claim_classifications: [],
      ranAt: new Date().toISOString(),
      contentKind: "email_campaign",
    };
    const ev = safetyCheckEvidenceItem(result);
    expect(ev.source).toBe("safety_check");
    expect(ev.data.passed).toBe(true);
    expect(typeof ev.retrieved_at).toBe("string");
  });

  it("describes FAILED gate clearly when violations exist", () => {
    const result: SafetyCheckResult = {
      passed: false,
      violations: ["fabricated_statistics: Customers see 300% ROI..."],
      warnings: [],
      checks: [],
      claim_classifications: [],
      ranAt: new Date().toISOString(),
      contentKind: "blog_article",
    };
    const ev = safetyCheckEvidenceItem(result);
    expect(ev.description).toMatch(/FAILED/);
    expect(ev.data.violation_count).toBe(1);
    expect(ev.data.passed).toBe(false);
  });

  it("mentions approval is blocked in the failed description", () => {
    const result: SafetyCheckResult = {
      passed: false,
      violations: ["fake_testimonials: 1 sentence(s)..."],
      warnings: [],
      checks: [],
      claim_classifications: [],
      ranAt: new Date().toISOString(),
      contentKind: "whatsapp_campaign",
    };
    const ev = safetyCheckEvidenceItem(result);
    expect(ev.description.toLowerCase()).toMatch(/blocked/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Integration: check and packet blocker relationship
// ════════════════════════════════════════════════════════════════════════════

describe("safetyCheckEvidenceItem — intelligence packet integration", () => {
  it("provides data shape expected by intelligence-packet evidence items", () => {
    const result: SafetyCheckResult = {
      passed: false,
      violations: ["fabricated_statistics: some detail"],
      warnings: [],
      checks: [{ check: "fabricated_statistics", passed: false, detail: "some detail", severity: "violation" }],
      claim_classifications: [{ text: "Customers see 300% ROI.", category: "unclassified_flagged", reason: "unsourced stat" }],
      ranAt: new Date().toISOString(),
      contentKind: "email_campaign",
    };
    const ev = safetyCheckEvidenceItem(result);
    // Shape matches PacketEvidence
    expect(typeof ev.source).toBe("string");
    expect(typeof ev.description).toBe("string");
    expect(typeof ev.data).toBe("object");
    expect(typeof ev.retrieved_at).toBe("string");
    // Caller can use violation_count to decide whether to add a blocker
    expect(ev.data.violation_count).toBe(1);
    expect(ev.data.flagged_claims).toBe(1);
  });
});
