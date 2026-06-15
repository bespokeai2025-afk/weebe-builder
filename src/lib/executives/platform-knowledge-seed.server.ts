// ── Platform Default Knowledge Seeding (SERVER ONLY) ─────────────────────────
// Generates and indexes the 7 standard WEBEE platform documents into the global
// platform_default KBs (workspace_id = NULL).
//
// Idempotent: each document has a stable global seed_key with the unique index
// exec_docs_platform_seed_key_idx. Re-runs skip already-indexed docs.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { indexTextDocument } from "@/lib/executives/executive-document-processing.server";

// ── Platform document definitions ────────────────────────────────────────────

const PLATFORM_DOCS: {
  seedKey:  string;
  title:    string;
  kbSlug:   string;      // platform KB slug this doc belongs to
  prompt:   string;      // prompt to generate the document content
}[] = [
  {
    seedKey: "platform:webee-overview",
    title:   "WEBEE Platform Overview",
    kbSlug:  "platform_shared",
    prompt: `Write a comprehensive platform overview for WEBEE (also spelled Webee), an AI voice-agent builder and multi-executive intelligence platform.

Cover:
- What WEBEE is and who it's for (SMBs, agencies, enterprises)
- Core products: Voice Agent Builder (OmniVoice), GrowthMind (AI CMO), HiveMind (AI COO), SystemMind (AI CTO)
- Key capabilities: no-code voice agent creation, multi-channel outreach (voice, WhatsApp, SMS), CRM integration, business intelligence
- The three AI executives and what they do
- Platform philosophy: replace 3-5 specialist hires with always-on AI executives
- Integration ecosystem: telephony, WhatsApp, email, CRM, analytics

Format: 600–900 words, markdown headings, practical and direct.`,
  },
  {
    seedKey: "platform:webee-selling-points",
    title:   "WEBEE Selling Points & Value Propositions",
    kbSlug:  "platform_shared",
    prompt: `Write a high-signal reference document covering WEBEE's core selling points and value propositions for sales, marketing and executive context.

Cover:
- Primary value proposition: always-on AI executives at a fraction of human hire cost
- Voice agent capabilities: build, deploy and manage AI call agents in minutes
- GrowthMind: automated marketing intelligence, content creation, campaign management
- HiveMind: real-time business oversight, task management, operational intelligence
- SystemMind: technical monitoring, reliability management, infrastructure oversight
- ROI and efficiency gains: response time, lead follow-up, 24/7 availability
- Key differentiators vs competitors: ease of use, multi-executive AI, no-code voice agents
- Common objections and rebuttals
- Ideal customer profile: businesses with inbound/outbound call needs, sales teams, service operations

Format: 700–1000 words, markdown headings and bullet points, sharp and persuasive.`,
  },
  {
    seedKey: "platform:webee-customer-outcomes",
    title:   "WEBEE Customer Outcomes & Case Evidence",
    kbSlug:  "platform_shared",
    prompt: `Write a practical reference document on the expected customer outcomes and success patterns for WEBEE platform users.

Cover:
- Typical outcomes for voice agent deployments (lead response time, booking rates, missed-call recovery)
- GrowthMind outcomes: marketing coverage, content volume, campaign ROI improvement
- HiveMind outcomes: operational visibility, task completion rates, decision speed
- SystemMind outcomes: system reliability, incident response, cost monitoring
- Success patterns: which business types see the fastest ROI
- Metrics to track: call answer rates, lead conversion, pipeline velocity, content published
- Common implementation milestones: 0–30 days, 30–90 days, 90+ days
- Customer onboarding best practices

Format: 600–800 words, markdown, practical with specific metrics and timelines.`,
  },
  {
    seedKey: "platform:growthmind-marketing-frameworks",
    title:   "GrowthMind Marketing Frameworks",
    kbSlug:  "platform_growthmind",
    prompt: `Write a dense reference document on the core marketing frameworks that GrowthMind AI CMO should apply when advising businesses on growth and marketing strategy.

Cover:
- AIDA Framework (Awareness, Interest, Desire, Action) — definition, application, metrics
- PAS Framework (Problem, Agitate, Solution) — copy and campaign use
- Hormozi Offer Framework — value equation, Grand Slam offer structure
- Russell Brunson funnel methodology — value ladder, lead magnets, tripwires
- Customer Value Journey (8 stages) — how to map marketing to each stage
- Content Marketing Flywheel — SEO, social, email, retargeting
- Lead generation to revenue: MQL → SQL → opportunity → close
- CAC and LTV optimisation principles
- Retention and referral loops

Format: 800–1100 words, markdown headings, formulas and benchmarks included.`,
  },
  {
    seedKey: "platform:hivemind-operations-frameworks",
    title:   "HiveMind Operations Frameworks",
    kbSlug:  "platform_hivemind",
    prompt: `Write a dense reference document on the core operational and business frameworks that HiveMind AI COO should apply when advising businesses on operations, performance and scaling.

Cover:
- OKRs (Objectives and Key Results) — structure, cadence, examples
- KPI hierarchies — leading vs lagging indicators, dashboard design
- Pipeline management — stage definitions, conversion benchmarks, stall detection
- Revenue operations fundamentals — CRM hygiene, pipeline velocity formula
- Business health scorecard — the 6–8 metrics every SMB must track weekly
- Scaling frameworks — Traction / EOS model overview, bottleneck identification
- Team productivity and accountability — daily stand-ups, weekly reviews, escalation paths
- Decision-making under uncertainty — data-driven vs intuition balance
- Lead recovery and churn prevention tactics

Format: 800–1100 words, markdown headings, specific metrics and decision rules.`,
  },
  {
    seedKey: "platform:systemmind-technical-frameworks",
    title:   "SystemMind Technical Frameworks",
    kbSlug:  "platform_systemmind",
    prompt: `Write a dense reference document on the core technical and reliability frameworks that SystemMind AI CTO should apply when advising on system health, monitoring and technical operations.

Cover:
- Observability fundamentals — metrics, logs, traces (the three pillars)
- SLIs, SLOs, and SLAs — definitions, how to set thresholds, error budgets
- Incident response — severity levels, escalation trees, post-mortem templates
- API reliability patterns — circuit breakers, retries, timeouts, rate limiting
- Database operations best practices — query optimisation, indexing, backup cadence
- Cost optimisation — rightsizing, idle resource detection, per-feature cost attribution
- Security fundamentals — principle of least privilege, secrets management, audit logs
- Telephony and voice infrastructure reliability — uptime targets, failover patterns
- AI runtime monitoring — latency, token costs, error rates, hallucination detection

Format: 800–1100 words, markdown headings, specific thresholds and formulas.`,
  },
  {
    seedKey: "platform:industry-playbooks",
    title:   "Industry Playbooks — WEBEE Cross-Industry Reference",
    kbSlug:  "platform_shared",
    prompt: `Write a practical cross-industry playbook reference for WEBEE AI executives to understand key business patterns, terminology and success metrics across major industry verticals.

Cover these industries with 4–6 bullet points each:
- Real Estate: lead nurturing cadence, listing-to-close metrics, agent follow-up patterns
- Mortgage & Finance: compliance considerations, application funnel, broker economics
- Healthcare & Dental: appointment booking, patient recall, no-show recovery
- Legal Services: intake qualification, retainer conversion, urgency triggers
- Home Services (HVAC, Plumbing, etc.): seasonal demand, emergency vs scheduled, repeat customer value
- Automotive: lead response SLAs, test drive conversion, finance upsell patterns
- Insurance: policy renewal cycles, multi-line cross-sell, claims touchpoints
- E-commerce & Retail: abandoned cart recovery, LTV tiers, return reduction
- SaaS & Tech: trial-to-paid conversion, churn early warning signals, expansion revenue
- Recruitment & Staffing: candidate pipeline velocity, client fill rates, placement economics

Format: 900–1200 words, markdown headings per industry, sharp and specific.`,
  },
];

