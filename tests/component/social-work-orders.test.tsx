/**
 * Task #489 — acceptance tests for the social/content/ads work-order cores
 * and the content-variant model.
 *
 * The cores run against a fake Supabase builder with the mode gate mocked;
 * the intelligence-packet builder/validator run for real so readiness states
 * are the genuine quality-gate outputs. The content-variant tests mock the
 * admin client so createContentVariants / transitions run for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/hivemind/mode-gate.server", () => ({
  assertProposalAllowed: vi.fn(async () => undefined),
}));

const adminHolder = vi.hoisted(() => ({ sb: null as any }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() { return adminHolder.sb; },
}));

import {
  createMetaCampaignWorkOrderCore,
  createTikTokWorkOrderCore,
  createLinkedInWorkOrderCore,
  createContentDeploymentWorkOrderCore,
  createGadsPacketWorkOrderCore,
  createSeoPacketWorkOrderCore,
} from "@/lib/hivemind/social-work-orders.server";
import {
  transitionVariantDeployment,
  approveContentVariant,
} from "@/lib/growthmind/content-variants.server";

const WS = "11111111-2222-3333-4444-555555555555";
const PROJECT = "22222222-3333-4444-5555-666666666666";

interface TableSpec {
  rows?: any[];
  error?: { message: string } | null;
}

/** Minimal chainable/thenable fake of the Supabase query builder. */
function makeSb(tables: Record<string, TableSpec>) {
  const inserted: Record<string, any[]> = {};
  const updated: Record<string, any[]> = {};
  let idSeq = 0;
  const from = (table: string) => {
    const spec = tables[table] ?? { rows: [] };
    const state: any = { op: "select" };
    const result = () =>
      spec.error
        ? { data: null, error: spec.error }
        : { data: spec.rows ?? [], error: null };
    const b: any = {
      select: (..._a: any[]) => b,
      eq: (..._a: any[]) => b,
      in: (..._a: any[]) => b,
      gte: (..._a: any[]) => b,
      not: (..._a: any[]) => b,
      order: (..._a: any[]) => b,
      limit: (..._a: any[]) => b,
      delete: () => { state.op = "delete"; return b; },
      insert: (row: any) => {
        state.op = "insert";
        state.row = { ...row, id: `${table}-${++idSeq}` };
        (inserted[table] ??= []).push(state.row);
        return b;
      },
      upsert: (row: any, _o?: any) => {
        state.op = "insert";
        state.row = { ...row, id: `${table}-${++idSeq}` };
        (inserted[table] ??= []).push(state.row);
        return b;
      },
      update: (patch: any) => {
        state.op = "update";
        const base = (spec.rows ?? [])[0] ?? {};
        state.row = { ...base, ...patch };
        (updated[table] ??= []).push(state.row);
        return b;
      },
      maybeSingle: async () => {
        if (state.op === "insert" || state.op === "update") {
          if (spec.error) return { data: null, error: spec.error };
          return { data: state.row, error: null };
        }
        const r = result();
        return { data: (r.data ?? [])[0] ?? null, error: r.error };
      },
      single: async () => {
        if (state.op === "insert" || state.op === "update") {
          if (spec.error) return { data: null, error: spec.error };
          return { data: state.row, error: null };
        }
        const r = result();
        return { data: (r.data ?? [])[0] ?? null, error: r.error };
      },
      then: (resolve: any, reject: any) => {
        if (state.op === "delete") return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        return Promise.resolve(result()).then(resolve, reject);
      },
    };
    return b;
  };
  return { sb: { from } as any, inserted, updated };
}

const baseTables = () => ({
  work_orders: { rows: [] },
  hivemind_tasks: { rows: [] },
  growthmind_social_connections: { rows: [] },
  growthmind_ads_accounts: { rows: [] },
  growthmind_publishing_jobs: { rows: [] },
});

beforeEach(() => { adminHolder.sb = null; });

