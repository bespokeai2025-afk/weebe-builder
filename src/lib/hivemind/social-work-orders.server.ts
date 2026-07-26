/**
 * Social, content & ads work orders — Task #489.
 *
 * Six proposal cores (Meta campaign, TikTok content/ads, LinkedIn, Content
 * Studio cross-channel deployment, Google Ads packet, SEO packet) that turn a
 * chat instruction into an evidence-backed work order with SPLIT, SCOPED
 * approval-stage tasks through the universal intelligence-packet quality gate
 * — reusing the Task #488 foundation (channel-work-orders.server.ts).
 *
 * Honesty rules enforced here:
 *  - Evidence comes from REAL workspace rows/services — never invented.
 *  - Missing provider connection → integration_missing blocker on every stage
 *    (readiness "integration_required"), never a fake ready state.
 *  - Meta: missing budget / creative / destination are HARD blockers carried
 *    on the Launch stage — it can never be approved while they exist. The
 *    Launch approval is split: "Approve and Create as Paused" vs "Approve and
 *    Launch" (launch_modes in the packet + task metadata).
 *  - TikTok: copyrighted/unverified audio hard-blocks Publish. There is no
 *    TikTok publish API in WEBEE — the final stage says so honestly.
 *  - LinkedIn: no publish API in WEBEE — the deliverable is a deployment
 *    package in "Awaiting LinkedIn Manual Publication" state.
 *  - Content deployment: variants must be ADAPTED copy (adaptation gate);
 *    nothing is ever claimed live without a verified provider record.
 *  - Google Ads / SEO: packets WRAP the existing change-request /
 *    seo_campaign_approval mechanics — approvals still flow through those
 *    systems; nothing here executes or weakens them.
 *  - No stage task carries an action_kind — proposals only.
 *  - WBAH is excluded from every core.
 */

import {
  approvalStagesForSocialKind,
  checkMetaCampaignSpec,
  checkTikTokProposal,
  checkLinkedInProposal,
  LAUNCH_MODE_LABELS,
  VARIANT_CHANNEL_RULES,
  deploymentPathForChannel,
  type ContentVariantChannel,
  type MetaCampaignSpecInput,
  type TikTokProposalInput,
  type LinkedInProposalInput,
  type SocialApprovalStage,
} from "@/lib/minds/social-packets.shared";
import type {
  PacketEvidence,
  PacketTarget,
  UniversalMindIntelligencePacket,
} from "@/lib/minds/intelligence-packet.shared";

type Sb = any;

type Blocker = { kind: "integration_missing" | "provider_error" | "other"; detail: string };

async function guards(sb: Sb, workspaceId: string): Promise<void> {
  const { assertNotWbahWorkspace } = await import("@/lib/wbah-exclusion.shared");
  assertNotWbahWorkspace(workspaceId);
  const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
  await assertProposalAllowed(sb, workspaceId);
}

async function foundation() {
  const wo = await import("@/lib/hivemind/channel-work-orders.server");
  const ip = await import("@/lib/minds/intelligence-packet.server");
  return {
    insertWorkOrderWithStageTasks: wo.insertWorkOrderWithStageTasks,
    stagePacket: wo.stagePacket,
    buildIntelligencePacket: ip.buildIntelligencePacket,
    evidenceItem: ip.evidenceItem,
  };
}

// ── Shared evidence loaders (real rows only) ─────────────────────────────────

async function loadMetaConnections(sb: Sb, workspaceId: string) {
  const { data, error } = await sb.from("growthmind_social_connections")
    .select("id, provider, account_type, account_name, username, status, token_expires_at, permissions")
    .eq("workspace_id", workspaceId)
    .limit(20);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const active = rows.filter((r) => r.status === "active");
  const now = Date.now();
  const expired = active.filter((r) => r.token_expires_at && Date.parse(r.token_expires_at) < now);
  return { rows, active, expired };
}

async function loadAdsAccounts(sb: Sb, workspaceId: string, platform?: string) {
  let q = sb.from("growthmind_ads_accounts")
    .select("id, platform, status, account_name, external_account_id")
    .eq("workspace_id", workspaceId);
  if (platform) q = q.eq("platform", platform);
  const { data, error } = await q.limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as any[];
}

async function loadRecentPublishingFingerprints(sb: Sb, workspaceId: string) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await sb.from("growthmind_publishing_jobs")
    .select("id, status, content_fingerprint, external_post_id, published_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .gte("published_at", since)
    .limit(50);
  if (error) return { rows: [] as any[], note: `Publishing history unavailable (${error.message}).` };
  return { rows: (data ?? []) as any[], note: null as string | null };
}

// ── 1. Meta (Facebook/Instagram) campaign ────────────────────────────────────
export interface MetaCampaignWorkOrderOptions {
  spec?: MetaCampaignSpecInput;
  objective?: string | null;
  instruction?: string | null;
  source?: string;
}

