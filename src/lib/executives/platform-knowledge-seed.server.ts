// ── Platform Default Knowledge Seeding (SERVER ONLY) ─────────────────────────
// Generates and indexes the 7 standard WEBEE platform documents into the global
// platform_default KBs (workspace_id = NULL).
//
// Idempotent: each document has a stable global seed_key with the unique index
// exec_docs_platform_seed_key_idx. Re-runs skip already-indexed docs.
//
// Docs with a `content` field are stored verbatim (no LLM call).
// Docs with a `prompt` field are generated via OpenAI gpt-4o-mini.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { indexTextDocument } from "@/lib/executives/executive-document-processing.server";

// ── Platform document definitions ────────────────────────────────────────────

type PlatformDoc =
  | { seedKey: string; title: string; kbSlug: string; content: string; prompt?: never }
  | { seedKey: string; title: string; kbSlug: string; prompt: string; content?: never };

// ── Verbatim authoritative content (no LLM generation) ───────────────────────

const WEBEE_PLATFORM_OVERVIEW_CONTENT = `# WEBEE Platform Overview

**Company:** Webespoke AI

## Product Family

- WEBEE Builder
- WEBEE Smart Dash
- HiveMind
- GrowthMind
- SystemMind
- HexMail
- WhatsApp Centre
- HyperStream
- VoxStream
- Cost Engine

## Mission

To allow businesses to deploy enterprise-grade AI employees, communication systems, CRM workflows, marketing systems and operational automation without requiring developers.

## Overview

WEBEE is a multi-tenant AI Operating System combining conversational AI, telephony, CRM, marketing automation, WhatsApp automation, campaign management, analytics and executive AI assistants inside a single platform.

The platform enables users to deploy AI-powered receptionists, lead generation agents, client qualification agents, customer service agents and marketing systems through a no-code interface.

## Core Modules

### 1. WEBEE Builder

Visual no-code flow builder.

Supports: Voice workflows, WhatsApp workflows, Logic routing, Variable extraction, Tool calling, Webhooks, Document collection, Agent transfers, Knowledge base integration, PDF-to-flow conversion.

### 2. Smart Dash CRM

Centralised operational dashboard.

Supports: Leads, Qualified Leads, Pipeline, Bookings, Contacts, Documents, Calls, Recordings, Transcripts, Notes, Campaigns.

### 3. HyperStream

Native OpenAI Realtime voice engine.

Supports: OpenAI Realtime, Custom workflows, Tool calling, Knowledge retrieval, Advanced VAD, Low latency voice conversations.

### 4. VoxStream

Native ElevenLabs voice engine.

Supports: ElevenLabs conversational AI, Custom voice deployments, Voice testing, Browser voice sessions.

### 5. WhatsApp Centre

Multi-provider WhatsApp management.

Supports: Meta, Twilio, WATI, Broadcast campaigns, Inbound messaging, WhatsApp AI agents, Templates, Automation workflows.

### 6. HexMail

Email marketing and follow-up engine.

Supports: Email campaigns, Drip sequences, Multi-channel follow-up, Campaign enrolments, Template Studio.

### 7. HiveMind

AI Chief Operating Officer.

Provides: Executive briefings, Business reporting, Recommendations, Task creation, Operational intelligence, Action approval workflows, Voice interaction.

### 8. GrowthMind

AI Chief Marketing Officer.

Provides: Marketing intelligence, Campaign recommendations, Business opportunity detection, Content planning, SEO recommendations, Advertising recommendations, Business strategy generation.

### 9. SystemMind

AI Chief Technology Officer.

Provides: Architecture analysis, Workflow intelligence, Provider monitoring, Technical auditing, Workflow repair recommendations, Integration health monitoring.

### 10. Cost Engine

Tracks: Provider costs, Token usage, Voice costs, Telephony costs, Markup, Profitability, Customer pricing.

## Platform Differentiators

- Single platform architecture
- Provider agnostic
- Multi-channel communication
- Executive AI layer
- No-code deployment
- Multi-tenant
- Built-in CRM
- Built-in marketing
- Built-in telephony
- Built-in WhatsApp
- Built-in campaign automation
- Built-in AI executives

## Target Industries

Real Estate, Legal, Professional Services, Consultancies, Education, Healthcare, Corporate Services, Sales Teams, Recruitment, Customer Support.
`;