// ── Meta campaign ─────────────────────────────────────────────────────────────
describe("Meta campaign core", () => {
  it("not connected + empty spec → integration_required, Launch HARD-BLOCKED on budget/creative/destination", async () => {
    const { sb, inserted } = makeSb(baseTables());
    const res = await createMetaCampaignWorkOrderCore(sb, WS, null, {});
    expect(res.connected).toBe(false);
    expect(inserted.work_orders![0].readiness_state).toBe("integration_required");
    expect(res.launchBlockers.join(" ")).toMatch(/budget is missing/i);
    expect(res.launchBlockers.join(" ")).toMatch(/creative is missing/i);
    expect(res.launchBlockers.join(" ")).toMatch(/destination url is missing/i);

    const stageKeys = res.tasks.map((t: any) => t.metadata.approval_stage);
    expect(stageKeys).toEqual(["accounts_assets", "audience_placement", "creative_destination", "budget_schedule", "launch"]);

    const launch = res.tasks[res.tasks.length - 1];
    expect(launch.metadata.final_send_stage).toBe(true);
    const blockers = launch.intelligence_packet.blockers as Array<{ kind: string; detail: string }>;
    expect(blockers.some((b) => b.kind === "integration_missing")).toBe(true);
    expect(blockers.some((b) => /budget is missing/i.test(b.detail))).toBe(true);
    expect(blockers.some((b) => /awaiting prior stage approvals/i.test(b.detail))).toBe(true);
    // Split launch modes recorded on the work order
    expect(inserted.work_orders![0].metadata.launch_modes.create_paused).toMatch(/create as paused/i);
  });

  it("connected + complete spec → ready_for_change_approval, no launch hard blockers", async () => {
    const t = baseTables();
    t.growthmind_social_connections = { rows: [
      { id: "c1", provider: "meta", account_type: "facebook_page", account_name: "Acme", username: null, status: "active", token_expires_at: null, permissions: [] },
    ] } as any;
    t.growthmind_ads_accounts = { rows: [{ id: "a1", platform: "meta", status: "active", account_name: "Acme Ads", external_account_id: "act_1" }] } as any;
    const { sb, inserted } = makeSb(t);
    const res = await createMetaCampaignWorkOrderCore(sb, WS, null, {
      spec: {
        objective: "leads",
        audienceDescription: "UK homeowners 30-60",
        placements: ["facebook_feed", "instagram_feed"],
        creative: { caption: "Get a free quote", mediaUrl: "https://x/img.jpg" },
        destinationUrl: "https://example.com/landing",
        conversionEvent: "Lead",
        pixelId: "px1",
        budget: { amount: 50, currency: "GBP", period: "daily" },
        schedule: { startAt: "2026-08-01" },
      },
    });
    expect(res.connected).toBe(true);
    expect(res.launchBlockers).toEqual([]);
    expect(inserted.work_orders![0].readiness_state).toBe("ready_for_change_approval");
  });
});