// ── Seeding function ──────────────────────────────────────────────────────────

export type PlatformSeedResult = {
  processed: number;
  skipped:   number;
  failed:    number;
  remaining: number;
  total:     number;
};

/**
 * Seed missing platform default knowledge documents (idempotent, batched).
 * Processes up to `limit` missing docs per call (default 2).
 * Returns `remaining` so callers can re-invoke until done.
 */
export async function seedPlatformKnowledge(
  limit = 2,
): Promise<PlatformSeedResult> {
  const sb = supabaseAdmin as any;

  // Resolve OpenAI key from env.
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured.");

  // Fetch platform KB rows.
  const { data: kbRows, error: kbErr } = await sb
    .from("executive_knowledge_bases")
    .select("id, slug")
    .eq("scope", "platform_default");
  if (kbErr) throw new Error(`Failed to load platform KBs: ${kbErr.message}`);
  const kbMap: Record<string, string> = {};
  for (const kb of (kbRows ?? [])) kbMap[kb.slug] = kb.id;

  // Check which seed_keys are already present (any status).
  const allSeedKeys = PLATFORM_DOCS.map((d) => d.seedKey);
  const { data: existing } = await sb
    .from("executive_documents")
    .select("seed_key, embedding_status")
    .is("workspace_id", null)
    .in("seed_key", allSeedKeys);

  const existingMap: Record<string, string> = {};
  for (const row of (existing ?? [])) {
    existingMap[row.seed_key] = row.embedding_status;
  }

  const missing = PLATFORM_DOCS.filter(
    (d) => !existingMap[d.seedKey] || existingMap[d.seedKey] === "failed",
  );

  const toProcess = missing.slice(0, limit);
  let processed = 0;
  let failed    = 0;

  for (const doc of toProcess) {
    const kbId = kbMap[doc.kbSlug];
    if (!kbId) {
      console.warn(`[platform-seed] KB not found for slug "${doc.kbSlug}" — skipping "${doc.seedKey}"`);
      failed++;
      continue;
    }

    try {
      // Generate content via OpenAI.
      const content = await generatePlatformDoc(doc.prompt, doc.title, apiKey);

      // Remove any stale failed row so the unique index doesn't block.
      if (existingMap[doc.seedKey] === "failed") {
        await sb
          .from("executive_documents")
          .delete()
          .is("workspace_id", null)
          .eq("seed_key", doc.seedKey);
      }

      // Insert document record (workspace_id = NULL for platform docs).
      const { data: docRow, error: docErr } = await sb
        .from("executive_documents")
        .insert({
          workspace_id:      null,
          knowledge_base_id: kbId,
          source_type:       "seed",
          title:             doc.title,
          seed_key:          doc.seedKey,
          embedding_status:  "pending",
        })
        .select("id")
        .single();
      if (docErr) throw new Error(docErr.message);

      // Index (chunk + embed + store chunks).
      // Pass null workspaceId — platform docs are globally scoped (workspace_id = NULL).
      await indexTextDocument(supabaseAdmin, {
        documentId:  docRow.id,
        workspaceId: null,
        text:        content,
        apiKey,
      });

      processed++;
    } catch (err: any) {
      console.error(`[platform-seed] Failed "${doc.seedKey}":`, err?.message ?? err);
      // Mark as failed in DB so next run retries.
      await sb
        .from("executive_documents")
        .update({ embedding_status: "failed", error_message: String(err?.message ?? err).slice(0, 500) })
        .is("workspace_id", null)
        .eq("seed_key", doc.seedKey)
        .then(undefined, () => {/* best-effort */});
      failed++;
    }
  }

  const skipped   = PLATFORM_DOCS.length - missing.length;
  const remaining = missing.length - toProcess.length;
  return { processed, skipped, failed, remaining, total: PLATFORM_DOCS.length };
}

// ── OpenAI generation helper ──────────────────────────────────────────────────
async function generatePlatformDoc(
  prompt: string,
  title:  string,
  apiKey: string,
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:       "gpt-4o-mini",
      messages: [
        {
          role:    "system",
          content: "You are an expert technical writer producing high-signal, structured reference documents for AI executive knowledge bases. Be concrete, specific and practical. No fluff.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens:  1800,
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  const content = (json.choices?.[0]?.message?.content as string) ?? "";
  if (!content.trim()) throw new Error(`Empty generation for "${title}"`);
  return content;
}