const WEBEE_SELLING_POINTS_CONTENT = `# WEBEE Competitive Advantages and Selling Points

## Positioning

WEBEE is not just an AI agent builder.

WEBEE is a complete AI Business Operating System.

## Key Competitive Advantages

### 1. One Platform

Most competitors provide: Voice AI only, Chatbots only, CRM only, or Marketing only.

WEBEE combines: AI Agents, CRM, Telephony, WhatsApp, Email, Campaigns, Analytics, and Executive AI — inside one platform.

### 2. No Developers Required

Users can create agents, deploy agents, connect channels, manage campaigns, and review analytics without coding.

### 3. Multiple AI Agent Types

Supports: Receptionist Agents, Lead Generation Agents, Client Qualification Agents, Customer Service Agents, Booking Agents, Document Collection Agents, WhatsApp Agents.

### 4. Multi-Channel Automation

Voice, WhatsApp, Email, CRM, Bookings, Campaigns — all connected.

### 5. Executive AI Layer

Unique feature.

- HiveMind acts as an AI COO.
- GrowthMind acts as an AI CMO.
- SystemMind acts as an AI CTO.

This creates an AI executive team that assists businesses in managing operations, growth and technology.

### 6. Built-In Marketing Intelligence

GrowthMind can: Analyse business goals, Identify opportunities, Generate strategies, Generate content, Recommend campaigns, Monitor performance.

### 7. Built-In Technical Intelligence

SystemMind can: Monitor integrations, Audit workflows, Identify failures, Suggest repairs, Generate implementation plans.

### 8. AI Receptionist

Businesses can replace or augment traditional receptionists with AI-powered voice agents.

Benefits: 24/7 availability, Reduced staffing costs, Instant response times, Scalable call handling.

### 9. AI Lead Qualification

Automatically: Call leads, Qualify prospects, Book appointments, Update CRM records, Trigger follow-up campaigns.

### 10. AI Follow-Up

HexMail and WhatsApp Centre allow: Automated nurture, Email sequences, WhatsApp broadcasts, Reactivation campaigns, Appointment reminders.

### 11. Provider Agnostic Architecture

Supports: OpenAI, Gemini, Claude, Retell, ElevenLabs, Twilio, FreJun, Meta, WATI, Cal.com, Resend, and future providers.

Businesses are not locked into a single vendor.

### 12. Revenue Loop Automation

WEBEE can automate: Lead Capture, Lead Qualification, Appointment Booking, Follow-Up, Customer Communication, Pipeline Management, Reporting.

This creates a complete revenue-generation workflow.

## Ideal Customer Problems Solved

- Missed calls
- Slow response times
- Manual lead qualification
- Poor follow-up
- Fragmented systems
- Disconnected marketing tools
- Lack of operational visibility
- High staffing costs
- Lack of automation
- Lack of reporting

## Core Value Proposition

Deploy AI employees, automate customer communications, manage leads, run campaigns and gain executive-level business intelligence from a single platform.
`;

// ── Document list ─────────────────────────────────────────────────────────────

