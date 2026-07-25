// ── HiveMind interface parity test ────────────────────────────────────────────
// Guards the Phase-2 unification contract: the floating orb mini-chat and the
// full Assistant page must stay on ONE orchestration stack — same AI server
// function, same conversation store (mind_conversations via useMindConversation),
// and same shared voice profile module. If either surface drifts back to a
// bespoke store/profile, these assertions fail.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const orbSrc  = readFileSync(path.join(root, "src/components/hivemind/HiveMindOrb.tsx"), "utf8");
const chatSrc = readFileSync(path.join(root, "src/routes/_authenticated/hivemind.chat.tsx"), "utf8");
const seoLib  = readFileSync(path.join(root, "src/lib/growthmind/growthmind.seo.ts"), "utf8");
const seoUi   = readFileSync(path.join(root, "src/components/growthmind/GrowthMindSEO.tsx"), "utf8");

describe("HiveMind orb ↔ Assistant page parity", () => {
  it("both surfaces use the same AI orchestration server function", () => {
    for (const src of [orbSrc, chatSrc]) {
      expect(src).toContain('from "@/lib/hivemind/hivemind.ai"');
      expect(src).toContain("getHiveMindAIResponse");
      expect(src).toContain("getHiveMindTTS");
    }
  });

  it("both surfaces share the mind_conversations store", () => {
    for (const src of [orbSrc, chatSrc]) {
      expect(src).toContain('from "@/hooks/useMindConversation"');
      expect(src).toContain('useMindConversation("hivemind")');
    }
  });

  it("both surfaces share the voice profile module (no duplicate localStorage readers)", () => {
    for (const src of [orbSrc, chatSrc]) {
      expect(src).toContain("@/lib/hivemind/voice-profile");
      expect(src).not.toContain('localStorage.getItem("hivemind-voice-settings")');
    }
  });

  it("orb surfaces work-order proposals from the shared orchestration response", () => {
    expect(orbSrc).toContain("workOrderProposals");
    expect(chatSrc).toContain("workOrderProposals");
  });
});

describe("GSC OAuth canonical server callback", () => {
  it("auth URL is built with the canonical server callback, not a page URL", () => {
    expect(seoLib).toContain('GSC_CALLBACK_PATH = "/api/oauth/gsc-callback"');
    expect(seoLib).toContain("${data.origin}${GSC_CALLBACK_PATH}");
    expect(seoLib).toContain("isAllowedOAuthOrigin");
    // The old client-chosen redirectUri input must be gone.
    expect(seoLib).not.toContain("redirectUri: z.string().url()");
  });

  it("SEO page no longer builds its own redirect URI or exchanges codes client-side", () => {
    expect(seoUi).not.toContain("connectGscToken");
    expect(seoUi).not.toContain("/growthmind/seo`;");
    expect(seoUi).toContain('params.get("gsc")');
  });

  it("callback route exists and verifies HMAC state", () => {
    const cb = readFileSync(path.join(root, "src/routes/api/oauth/gsc-callback.ts"), "utf8");
    expect(cb).toContain('createFileRoute("/api/oauth/gsc-callback")');
    expect(cb).toContain("verifyGscState");
    expect(cb).toContain("isAllowedOAuthOrigin");
    expect(cb).toContain("exchangeAndStoreGscCode");
  });
});