// ── TikTok ────────────────────────────────────────────────────────────────────
describe("TikTok core", () => {
  const fullProposal = {
    concept: "Behind the scenes", hook: "You won't believe this", script: "…",
    shotList: ["open on office"], caption: "BTS day!", cta: "Follow us",
    durationSeconds: 30, safeZonesChecked: true,
  };

  it("unverified audio → audioBlocked, publish stage carries the audio hard blocker", async () => {
    const { sb } = makeSb(baseTables());
    const res = await createTikTokWorkOrderCore(sb, WS, null, {
      proposal: { ...fullProposal, audioTitle: "Trending Song X", audioRightsStatus: "unverified" },
    });
    expect(res.audioBlocked).toBe(true);
    const publish = res.tasks[res.tasks.length - 1];
    const blockers = publish.intelligence_packet.blockers as Array<{ detail: string }>;
    expect(blockers.some((b) => /audio rights are unverified/i.test(b.detail))).toBe(true);
  });

  it("original audio + full spec → not audio-blocked, manual publication stated honestly", async () => {
    const { sb, inserted } = makeSb(baseTables());
    const res = await createTikTokWorkOrderCore(sb, WS, null, {
      proposal: { ...fullProposal, audioRightsStatus: "original_audio" },
    });
    expect(res.audioBlocked).toBe(false);
    expect(inserted.work_orders![0].readiness_state).toBe("ready_for_content_approval");
    const publish = res.tasks[res.tasks.length - 1];
    expect(publish.description).toMatch(/no TikTok publish API/i);
    expect(publish.description).toMatch(/manual/i);
  });

  it("TikTok ad without ads account → integration_required", async () => {
    const { sb, inserted } = makeSb(baseTables());
    const res = await createTikTokWorkOrderCore(sb, WS, null, {
      proposal: { ...fullProposal, isAd: true, audioRightsStatus: "original_audio", audienceDescription: "UK 18-35", optimisationGoal: "conversions", trackingSetup: "pixel", budget: { amount: 20, currency: "GBP", period: "daily" } },
    });
    expect(res.adsConnected).toBe(false);
    expect(inserted.work_orders![0].readiness_state).toBe("integration_required");
    const stageKeys = res.tasks.map((t: any) => t.metadata.approval_stage);
    expect(stageKeys).toContain("audience_budget");
  });
});

// ── LinkedIn ──────────────────────────────────────────────────────────────────
describe("LinkedIn core", () => {
  it("unresolved entity → target_resolution_required; final stage = manual publication package", async () => {
    const { sb, inserted } = makeSb(baseTables());
    const res = await createLinkedInWorkOrderCore(sb, WS, null, {
      proposal: { creative: { headline: "We are hiring", body: "Join us" } },
    });
    expect(inserted.work_orders![0].readiness_state).toBe("target_resolution_required");
    const finalTask = res.tasks[res.tasks.length - 1];
    expect(finalTask.title).toMatch(/awaiting linkedin manual publication/i);
    expect(finalTask.description).toMatch(/no API exists/i);
  });

  it("connected ad account derives Campaign Manager account — no permanent gap", async () => {
    const t = baseTables();
    t.growthmind_ads_accounts = { rows: [{ id: "l1", platform: "linkedin", status: "connected", account_name: "Acme CM", external_account_id: "cm_1" }] } as any;
    const { sb, inserted } = makeSb(t);
    const res = await createLinkedInWorkOrderCore(sb, WS, null, {
      proposal: {
        isAd: true, entityType: "organization", entityName: "Acme Ltd",
        creative: { headline: "H", body: "B" }, audienceFacets: ["UK", "IT decision makers"],
        budget: { amount: 30, currency: "GBP", period: "daily" },
      },
    });
    expect(res.adsConnected).toBe(true);
    expect(inserted.work_orders![0].readiness_state).toBe("ready_for_change_approval");
    const allBlockers = res.tasks.flatMap((tk: any) => tk.intelligence_packet.blockers ?? []);
    expect(allBlockers.some((b: any) => /campaign manager account/i.test(b.detail))).toBe(false);
  });

  it("resolved org entity → ready_for_change_approval", async () => {
    const { sb, inserted } = makeSb(baseTables());
    await createLinkedInWorkOrderCore(sb, WS, null, {
      proposal: { entityType: "organization", entityName: "Acme Ltd", creative: { headline: "H", body: "B" } },
    });
    expect(inserted.work_orders![0].readiness_state).toBe("ready_for_change_approval");
  });
});