export async function createMetaCampaignWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: MetaCampaignWorkOrderOptions = {},
): Promise<{ workOrder: any; tasks: any[]; connected: boolean; launchBlockers: string[] }> {
  await guards(sb, workspaceId);
  const f = await foundation();

  const spec: MetaCampaignSpecInput = opts.spec ?? {};
  const conns = await loadMetaConnections(sb, workspaceId);
  const metaConns = conns.active.filter((c) => (c.provider ?? "meta") === "meta");
  const adsAccounts = await loadAdsAccounts(sb, workspaceId, "meta");
  const activeAds = adsAccounts.filter((a) => a.status === "active" || a.status === "connected");
  const fingerprints = await loadRecentPublishingFingerprints(sb, workspaceId);
  const connected = metaConns.length > 0;

  const specCheck = checkMetaCampaignSpec({
    ...spec,
    pageId: spec.pageId ?? metaConns.find((c) => c.account_type === "facebook_page")?.id ?? null,
    igAccountId: spec.igAccountId ?? metaConns.find((c) => c.account_type === "instagram_business")?.id ?? null,
    adAccountId: spec.adAccountId ?? activeAds[0]?.external_account_id ?? null,
  });

  const integrationBlockers: Blocker[] = [];
  if (!connected) {
    integrationBlockers.push({
      kind: "integration_missing",
      detail: "No active Meta connection (Facebook Page / Instagram) — connect Meta in GrowthMind → Social Connections first.",
    });
  }
  if (conns.expired.length) {
    integrationBlockers.push({
      kind: "provider_error",
      detail: `${conns.expired.length} Meta connection token(s) expired — reconnect before launch.`,
    });
  }
  // HARD launch blockers: budget/creative/destination gaps make Launch unapprovable.
  const launchHardBlockers: Blocker[] = specCheck.launchBlockers.map((d) => ({ kind: "other", detail: d }));

  const stages = approvalStagesForSocialKind("meta");
  const targets: PacketTarget[] = [{
    domain: "marketing",
    entity_type: "meta_campaign",
    entity_id: null,
    entity_name: spec.objective ? `Meta campaign — ${spec.objective}` : "Proposed Meta campaign",
    resolved: connected,
    resolution_note: connected
      ? `${metaConns.length} active Meta connection(s); ${activeAds.length} Meta ad account(s) on record.`
      : "No active Meta connection — assets cannot be resolved.",
  }];
  const evidence: PacketEvidence[] = [
    f.evidenceItem("growthmind_social_connections",
      connected
        ? `${metaConns.length} active Meta connection(s): ${metaConns.map((c) => `${c.account_type} "${c.account_name ?? c.username ?? "unnamed"}"`).join(", ")}${conns.expired.length ? `; ${conns.expired.length} expired token(s)` : ""}.`
        : "No active Meta connections in this workspace.",
      { active: metaConns.length, expired: conns.expired.length }),
    f.evidenceItem("growthmind_ads_accounts",
      activeAds.length
        ? `${activeAds.length} Meta ad account(s): ${activeAds.map((a) => a.account_name ?? a.external_account_id).join(", ")}.`
        : "No Meta ad account connected — paid delivery cannot be verified.",
      { accounts: activeAds.map((a) => ({ id: a.id, name: a.account_name, status: a.status })) }),
    f.evidenceItem("growthmind_publishing_jobs",
      fingerprints.note ?? `${fingerprints.rows.length} verified Meta post(s) published in the last 7 days (duplicate-content fingerprints enforced at publish time).`,
      { recent_published: fingerprints.rows.length }),
    f.evidenceItem("campaign_spec",
      specCheck.complete
        ? "Campaign spec is complete (objective, assets, audience, placements, creative, destination, budget, schedule)."
        : `Spec gaps — missing: ${[...specCheck.missing, ...specCheck.launchBlockers].join("; ") || "none"}.`,
      { missing: specCheck.missing, launch_blockers: specCheck.launchBlockers }),
  ];
  const diagnosis =
    (connected
      ? `Meta is connected (${metaConns.length} asset(s), ${activeAds.length} ad account(s)).`
      : "Meta is NOT connected — every stage is in Integration Required state.") +
    (specCheck.launchBlockers.length
      ? ` Launch is HARD-BLOCKED: ${specCheck.launchBlockers.join(" ")}`
      : specCheck.missing.length
        ? ` Spec gaps to resolve before launch: ${specCheck.missing.join(", ")}.`
        : " Spec is complete.");

  const objective = opts.objective?.trim() ||
    "Propose a Meta (Facebook/Instagram) campaign with split approvals for accounts & assets, audience & placement, creative & destination, budget & schedule, and a blocked Launch stage.";
  const intentSource = opts.source === "hivemind_tool" ? "chat_tool:create_meta_campaign_work_order" : "manual:meta_campaign_work_order";
  const limitations = [
    "PROPOSAL ONLY — WEBEE does not create or launch Meta campaigns from this work order; approvals authorise humans/existing flows.",
    "Nothing is ever claimed live without a verified provider record (external post/campaign id).",
    "The Launch approval is split: 'Approve and Create as Paused' (safe default) vs 'Approve and Launch'.",
    "Duplicate-content protection (7-day fingerprints) applies at publish time.",
  ];

  const mk = (stage: SocialApprovalStage, summary: string, planSteps: Array<{ title: string }>, extraBlockers: Blocker[] = []) =>
    f.stagePacket({
      buildIntelligencePacket: f.buildIntelligencePacket,
      mind: "growthmind",
      objective, intentSource, instruction: opts.instruction,
      stage: stage as any, allStages: stages as any,
      targets, evidence, diagnosis, planSteps,
      deliverables: [`${stage.label} approval for the Meta campaign`],
      successCriteria: [
        "Every approval names exactly what it authorises",
        "Launch never happens without budget, creative and destination verified",
      ],
      limitations,
      approvalSummary: summary,
      integrationBlockers: [...integrationBlockers, ...extraBlockers],
    });

  const budgetLine = spec.budget?.amount != null
    ? `${spec.budget.amount} ${spec.budget.currency ?? ""} ${spec.budget.period ?? ""}`.trim()
    : "NOT SET";

  const result = await f.insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
    title: "Meta campaign proposal",
    objective,
    source: opts.source ?? "hivemind_chat",
    metadata: {
      channel_kind: "meta_campaign",
      launch_modes: LAUNCH_MODE_LABELS,
      launch_hard_blockers: specCheck.launchBlockers,
    },
    packet: mk(stages[0], "Approve the Meta accounts & assets used by this campaign.", [{ title: "Confirm page/IG/ad account/pixel assets" }]),
    readiness: connected ? "ready_for_change_approval" : "integration_required",
    triggerType: "meta_campaign",
    stageTasks: [
      {
        stage: stages[0] as any,
        title: `Approve Accounts & Assets: ${metaConns.length} connection(s), ${activeAds.length} ad account(s)`,
        description: connected
          ? `Assets on record: ${metaConns.map((c) => `${c.account_type} "${c.account_name ?? c.username ?? "unnamed"}"`).join(", ")}.`
          : "No active Meta connection — connect Meta before this stage can be approved.",
        packet: mk(stages[0], `Approve Accounts & Assets: ${metaConns.length} Meta connection(s), ${activeAds.length} ad account(s).`, [{ title: "Confirm the assets" }]),
      },
      {
        stage: stages[1] as any,
        title: "Approve Audience & Placement",
        description: spec.audienceDescription
          ? `Audience: ${spec.audienceDescription}. Placements: ${spec.placements?.join(", ") ?? "not specified"}.`
          : "Audience definition missing — must be specified before approval.",
        packet: mk(stages[1], `Approve Audience & Placement: ${spec.audienceDescription ?? "audience NOT yet defined"}.`, [{ title: "Confirm targeting and placements" }]),
      },
      {
        stage: stages[2] as any,
        title: "Approve Creative & Destination",
        description: (spec.creative?.caption || spec.creative?.mediaUrl)
          ? `Creative: ${spec.creative?.format ?? "format unspecified"}${spec.creative?.mediaUrl ? " with media" : " (copy only)"}. Destination: ${spec.destinationUrl ?? "MISSING"}.`
          : "Creative missing — nothing exists to approve yet.",
        packet: mk(stages[2], `Approve Creative & Destination (destination: ${spec.destinationUrl ?? "MISSING"}).`, [{ title: "Review creative and landing destination" }]),
      },
      {
        stage: stages[3] as any,
        title: `Approve Budget & Schedule: ${budgetLine}`,
        description: `Budget ${budgetLine}; schedule ${spec.schedule?.startAt ?? "start NOT set"}${spec.schedule?.endAt ? ` → ${spec.schedule.endAt}` : ""}.`,
        packet: mk(stages[3], `Approve Budget & Schedule: budget ${budgetLine}.`, [{ title: "Confirm spend and flight dates" }]),
      },
      {
        stage: stages[4] as any,
        title: specCheck.launchBlockers.length
          ? "Launch (HARD-BLOCKED: budget/creative/destination incomplete)"
          : "Launch approval (blocked until prior approvals)",
        description:
          `Final authorisation, split into two modes: "${LAUNCH_MODE_LABELS.create_paused}" (campaign created PAUSED for manual review in Ads Manager) or "${LAUNCH_MODE_LABELS.launch_live}". ` +
          (specCheck.launchBlockers.length
            ? `CANNOT be approved while these exist: ${specCheck.launchBlockers.join(" ")}`
            : "Blocked until Accounts, Audience, Creative and Budget stages are approved."),
        packet: mk(stages[4],
          `Authorise the Meta campaign (choose "${LAUNCH_MODE_LABELS.create_paused}" or "${LAUNCH_MODE_LABELS.launch_live}"). Requires all prior approvals${specCheck.launchBlockers.length ? " AND resolution of the hard blockers" : ""}.`,
          [{ title: "Choose launch mode and authorise" }],
          launchHardBlockers),
      },
    ],
  });
  return { ...result, connected, launchBlockers: specCheck.launchBlockers };
}