const PLATFORM_DOCS: PlatformDoc[] = [
  // ── Verbatim authoritative documents ────────────────────────────────────────
  {
    seedKey: "platform:webee-overview",
    title:   "WEBEE Platform Overview",
    kbSlug:  "platform_shared",
    content: WEBEE_PLATFORM_OVERVIEW_CONTENT,
  },
  {
    seedKey: "platform:webee-selling-points",
    title:   "WEBEE Competitive Advantages & Selling Points",
    kbSlug:  "platform_shared",
    content: WEBEE_SELLING_POINTS_CONTENT,
  },

  // ── AI-generated companion documents ────────────────────────────────────────
  {
    seedKey: "platform:webee-customer-outcomes",
    title:   "WEBEE Customer Outcomes & Success Patterns",
    kbSlug:  "platform_shared",
    prompt: `Write a practical reference document on the expected customer outcomes and success patterns for WEBEE platform users.

WEBEE product family (for context):
WEBEE Builder (no-code voice+WA flows), Smart Dash CRM, HyperStream (OpenAI Realtime voice), VoxStream (ElevenLabs voice), WhatsApp Centre (Meta/Twilio/WATI), HexMail (email campaigns), HiveMind (AI COO), GrowthMind (AI CMO), SystemMind (AI CTO), Cost Engine.

Target industries: Real Estate, Legal, Professional Services, Consultancies, Education, Healthcare, Corporate Services, Sales Teams, Recruitment, Customer Support.

Cover:
- Typical outcomes for voice agent deployments (lead response time, booking rates, missed-call recovery)
- WhatsApp and multi-channel campaign outcomes
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

GrowthMind's role: Marketing intelligence, campaign recommendations, business opportunity detection, content planning, SEO recommendations, advertising recommendations, business strategy generation.

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
- Multi-channel coordination: voice campaigns + WhatsApp + email (HexMail) + content

Format: 800–1100 words, markdown headings, formulas and benchmarks included.`,
  },
  {
    seedKey: "platform:hivemind-operations-frameworks",
    title:   "HiveMind Operations Frameworks",
    kbSlug:  "platform_hivemind",
    prompt: `Write a dense reference document on the core operational and business frameworks that HiveMind AI COO should apply when advising businesses on operations, performance and scaling.

HiveMind's role: Executive briefings, business reporting, recommendations, task creation, operational intelligence, action approval workflows, voice interaction.

Cover:
- OKRs (Objectives and Key Results) — structure, cadence, examples
- KPI hierarchies — leading vs lagging indicators, dashboard design
- Pipeline management — stage definitions, conversion benchmarks, stall detection
- Revenue operations fundamentals — CRM hygiene (Smart Dash), pipeline velocity formula
- Business health scorecard — the 6–8 metrics every SMB must track weekly
- Scaling frameworks — Traction / EOS model overview, bottleneck identification
- Team productivity and accountability — daily stand-ups, weekly reviews, escalation paths
- Decision-making under uncertainty — data-driven vs intuition balance
- Lead recovery and churn prevention tactics
- How HiveMind uses the Cost Engine data to surface profitability insights

Format: 800–1100 words, markdown headings, specific metrics and decision rules.`,
  },
  {
    seedKey: "platform:systemmind-technical-frameworks",
    title:   "SystemMind Technical Frameworks",
    kbSlug:  "platform_systemmind",
    prompt: `Write a dense reference document on the core technical and reliability frameworks that SystemMind AI CTO should apply when advising on system health, monitoring and technical operations.

SystemMind's role: Architecture analysis, workflow intelligence, provider monitoring, technical auditing, workflow repair recommendations, integration health monitoring.

The WEBEE platform integrates: telephony (HyperStream/VoxStream/Retell), WhatsApp (Meta/Twilio/WATI), email (HexMail), CRM (Smart Dash), AI executives (HiveMind/GrowthMind/SystemMind), Cost Engine, and the WEBEE Builder no-code flow system.

Cover:
- Observability fundamentals — metrics, logs, traces (the three pillars)
- SLIs, SLOs, and SLAs — definitions, how to set thresholds, error budgets
- Incident response — severity levels, escalation trees, post-mortem templates
- API reliability patterns — circuit breakers, retries, timeouts, rate limiting
- Database operations best practices — query optimisation, indexing, backup cadence
- Cost optimisation — rightsizing, idle resource detection, per-feature cost attribution (Cost Engine)
- Security fundamentals — principle of least privilege, secrets management, audit logs
- Telephony and voice infrastructure reliability — uptime targets, failover patterns
- AI runtime monitoring — latency, token costs, error rates, hallucination detection
- WEBEE workflow health — no-code flow repair, integration status monitoring

Format: 800–1100 words, markdown headings, specific thresholds and formulas.`,
  },
  {
    seedKey: "platform:industry-playbooks",
    title:   "Industry Playbooks — WEBEE Cross-Industry Reference",
    kbSlug:  "platform_shared",
    prompt: `Write a practical cross-industry playbook reference for WEBEE AI executives to understand key business patterns, terminology and success metrics across major industry verticals.

WEBEE serves: Real Estate, Legal, Professional Services, Consultancies, Education, Healthcare, Corporate Services, Sales Teams, Recruitment, Customer Support.

WEBEE tools available per industry: AI voice agents (HyperStream/VoxStream), WhatsApp automation (WhatsApp Centre), email campaigns (HexMail), CRM (Smart Dash), AI executives (HiveMind/GrowthMind/SystemMind), no-code builder (WEBEE Builder).

Cover these industries with 4–6 bullet points each, including which WEBEE tools are most impactful:
- Real Estate: lead nurturing cadence, listing-to-close metrics, agent follow-up patterns
- Legal Services: intake qualification, retainer conversion, urgency triggers
- Professional Services & Consultancies: proposal pipeline, retainer growth, referral loops
- Healthcare & Education: appointment booking, patient/student recall, no-show recovery
- Corporate Services & Sales Teams: outbound cadence, pipeline velocity, CRM hygiene
- Recruitment: candidate pipeline velocity, client fill rates, placement economics
- Customer Support: first-contact resolution, escalation routing, satisfaction tracking

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
 *
 * Docs with literal `content` are stored verbatim (no LLM call).
 * Docs with `prompt` are generated via OpenAI gpt-4o-mini.
 */
export async function seedPlatformKnowledge(
  limit = 2,
): Promise<PlatformSeedResult> {
  const sb = supabaseAdmin as any;

  // Resolve OpenAI key from env (only needed for generated docs).
  const apiKey = process.env.OPENAI_API_KEY?.trim();

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
      // Resolve content: verbatim if `content` is set, else generate via OpenAI.
      let text: string;
      if (doc.content) {
        text = doc.content;
      } else {
        if (!apiKey) throw new Error("OPENAI_API_KEY not configured — required for generated docs.");
        text = await generatePlatformDoc(doc.prompt, doc.title, apiKey);
      }

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
        text,
        apiKey:      apiKey ?? "",
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