// ── Content deployment (variants) ─────────────────────────────────────────────
describe("Content deployment core + variant model", () => {
  const project = {
    id: PROJECT, workspace_id: WS, title: "Summer promo", caption: "Master caption here",
    script: null, cta: "Book now", media_url: null, status: "approved", target_platform: "instagram", format: "image",
  };

  it("adapted variant approved per channel; identical copy blocked by adaptation gate", async () => {
    const adminTables = {
      growthmind_content_projects: { rows: [project] },
      growthmind_content_variants: { rows: [] },
    };
    const admin = makeSb(adminTables);
    adminHolder.sb = admin.sb;
    const { sb, inserted } = makeSb(baseTables());

    const res = await createContentDeploymentWorkOrderCore(sb, WS, null, {
      projectId: PROJECT,
      variants: [
        { channel: "ig_post", caption: "☀️ Summer promo is HERE — tap the link in bio. #summer" },
        // identical to master (title+caption+cta squashed)
        { channel: "linkedin_post", bodyCopy: "Summer promo\nMaster caption here\nBook now" },
      ],
    });
    const ig = res.variants.find((v: any) => v.channel === "ig_post");
    const li = res.variants.find((v: any) => v.channel === "linkedin_post");
    expect(ig.adaptationOk).toBe(true);
    expect(ig.deploymentState).toBe("awaiting_channel_approval");
    expect(ig.deploymentPath).toBe("api");
    expect(li.adaptationOk).toBe(false);
    expect(li.deploymentState).toBe("draft");
    expect(li.deploymentPath).toBe("manual");

    // Variant rows written server-side (admin client), with blockers on the failed one
    const rows = admin.inserted.growthmind_content_variants!;
    expect(rows).toHaveLength(2);
    expect(rows[1].blockers[0].detail).toMatch(/identical to the master/i);

    // One approval task per channel + final publish stage
    expect(res.tasks).toHaveLength(3);
    expect(res.tasks[0].title).toMatch(/instagram post/i);
    expect(res.tasks[1].title).toMatch(/blocked: adaptation required/i);
    expect(res.tasks[2].metadata.final_send_stage).toBe(true);
    expect(inserted.work_orders![0].readiness_state).toBe("ready_for_content_approval");

    // Variant rows are linked back to the proposing work order after insert
    const linkUpdates = admin.updated.growthmind_content_variants ?? [];
    expect(linkUpdates.length).toBeGreaterThan(0);
    expect(linkUpdates[0].work_order_id).toBe(inserted.work_orders![0].id);
  });

  it("published claim requires provider record (api) or live URL (manual)", async () => {
    const apiVariant = {
      id: "v1", workspace_id: WS, channel: "ig_post", deployment_state: "publishing",
      deployment_path: "api", external_post_id: null, live_url: null, provider_record: null,
      publishing_job_id: null, verification_note: null,
    };
    adminHolder.sb = makeSb({ growthmind_content_variants: { rows: [apiVariant] } }).sb;
    await expect(transitionVariantDeployment(WS, "v1", "published", {}))
      .rejects.toThrow(/no verified provider record/i);

    const manualVariant = { ...apiVariant, id: "v2", channel: "linkedin_post", deployment_state: "awaiting_manual_publication", deployment_path: "manual" };
    adminHolder.sb = makeSb({ growthmind_content_variants: { rows: [manualVariant] } }).sb;
    await expect(transitionVariantDeployment(WS, "v2", "published", {}))
      .rejects.toThrow(/live URL/i);

    // A persisted external_post_id on the row satisfies the publish gate without resending it
    adminHolder.sb = makeSb({ growthmind_content_variants: { rows: [{ ...apiVariant, external_post_id: "ig_123" }] } }).sb;
    const published = await transitionVariantDeployment(WS, "v1", "published", {});
    expect(published.deployment_state).toBe("published");
    expect(published.external_post_id).toBe("ig_123");

    // Invalid transition rejected by the state machine
    adminHolder.sb = makeSb({ growthmind_content_variants: { rows: [{ ...apiVariant, deployment_state: "draft" }] } }).sb;
    await expect(transitionVariantDeployment(WS, "v1", "published", { externalPostId: "x" }))
      .rejects.toThrow(/invalid deployment transition/i);
  });

  it("approve is per-variant and only from awaiting_channel_approval", async () => {
    const v = {
      id: "v1", workspace_id: WS, channel: "ig_post", deployment_state: "approved",
      headline: null, body_copy: null, caption: "c", cta: null, hook: null, script: null, media_url: null,
    };
    adminHolder.sb = makeSb({ growthmind_content_variants: { rows: [v] } }).sb;
    await expect(approveContentVariant(WS, "v1", null))
      .rejects.toThrow(/only awaiting_channel_approval/i);
  });
});