// ── 2. TikTok (organic content or ads) ───────────────────────────────────────
export interface TikTokWorkOrderOptions {
  proposal?: TikTokProposalInput;
  objective?: string | null;
  instruction?: string | null;
  source?: string;
}

export async function createTikTokWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: TikTokWorkOrderOptions = {},
): Promise<{ workOrder: any; tasks: any[]; audioBlocked: boolean; adsConnected: boolean }> {
  await guards(sb, workspaceId);
  const f = await foundation();

  const p: TikTokProposalInput = opts.proposal ?? {};
  const isAd = p.isAd === true;
  const check = checkTikTokProposal(p);
  const adsAccounts = await loadAdsAccounts(sb, workspaceId, "tiktok");
  const activeAds = adsAccounts.filter((a) => a.status === "active" || a.status === "connected");
  const adsConnected = activeAds.length > 0;

  const audioBlockers: Blocker[] = check.publishBlockers
    .filter((b) => /audio/i.test(b))
    .map((d) => ({ kind: "other", detail: d }));
  const budgetBlockers: Blocker[] = check.publishBlockers
    .filter((b) => !/audio/i.test(b))
    .map((d) => ({ kind: "other", detail: d }));
  const integrationBlockers: Blocker[] = [];
  if (isAd && !adsConnected) {
    integrationBlockers.push({
      kind: "integration_missing",
      detail: "No TikTok ads account connected — connect TikTok Ads before this campaign can be approved.",
    });
  }

  const stages = approvalStagesForSocialKind(isAd ? "tiktok_ads" : "tiktok_organic");
  const targets: PacketTarget[] = [{
    domain: "marketing",
    entity_type: isAd ? "tiktok_ad_campaign" : "tiktok_content",
    entity_id: null,
    entity_name: p.concept ? `TikTok — ${p.concept}` : "Proposed TikTok content",
    resolved: true,
    resolution_note: isAd
      ? `${activeAds.length} TikTok ads account(s) on record.`
      : "Organic TikTok content proposal (no publish API — manual publication).",
  }];
  const evidence: PacketEvidence[] = [
    f.evidenceItem("tiktok_proposal",
      check.complete
        ? "Full production spec present: concept, hook, script, shot list, caption, CTA, duration, safe zones."
        : `Proposal gaps: ${[...check.missing, ...check.publishBlockers].join("; ")}.`,
      { missing: check.missing, publish_blockers: check.publishBlockers }),
    f.evidenceItem("audio_rights",
      p.audioRightsStatus === "verified_rights" || p.audioRightsStatus === "original_audio"
        ? `Audio "${p.audioTitle ?? "original"}" — rights status: ${p.audioRightsStatus}.`
        : `Audio rights NOT verified (status: ${p.audioRightsStatus ?? "unverified"}) — publication is blocked until rights are verified or original audio is used.`,
      { audio_title: p.audioTitle ?? null, rights_status: p.audioRightsStatus ?? "unverified" }),
    ...(isAd ? [f.evidenceItem("growthmind_ads_accounts",
      adsConnected
        ? `${activeAds.length} TikTok ads account(s): ${activeAds.map((a) => a.account_name ?? a.external_account_id).join(", ")}.`
        : "No TikTok ads account connected.",
      { accounts: activeAds.length })] : []),
  ];
  const diagnosis =
    (check.complete ? "TikTok proposal is production-complete." : `Proposal has gaps: ${[...check.missing, ...check.publishBlockers].join("; ")}.`) +
    " WEBEE has no TikTok publish API — publication is manual and only recorded as live with a real TikTok post reference.";

  const objective = opts.objective?.trim() ||
    (isAd
      ? "Propose a TikTok ad with full production spec, verified audio rights, audience/budget approval and a blocked Launch stage."
      : "Propose TikTok organic content with full production spec, verified audio rights and a blocked Publish stage.");
  const intentSource = opts.source === "hivemind_tool" ? "chat_tool:create_tiktok_work_order" : "manual:tiktok_work_order";
  const limitations = [
    "NO copyrighted audio without verified rights — this is a hard block, not a warning.",
    "WEBEE has no TikTok publish API: publication is manual; nothing is claimed live without a real TikTok post reference.",
    "PROPOSAL ONLY — approvals authorise humans; nothing auto-publishes.",
  ];

  const mk = (stage: SocialApprovalStage, summary: string, planSteps: Array<{ title: string }>, extraBlockers: Blocker[] = []) =>
    f.stagePacket({
      buildIntelligencePacket: f.buildIntelligencePacket,
      mind: "growthmind",
      objective, intentSource, instruction: opts.instruction,
      stage: stage as any, allStages: stages as any,
      targets, evidence, diagnosis, planSteps,
      deliverables: [`${stage.label} approval for the TikTok ${isAd ? "ad" : "content"}`],
      successCriteria: ["Audio rights verified before any publish approval", "Publication only recorded with a real TikTok post reference"],
      limitations,
      approvalSummary: summary,
      integrationBlockers: [...integrationBlockers, ...extraBlockers],
    });

  const stageTasks: any[] = [
    {
      stage: stages[0] as any,
      title: `Approve Concept & Script${p.concept ? `: ${p.concept.slice(0, 80)}` : ""}`,
      description: check.missing.length
        ? `Production spec gaps: ${check.missing.join(", ")} — complete before approval.`
        : `Hook: ${p.hook}. Duration ${p.durationSeconds}s. ${p.shotList?.length ?? 0} shot(s). Safe zones checked.`,
      packet: mk(stages[0], `Approve the TikTok concept, hook, script, shot list, caption and CTA.`, [{ title: "Review the production spec" }]),
    },
    {
      stage: stages[1] as any,
      title: audioBlockers.length ? "Audio Rights (BLOCKED: rights not verified)" : `Approve Audio Rights: ${p.audioTitle ?? "original audio"}`,
      description: audioBlockers.length
        ? audioBlockers.map((b) => b.detail).join(" ")
        : `Audio "${p.audioTitle ?? "original"}" rights status: ${p.audioRightsStatus}.`,
      packet: mk(stages[1], `Approve the audio choice (rights status: ${p.audioRightsStatus ?? "unverified"}).`, [{ title: "Verify audio rights" }], audioBlockers),
    },
  ];
  if (isAd) {
    stageTasks.push({
      stage: stages[2] as any,
      title: "Approve Audience & Budget",
      description: `Audience: ${p.audienceDescription ?? "NOT defined"}. Budget: ${p.budget?.amount != null ? `${p.budget.amount} ${p.budget.currency ?? ""} ${p.budget.period ?? ""}` : "NOT SET"}. Goal: ${p.optimisationGoal ?? "not set"}.`,
      packet: mk(stages[2], `Approve TikTok ad audience & budget.`, [{ title: "Confirm targeting, goal, tracking and spend" }], budgetBlockers),
    });
  }
  const finalStage = stages[stages.length - 1];
  stageTasks.push({
    stage: finalStage as any,
    title: `${finalStage.label} approval (blocked until prior approvals${audioBlockers.length ? " + audio rights" : ""})`,
    description:
      "Final authorisation. WEBEE has no TikTok publish API — approval authorises MANUAL publication; the work is only marked live once a real TikTok post reference is recorded." +
      (audioBlockers.length ? " HARD-BLOCKED until audio rights are verified." : ""),
    packet: mk(finalStage, `Authorise ${isAd ? "launching the TikTok ad" : "publishing the TikTok content"} (manual publication — recorded live only with a real post reference).`, [{ title: "Publish manually and record the post reference" }], [...audioBlockers, ...budgetBlockers]),
  });

  const result = await f.insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
    title: isAd ? "TikTok ad proposal" : "TikTok content proposal",
    objective,
    source: opts.source ?? "hivemind_chat",
    metadata: { channel_kind: isAd ? "tiktok_ads" : "tiktok_organic", audio_rights_status: p.audioRightsStatus ?? "unverified" },
    packet: stageTasks[0].packet,
    readiness: (isAd && !adsConnected) ? "integration_required" : audioBlockers.length ? "blocked" : "ready_for_content_approval",
    triggerType: isAd ? "tiktok_ad_campaign" : "tiktok_content",
    stageTasks,
  });
  return { ...result, audioBlocked: audioBlockers.length > 0, adsConnected };
}

// ── 3. LinkedIn (organic or ads) ─────────────────────────────────────────────
export interface LinkedInWorkOrderOptions {
  proposal?: LinkedInProposalInput;
  objective?: string | null;
  instruction?: string | null;
  source?: string;
}

export async function createLinkedInWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: LinkedInWorkOrderOptions = {},
): Promise<{ workOrder: any; tasks: any[]; adsConnected: boolean }> {
  await guards(sb, workspaceId);
  const f = await foundation();

  const p0: LinkedInProposalInput = opts.proposal ?? {};
  const isAd = p0.isAd === true;
  const adsAccounts = await loadAdsAccounts(sb, workspaceId, "linkedin");
  const activeAds = adsAccounts.filter((a) => a.status === "active" || a.status === "connected");
  const adsConnected = activeAds.length > 0;
  // If the caller didn't name a Campaign Manager account, derive it from the
  // connected LinkedIn ads account — a connected ad proposal must not carry a
  // permanent "Campaign Manager account" gap.
  const p: LinkedInProposalInput = {
    ...p0,
    campaignManagerAccount:
      p0.campaignManagerAccount ??
      (isAd ? (activeAds[0]?.account_name ?? activeAds[0]?.external_account_id ?? null) : null),
  };
  const check = checkLinkedInProposal(p);

  const integrationBlockers: Blocker[] = [];
  if (isAd && !adsConnected) {
    integrationBlockers.push({
      kind: "integration_missing",
      detail: "No LinkedIn Campaign Manager account connected — connect LinkedIn Ads before this campaign can be approved.",
    });
  }
  const launchBlockers: Blocker[] = check.launchBlockers.map((d) => ({ kind: "other", detail: d }));

  const stages = approvalStagesForSocialKind(isAd ? "linkedin_ads" : "linkedin_organic");
  const targets: PacketTarget[] = [{
    domain: "marketing",
    entity_type: isAd ? "linkedin_ad_campaign" : "linkedin_content",
    entity_id: null,
    entity_name: p.entityName ? `LinkedIn ${p.entityType ?? "entity"} "${p.entityName}"` : "LinkedIn entity (unresolved)",
    resolved: !!(p.entityType && p.entityName),
    resolution_note: p.entityName
      ? `Publishing as ${p.entityType}: ${p.entityName}.`
      : "Organisation vs personal profile not yet resolved — required before creative approval.",
  }];
  const evidence: PacketEvidence[] = [
    f.evidenceItem("linkedin_proposal",
      check.complete ? "LinkedIn proposal complete." : `Gaps: ${[...check.missing, ...check.launchBlockers].join("; ")}.`,
      { missing: check.missing, launch_blockers: check.launchBlockers }),
    ...(isAd ? [f.evidenceItem("growthmind_ads_accounts",
      adsConnected
        ? `${activeAds.length} LinkedIn ads account(s): ${activeAds.map((a) => a.account_name ?? a.external_account_id).join(", ")}.`
        : "No LinkedIn ads account connected.",
      { accounts: activeAds.length })] : []),
    f.evidenceItem("platform_capability",
      "WEBEE has no LinkedIn publish API — the deliverable is a deployment package handed over in 'Awaiting LinkedIn Manual Publication' state.",
      { api_publish: false }),
  ];
  const diagnosis =
    (check.complete ? "Proposal is complete." : `Proposal gaps: ${[...check.missing, ...check.launchBlockers].join("; ")}.`) +
    " No LinkedIn publish API exists in WEBEE — final output is a manual-publication deployment package.";

  const objective = opts.objective?.trim() ||
    (isAd
      ? "Propose a LinkedIn ad campaign (entity, audience facets, creative & lead-gen, budget) delivered as a manual-publication deployment package."
      : "Propose LinkedIn content (entity resolution + creative) delivered as a manual-publication deployment package.");
  const intentSource = opts.source === "hivemind_tool" ? "chat_tool:create_linkedin_work_order" : "manual:linkedin_work_order";
  const limitations = [
    "WEBEE cannot publish to LinkedIn — the final deliverable is a deployment package in 'Awaiting LinkedIn Manual Publication' state.",
    "Nothing is claimed live without a real LinkedIn post/campaign reference recorded after manual publication.",
    "PROPOSAL ONLY — no automatic posting or spend.",
  ];

  const mk = (stage: SocialApprovalStage, summary: string, planSteps: Array<{ title: string }>, extraBlockers: Blocker[] = []) =>
    f.stagePacket({
      buildIntelligencePacket: f.buildIntelligencePacket,
      mind: "growthmind",
      objective, intentSource, instruction: opts.instruction,
      stage: stage as any, allStages: stages as any,
      targets, evidence, diagnosis, planSteps,
      deliverables: [`${stage.label} approval`, "Deployment package — Awaiting LinkedIn Manual Publication"],
      successCriteria: ["Entity (organisation vs profile) resolved before creative approval", "Only a real LinkedIn reference marks the work live"],
      limitations,
      approvalSummary: summary,
      integrationBlockers: [...integrationBlockers, ...extraBlockers],
    });

  const stageTasks: any[] = [{
    stage: stages[0] as any,
    title: p.entityName ? `Approve Entity: ${p.entityType} "${p.entityName}"` : "Resolve & approve the LinkedIn entity",
    description: p.entityName
      ? `Publishing as ${p.entityType}: ${p.entityName}.`
      : "Choose organisation page vs personal profile — required before any creative approval.",
    packet: mk(stages[0], `Approve the LinkedIn entity (${p.entityType ?? "unresolved"}${p.entityName ? ` "${p.entityName}"` : ""}).`, [{ title: "Confirm the publishing entity" }]),
  }];
  if (isAd) {
    stageTasks.push(
      {
        stage: stages[1] as any,
        title: "Approve Audience",
        description: p.audienceFacets?.length ? `Facets: ${p.audienceFacets.join(", ")}.` : "Audience facets NOT defined.",
        packet: mk(stages[1], `Approve LinkedIn audience facets (${p.audienceFacets?.join(", ") ?? "not defined"}).`, [{ title: "Confirm targeting facets" }]),
      },
      {
        stage: stages[2] as any,
        title: "Approve Creative & Lead-Gen",
        description: `${p.creative?.headline ? `Headline: ${p.creative.headline}. ` : "Creative missing. "}${p.leadGenForm?.name ? `Lead-gen form "${p.leadGenForm.name}" (${p.leadGenForm.fields?.join(", ") ?? "fields unset"}).` : "No lead-gen form."}`,
        packet: mk(stages[2], "Approve the LinkedIn ad creative and lead-gen form.", [{ title: "Review creative and form fields" }]),
      },
      {
        stage: stages[3] as any,
        title: `Approve Budget & Schedule: ${p.budget?.amount != null ? `${p.budget.amount} ${p.budget.currency ?? ""} ${p.budget.period ?? ""}` : "NOT SET"}`,
        description: check.launchBlockers.length ? check.launchBlockers.join(" ") : "Budget and flight dates for the campaign.",
        packet: mk(stages[3], "Approve LinkedIn budget & schedule.", [{ title: "Confirm spend" }], launchBlockers),
      },
    );
  } else {
    stageTasks.push({
      stage: stages[1] as any,
      title: "Approve Creative",
      description: p.creative?.headline || p.creative?.body ? `${p.creative?.headline ?? ""} ${p.creative?.body?.slice(0, 120) ?? ""}`.trim() : "Creative missing.",
      packet: mk(stages[1], "Approve the LinkedIn post creative.", [{ title: "Review the post copy" }]),
    });
  }
  const finalStage = stages[stages.length - 1];
  stageTasks.push({
    stage: finalStage as any,
    title: `${finalStage.label} — deployment package (Awaiting LinkedIn Manual Publication)`,
    description:
      "Final authorisation produces a deployment package for MANUAL publication on LinkedIn (no API exists). " +
      "The work order stays in 'Awaiting LinkedIn Manual Publication' until a real LinkedIn reference is recorded.",
    packet: mk(finalStage, "Authorise handover of the LinkedIn deployment package for manual publication.", [{ title: "Hand over the package and record the LinkedIn reference after manual publication" }], launchBlockers),
  });

  const result = await f.insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
    title: isAd ? "LinkedIn ad proposal (manual publication)" : "LinkedIn content proposal (manual publication)",
    objective,
    source: opts.source ?? "hivemind_chat",
    metadata: { channel_kind: isAd ? "linkedin_ads" : "linkedin_organic", manual_publication: true },
    packet: stageTasks[0].packet,
    readiness: (isAd && !adsConnected) ? "integration_required"
      : (p.entityType && p.entityName) ? "ready_for_change_approval" : "target_resolution_required",
    triggerType: isAd ? "linkedin_ad_campaign" : "linkedin_content",
    stageTasks,
  });
  return { ...result, adsConnected };
}