// ── Google Ads packet ─────────────────────────────────────────────────────────
describe("Google Ads packet core", () => {
  it("not connected → integration_required with honest blocker", async () => {
    const t = { ...baseTables(), growthmind_gads_campaign_daily: { rows: [] }, growthmind_gads_recommendations: { rows: [] }, growthmind_gads_change_requests: { rows: [] } };
    const { sb, inserted } = makeSb(t);
    const res = await createGadsPacketWorkOrderCore(sb, WS, null, {});
    expect(res.connected).toBe(false);
    expect(inserted.work_orders![0].readiness_state).toBe("integration_required");
  });

  it("connected → real spend aggregation and change-request wrapping stated", async () => {
    const t = {
      ...baseTables(),
      growthmind_ads_accounts: { rows: [{ id: "g1", platform: "google", status: "connected", account_name: "Acme GAds", external_account_id: "123" }] },
      growthmind_gads_campaign_daily: { rows: [
        { campaign_id: "c1", campaign_name: "Brand", date: "2026-07-20", cost_micros: 12_500_000, clicks: 40, impressions: 900, conversions: 3 },
        { campaign_id: "c1", campaign_name: "Brand", date: "2026-07-21", cost_micros: 7_500_000, clicks: 22, impressions: 500, conversions: 1 },
      ] },
      growthmind_gads_recommendations: { rows: [{ id: "r1", title: "Raise budget", status: "pending", kind: "budget", created_at: "2026-07-20" }] },
      growthmind_gads_change_requests: { rows: [] },
    };
    const { sb, inserted } = makeSb(t);
    const res = await createGadsPacketWorkOrderCore(sb, WS, null, {});
    expect(res.connected).toBe(true);
    expect(inserted.work_orders![0].readiness_state).toBe("ready_for_analysis_approval");
    const analysis = res.tasks[0];
    expect(analysis.title).toMatch(/spend 20/); // 12.5 + 7.5
    expect(res.tasks[1].description).toMatch(/own approval/i);
  });
});

// ── SEO packet ────────────────────────────────────────────────────────────────
describe("SEO packet core", () => {
  it("no GSC site → integration_required; connected → analysis approval with existing-flow wrapping", async () => {
    const empty = { ...baseTables(), growthmind_seo_sites: { rows: [] }, growthmind_seo_campaigns: { rows: [] } };
    const a = makeSb(empty);
    const res1 = await createSeoPacketWorkOrderCore(a.sb, WS, null, {});
    expect(res1.gscConnected).toBe(false);
    expect(a.inserted.work_orders![0].readiness_state).toBe("integration_required");

    const connected = {
      ...baseTables(),
      growthmind_seo_sites: { rows: [{ id: "s1", site_url: "https://example.com", status: "connected", keywords: ["roofing"], updated_at: "2026-07-01" }] },
      growthmind_seo_campaigns: { rows: [{ id: "sc1", name: "Roofing blog", status: "drafting", proposed_title: "T", created_at: "2026-07-01" }] },
    };
    const b = makeSb(connected);
    const res2 = await createSeoPacketWorkOrderCore(b.sb, WS, null, {});
    expect(res2.gscConnected).toBe(true);
    expect(b.inserted.work_orders![0].readiness_state).toBe("ready_for_analysis_approval");
    expect(res2.tasks[1].description).toMatch(/existing SEO campaign flow/i);
  });
});