// ── 4. Content Studio cross-channel deployment ───────────────────────────────
export interface ContentDeploymentWorkOrderOptions {
  projectId: string;
  variants: Array<{
    channel: ContentVariantChannel;
    headline?: string | null;
    bodyCopy?: string | null;
    caption?: string | null;
    cta?: string | null;
    hook?: string | null;
    script?: string | null;
  }>;
  objective?: string | null;
  instruction?: string | null;
  source?: string;
}

export async function createContentDeploymentWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: ContentDeploymentWorkOrderOptions,
): Promise<{ workOrder: any; tasks: any[]; variants: any[] }> {
  await guards(sb, workspaceId);
  const f = await foundation();
  const { createContentVariants } = await import("@/lib/growthmind/content-variants.server");

  if (!opts.variants?.length) throw new Error("At least one channel variant is required.");
  const { project, variants } = await createContentVariants(workspaceId, opts.projectId, opts.variants);
  const adapted = variants.filter((v) => v.adaptationOk);
  const failed = variants.filter((v) => !v.adaptationOk);

  // ── Universal content safety gate on all adapted variant text ──────────────
  // Fail-closed: gate errors are treated as blocking violations so adapted
  // copy is never silently cleared when the gate itself fails to run.
  let variantSafetyPassed = false;
  let variantSafetyViolations: string[] = [
    "gate_error: Content safety gate could not run — variants blocked until gate succeeds.",
  ];
  let variantSafetyEvidenceItem: PacketEvidence | null = null;
  try {
    const safetyMod = await import(/* @vite-ignore */ "@/lib/content-safety/universal-content-safety.server");
    // Concatenate all adapted variant copy into a single pass so one evidence
    // item covers the whole deployment package.
    const combinedText = adapted
      .map((v: any) => [v.title, v.adaptedBody ?? v.body ?? ""].filter(Boolean).join(" "))
      .join("\n\n");
    if (combinedText.trim().length > 0) {
      const safetyResult = await safetyMod.runContentSafetyCheck(
        combinedText,
        "social_post",
        workspaceId,
      );
      variantSafetyPassed      = safetyResult.passed;
      variantSafetyViolations  = safetyResult.violations;
      variantSafetyEvidenceItem = safetyMod.safetyCheckEvidenceItem(safetyResult);
    } else {
      // No adapted text to check — gate passes vacuously.
      variantSafetyPassed     = true;
      variantSafetyViolations = [];
    }
  } catch (e: any) {
    console.error("[content-safety] content-deployment gate error (fail-closed):", e?.message ?? String(e));
  }

  const targets: PacketTarget[] = [{
    domain: "content",
    entity_type: "content_project",
    entity_id: project.id,
    entity_name: project.title ?? "Content project",
    resolved: true,
    resolution_note: `Project "${project.title}" (${project.status}) fanned out to ${variants.length} channel variant(s).`,
  }];
  const evidence: PacketEvidence[] = [
    f.evidenceItem("growthmind_content_projects",
      `Master project "${project.title}" (status: ${project.status}, original platform: ${project.target_platform ?? "unset"}).`,
      { project_id: project.id, status: project.status }),
    f.evidenceItem("growthmind_content_variants",
      `${adapted.length} of ${variants.length} variant(s) passed the adaptation gate` +
      (failed.length ? `; ${failed.length} kept in draft: ${failed.map((v) => `${v.channel} (${v.problems.join("; ")})`).join(" | ")}` : "") + ".",
      {
        variants: variants.map((v) => ({
          channel: v.channel, state: v.deploymentState, path: v.deploymentPath, problems: v.problems,
        })),
      }),
    // Safety gate evidence — prepareMindTaskInsert will auto-inject a blocker
    // into the packet when passed === false, driving readiness to "blocked".
    ...(variantSafetyEvidenceItem
      ? [variantSafetyEvidenceItem]
      : [f.evidenceItem(
          "content_safety_gate",
          variantSafetyPassed
            ? "Content safety gate: all adapted variant text passed."
            : `Content safety gate: ${variantSafetyViolations.length} violation(s) — variants blocked.`,
          { passed: variantSafetyPassed, violation_count: variantSafetyViolations.length, violations: variantSafetyViolations.slice(0, 5) },
        )]),
  ];
  const apiChannels = variants.filter((v) => v.deploymentPath === "api").map((v) => v.channel);
  const manualChannels = variants.filter((v) => v.deploymentPath === "manual").map((v) => v.channel);
  const diagnosis =
    `${variants.length} channel variant(s) created for project "${project.title}"; ${adapted.length} adapted and awaiting per-channel approval` +
    (failed.length ? `, ${failed.length} blocked on adaptation (identical/over-length copy)` : "") +
    `. API publish available for: ${apiChannels.join(", ") || "none"}; manual publication required for: ${manualChannels.join(", ") || "none"}.`;

  const objective = opts.objective?.trim() ||
    `Deploy content project "${project.title}" across ${variants.length} channel(s) with per-channel adapted copy and independent approvals.`;
  const intentSource = opts.source === "hivemind_tool" ? "chat_tool:create_content_deployment_work_order" : "manual:content_deployment_work_order";
  const limitations = [
    "Each channel variant is approved independently — approving one never authorises another.",
    "Variants must be genuinely adapted copy; identical copy is blocked by the adaptation gate.",
    "Only Meta-family channels have an API publish path; all others are 'awaiting manual publication' — nothing is claimed live without a verified provider record or live URL.",
  ];
  const stages = approvalStagesForSocialKind("content_deployment");

  const mkStage = (stage: SocialApprovalStage, summary: string, planSteps: Array<{ title: string }>, extraBlockers: Blocker[] = []) =>
    f.stagePacket({
      buildIntelligencePacket: f.buildIntelligencePacket,
      mind: "growthmind",
      objective, intentSource, instruction: opts.instruction,
      stage: stage as any, allStages: stages as any,
      targets, evidence, diagnosis, planSteps,
      deliverables: variants.map((v) => `${VARIANT_CHANNEL_RULES[v.channel].label} variant (${deploymentPathForChannel(v.channel) === "api" ? "API publish" : "manual publication"})`),
      successCriteria: ["Every published claim is backed by a provider record or live URL", "No identical copy ships to any channel"],
      limitations,
      approvalSummary: summary,
      integrationBlockers: extraBlockers,
    });

  const stageTasks: any[] = [
    // One approval task per channel variant (all map to the Variant Plan stage,
    // distinguished by metadata channel) + the blocked final Publish stage.
    ...variants.map((v) => ({
      stage: { ...stages[0], key: `variant_${v.channel}`, label: `${VARIANT_CHANNEL_RULES[v.channel].label} Variant` } as any,
      title: v.adaptationOk
        ? `Approve ${VARIANT_CHANNEL_RULES[v.channel].label} variant`
        : `${VARIANT_CHANNEL_RULES[v.channel].label} variant (BLOCKED: adaptation required)`,
      description: v.adaptationOk
        ? `Adapted ${VARIANT_CHANNEL_RULES[v.channel].label} copy (${VARIANT_CHANNEL_RULES[v.channel].format}). Approving this channel does not approve any other channel.`
        : `Adaptation gate failed: ${v.problems.join(" ")}`,
      packet: mkStage(
        { ...stages[0], key: `variant_${v.channel}`, label: `${VARIANT_CHANNEL_RULES[v.channel].label} Variant` },
        `Approve the ${VARIANT_CHANNEL_RULES[v.channel].label} variant only.`,
        [{ title: `Review the adapted ${v.channel} copy` }],
        v.adaptationOk ? [] : v.problems.map((d) => ({ kind: "other" as const, detail: d }))),
    })),
    {
      stage: stages[1] as any,
      title: "Publish approval (blocked until every channel variant is approved)",
      description:
        `Final authorisation. API channels (${apiChannels.join(", ") || "none"}) publish via the existing verified pipeline; ` +
        `manual channels (${manualChannels.join(", ") || "none"}) move to Awaiting Manual Publication.`,
      packet: mkStage(stages[1],
        "Authorise deployment of the approved variants (API where available, manual packages elsewhere).",
        [{ title: "Deploy approved variants and verify provider records / live URLs" }]),
    },
  ];

  const result = await f.insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
    title: `Content deployment: "${project.title}" → ${variants.length} channel(s)`,
    objective,
    source: opts.source ?? "hivemind_chat",
    metadata: {
      channel_kind: "content_deployment",
      project_id: project.id,
      channels: variants.map((v) => v.channel),
      variant_ids: variants.map((v) => v.id),
    },
    packet: stageTasks[0].packet,
    readiness: failed.length === variants.length ? "blocked" : "ready_for_content_approval",
    triggerType: "content_deployment",
    stageTasks,
  });
  // Link the variant rows back to the proposing work order for auditability.
  if (result.workOrder?.id) {
    const { linkVariantsToWorkOrder } = await import("@/lib/growthmind/content-variants.server");
    await linkVariantsToWorkOrder(workspaceId, variants.map((v) => v.id), result.workOrder.id);
  }
  return { ...result, variants };
}

// ── 5. Google Ads intelligence packet (wraps existing change-request flow) ───
export interface GadsPacketWorkOrderOptions {
  objective?: string | null;
  instruction?: string | null;
  source?: string;
}

export async function createGadsPacketWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: GadsPacketWorkOrderOptions = {},
): Promise<{ workOrder: any; tasks: any[]; connected: boolean }> {
  await guards(sb, workspaceId);
  const f = await foundation();

  const accounts = await loadAdsAccounts(sb, workspaceId, "google");
  const active = accounts.filter((a) => a.status === "active" || a.status === "connected");
  const connected = active.length > 0;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: daily }, { data: recs }, { data: crs }] = await Promise.all([
    sb.from("growthmind_gads_campaign_daily")
      .select("campaign_id, campaign_name, date, cost_micros, clicks, impressions, conversions")
      .eq("workspace_id", workspaceId).gte("date", since).limit(1000),
    sb.from("growthmind_gads_recommendations")
      .select("id, title, status, kind, created_at").eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }).limit(50),
    sb.from("growthmind_gads_change_requests")
      .select("id, status, created_at").eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }).limit(50),
  ]);
  const rows = (daily ?? []) as any[];
  const campaigns = new Map<string, { name: string; cost: number; clicks: number; impressions: number; conversions: number }>();
  for (const r of rows) {
    const c = campaigns.get(r.campaign_id) ?? { name: r.campaign_name, cost: 0, clicks: 0, impressions: 0, conversions: 0 };
    c.cost += (r.cost_micros ?? 0) / 1_000_000;
    c.clicks += r.clicks ?? 0;
    c.impressions += r.impressions ?? 0;
    c.conversions += r.conversions ?? 0;
    campaigns.set(r.campaign_id, c);
  }
  const totalSpend = Math.round(Array.from(campaigns.values()).reduce((s, c) => s + c.cost, 0) * 100) / 100;
  const pendingRecs = ((recs ?? []) as any[]).filter((r) => r.status === "pending" || r.status === "proposed");
  const pendingCrs = ((crs ?? []) as any[]).filter((r) => r.status === "pending");

  const integrationBlockers: Blocker[] = connected ? [] : [{
    kind: "integration_missing",
    detail: "No Google Ads account connected — connect Google Ads before performance analysis can run.",
  }];

  const stages = approvalStagesForSocialKind("gads");
  const targets: PacketTarget[] = [{
    domain: "marketing",
    entity_type: "gads_account",
    entity_id: active[0]?.id ?? null,
    entity_name: active[0]?.account_name ?? "Google Ads account",
    resolved: connected,
    resolution_note: connected
      ? `${active.length} connected Google Ads account(s); ${campaigns.size} campaign(s) with data in the last 30 days.`
      : "No connected Google Ads account.",
  }];
  const evidence: PacketEvidence[] = [
    f.evidenceItem("growthmind_gads_campaign_daily",
      `${campaigns.size} campaign(s), ${rows.length} daily row(s) in the last 30 days; total spend ${totalSpend}.`,
      {
        campaigns: Array.from(campaigns.entries()).slice(0, 20).map(([id, c]) => ({
          id, name: c.name, cost: Math.round(c.cost * 100) / 100, clicks: c.clicks, impressions: c.impressions, conversions: c.conversions,
        })),
      }),
    f.evidenceItem("growthmind_gads_recommendations",
      `${(recs ?? []).length} recommendation(s) on record, ${pendingRecs.length} pending.`,
      { pending: pendingRecs.map((r: any) => ({ id: r.id, title: r.title, kind: r.kind })) }),
    f.evidenceItem("growthmind_gads_change_requests",
      `${(crs ?? []).length} change request(s) on record, ${pendingCrs.length} pending approval — all execution flows through this existing mechanism.`,
      { pending_count: pendingCrs.length }),
  ];
  const diagnosis = connected
    ? `Google Ads: ${campaigns.size} campaign(s), spend ${totalSpend} over 30 days, ${pendingRecs.length} pending recommendation(s), ${pendingCrs.length} pending change request(s). Every change still requires its own change-request approval.`
    : "Google Ads is not connected — analysis cannot run until an account is connected.";

  const objective = opts.objective?.trim() ||
    "Google Ads performance review: real 30-day campaign data with proposed optimisations routed through the existing change-request approvals.";
  const intentSource = opts.source === "hivemind_tool" ? "chat_tool:create_gads_packet_work_order" : "manual:gads_packet_work_order";
  const limitations = [
    "All Google Ads changes execute ONLY through the existing change-request approval flow — this packet never bypasses or weakens it.",
    "Analysis uses synced data (last 30 days); no spend or bid changes happen from this approval.",
  ];

  const mk = (stage: SocialApprovalStage, summary: string, planSteps: Array<{ title: string }>) =>
    f.stagePacket({
      buildIntelligencePacket: f.buildIntelligencePacket,
      mind: "growthmind",
      objective, intentSource, instruction: opts.instruction,
      stage: stage as any, allStages: stages as any,
      targets, evidence, diagnosis, planSteps,
      deliverables: ["30-day performance snapshot from real synced data", "Optimisations proposed as change requests (existing approval flow)"],
      successCriteria: ["Every proposed change lands as a change request with its own approval", "No change executes from this work order directly"],
      limitations,
      approvalSummary: summary,
      integrationBlockers,
    });

  const result = await f.insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
    title: "Google Ads performance review",
    objective,
    source: opts.source ?? "hivemind_chat",
    metadata: { channel_kind: "gads_packet", pending_change_requests: pendingCrs.length },
    packet: mk(stages[0], `Approve the Google Ads analysis: ${campaigns.size} campaign(s), spend ${totalSpend} over 30 days.`, [{ title: "Review the performance snapshot" }]),
    readiness: connected ? "ready_for_analysis_approval" : "integration_required",
    triggerType: "gads_packet_review",
    stageTasks: [
      {
        stage: stages[0] as any,
        title: `Approve Google Ads analysis: ${campaigns.size} campaign(s), spend ${totalSpend} (30d)`,
        description: diagnosis,
        packet: mk(stages[0], `Approve the analysis only — no campaign changes.`, [{ title: "Review campaigns, spend and pending recommendations" }]),
      },
      {
        stage: stages[1] as any,
        title: "Change requests (blocked — each executes via its own existing approval)",
        description:
          `${pendingRecs.length} pending recommendation(s) would become individual change requests in the existing growthmind_gads_change_requests flow. ` +
          "Each change request keeps its own approval — this stage never batch-executes.",
        packet: mk(stages[1], "Acknowledge that proposed optimisations become individual change requests, each with its own approval.", [{ title: "Route accepted recommendations into change requests" }]),
      },
    ],
  });
  return { ...result, connected };
}

// ── 6. SEO intelligence packet (wraps existing seo_campaign_approval flow) ───
export interface SeoPacketWorkOrderOptions {
  objective?: string | null;
  instruction?: string | null;
  source?: string;
}

export async function createSeoPacketWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: SeoPacketWorkOrderOptions = {},
): Promise<{ workOrder: any; tasks: any[]; gscConnected: boolean }> {
  await guards(sb, workspaceId);
  const f = await foundation();

  const [{ data: sites }, { data: campaigns }] = await Promise.all([
    sb.from("growthmind_seo_sites").select("id, site_url, status, keywords, updated_at")
      .eq("workspace_id", workspaceId).limit(10),
    sb.from("growthmind_seo_campaigns").select("id, name, status, proposed_title, created_at")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50),
  ]);
  const siteRows = (sites ?? []) as any[];
  const campaignRows = (campaigns ?? []) as any[];
  const gscConnected = siteRows.length > 0;
  const activeCampaigns = campaignRows.filter((c) => !["cancelled", "failed", "completed"].includes(c.status));

  const integrationBlockers: Blocker[] = gscConnected ? [] : [{
    kind: "integration_missing",
    detail: "No Google Search Console site connected — connect GSC before SEO analysis can use real search data.",
  }];

  const stages = approvalStagesForSocialKind("seo");
  const targets: PacketTarget[] = [{
    domain: "marketing",
    entity_type: "seo_site",
    entity_id: siteRows[0]?.id ?? null,
    entity_name: siteRows[0]?.site_url ?? "SEO site",
    resolved: gscConnected,
    resolution_note: gscConnected
      ? `${siteRows.length} GSC site(s) connected; ${activeCampaigns.length} active SEO campaign(s).`
      : "No GSC site connected.",
  }];
  const evidence: PacketEvidence[] = [
    f.evidenceItem("growthmind_seo_sites",
      gscConnected
        ? `${siteRows.length} GSC site(s): ${siteRows.map((s) => s.site_url).join(", ")}.`
        : "No GSC sites connected.",
      { sites: siteRows.map((s) => ({ id: s.id, url: s.site_url, status: s.status })) }),
    f.evidenceItem("growthmind_seo_campaigns",
      `${campaignRows.length} SEO campaign(s) on record, ${activeCampaigns.length} active — all stage approvals (strategy → brief → content → deployment) flow through the existing seo_campaign_approval mechanism.`,
      { active: activeCampaigns.map((c) => ({ id: c.id, name: c.name, status: c.status })) }),
  ];
  const diagnosis = gscConnected
    ? `SEO: ${siteRows.length} GSC site(s), ${activeCampaigns.length} active campaign(s). New campaigns keep the existing multi-stage approvals (strategy, brief, content, deployment) — this packet wraps, never replaces them.`
    : "GSC is not connected — SEO analysis cannot use real search performance data until it is.";

  const objective = opts.objective?.trim() ||
    "SEO review: real GSC/site evidence with any new blog campaign routed through the existing multi-stage seo_campaign_approval flow.";
  const intentSource = opts.source === "hivemind_tool" ? "chat_tool:create_seo_packet_work_order" : "manual:seo_packet_work_order";
  const limitations = [
    "All SEO campaign stages (strategy, brief, content, deployment) keep their existing individual approvals — nothing here bypasses them.",
    "Deployment remains manual-only where no verified publish integration exists.",
  ];

  const mk = (stage: SocialApprovalStage, summary: string, planSteps: Array<{ title: string }>) =>
    f.stagePacket({
      buildIntelligencePacket: f.buildIntelligencePacket,
      mind: "growthmind",
      objective, intentSource, instruction: opts.instruction,
      stage: stage as any, allStages: stages as any,
      targets, evidence, diagnosis, planSteps,
      deliverables: ["SEO evidence snapshot (GSC sites, active campaigns)", "Any new campaign created via the existing seo_campaign_approval stages"],
      successCriteria: ["Every campaign stage keeps its own approval", "No content publishes without the existing safety gate and deployment approvals"],
      limitations,
      approvalSummary: summary,
      integrationBlockers,
    });

  const result = await f.insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
    title: "SEO review",
    objective,
    source: opts.source ?? "hivemind_chat",
    metadata: { channel_kind: "seo_packet", active_campaigns: activeCampaigns.length },
    packet: mk(stages[0], `Approve the SEO strategy review: ${siteRows.length} site(s), ${activeCampaigns.length} active campaign(s).`, [{ title: "Review SEO evidence" }]),
    readiness: gscConnected ? "ready_for_analysis_approval" : "integration_required",
    triggerType: "seo_packet_review",
    stageTasks: [
      {
        stage: stages[0] as any,
        title: `Approve SEO strategy review: ${siteRows.length} site(s), ${activeCampaigns.length} active campaign(s)`,
        description: diagnosis,
        packet: mk(stages[0], "Approve the strategy review only — no content is written or published.", [{ title: "Review sites, campaigns and search evidence" }]),
      },
      {
        stage: stages[3] as any,
        title: "Deployment (blocked — flows through existing SEO campaign approvals)",
        description:
          "Brief, content and deployment approvals happen inside the existing SEO campaign flow (seo_campaign_approval actions), each with its own approval and the SEO safety gate. This stage never publishes directly.",
        packet: mk(stages[3], "Acknowledge deployment routes through the existing SEO campaign stage approvals.", [{ title: "Progress campaigns through their own stage approvals" }]),
      },
    ],
  });
  return { ...result, gscConnected };
}
