// ── Executive starter-knowledge seeding (SERVER ONLY) ─────────────────────────
// Generates real reference content via OpenAI for each default KB's starter topics,
// stores it as a seeded executive_document, then chunks/embeds/indexes it.
//
// Idempotent: each topic has a stable `seed_key` (unique per workspace). Topics
// already indexed are skipped, so repeat runs never duplicate. Processing is
// batched (a `limit` per call) so the routine never exceeds request timeouts —
// callers re-invoke until `remaining === 0`.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveOpenAiKey, ensureDefaultKnowledgeBases } from "@/lib/executives/executive-knowledge.server";
import { indexTextDocument } from "@/lib/executives/executive-document-processing.server";

// ── TIER 1: PLATFORM KNOWLEDGE ONLY ──────────────────────────────────────────
// These are universal business frameworks and methodologies — safe for ALL
// customer workspaces. NO WEBEE-specific products, pricing, campaigns, or
// business information must ever appear here.
//
// Knowledge Tier Rules:
//   Tier 1 = Platform Knowledge (this file) — shared, read-only, framework-level
//   Tier 2 = Workspace Knowledge — customer uploads, Business DNA, private
//   Tier 3 = Business DNA — structured profile specific to each workspace
// ─────────────────────────────────────────────────────────────────────────────
const SEED_TOPICS: Record<string, string[]> = {
  growthmind: [
    // Marketing Frameworks
    "AIDA Framework", "PAS Framework", "Before-After-Bridge Framework",
    "StoryBrand Framework", "Jobs-To-Be-Done Marketing",
    // Growth & Offers
    "Hormozi Offer Creation", "Russell Brunson Funnel Strategy",
    "Value Ladder Framework", "Lead Magnet Strategy",
    // Channels & Tactics
    "SEO Fundamentals", "Google Ads Best Practices", "Meta Ads Best Practices",
    "LinkedIn Advertising", "Email Marketing Fundamentals", "Content Marketing Strategy",
    // Optimisation
    "Lead Nurturing Sequences", "Conversion Rate Optimisation",
    "Marketing Attribution", "Customer Acquisition Cost Framework",
    // Strategy
    "CRM Best Practices", "Sales Methodology Overview", "Client Qualification Framework",
    "Campaign Planning Framework", "GrowthMind Marketing Playbook",
  ],
  systemmind: [
    // Reliability
    "Monitoring and Observability", "Error Tracking Best Practices",
    "API Reliability and SLAs", "Telephony System Reliability",
    // Infrastructure
    "Cloud Infrastructure Best Practices", "Database Operations and Backup",
    "AI Runtime Cost Optimisation", "Security and Access Control",
    // Operations
    "Incident Response Playbook", "Performance Benchmarking",
    "AI Receptionist Deployment Playbook", "Voice AI Quality Assurance",
    "SystemMind Operational Playbook",
  ],
  hivemind: [
    // Executive Decision Support
    "Business Operations Framework", "Executive Reporting Fundamentals",
    "KPI Selection and Tracking", "Revenue Forecasting Methods",
    "Decision Making Under Uncertainty",
    // Business Scaling
    "Business Scaling Playbook", "Team Productivity Frameworks",
    "CRM Operations Best Practices", "Customer Lifetime Value Optimisation",
    // Intelligence
    "Task Prioritisation Matrix", "Competitive Intelligence Framework",
    "AI Receptionist Playbook", "Lead Generation Playbook",
    "HiveMind COO Playbook",
  ],
};

const ROLE_BY_SLUG: Record<string, string> = {
  growthmind: "an AI Chief Marketing Officer (CMO)",
  systemmind: "an AI Chief Technology Officer (CTO)",
  hivemind: "an AI Chief Operating Officer (COO)",
};

function topicSlug(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function generateReferenceDoc(topic: string, slug: string, apiKey: string): Promise<string> {
  const role = ROLE_BY_SLUG[slug] ?? "an AI executive";
  const prompt = `Write a practical, dense reference note on "${topic}" for ${role} to use as decision-support knowledge.

Requirements:
- 500-800 words, structured with markdown headings and bullet points.
- Cover: core definition, why it matters, the key frameworks/steps/metrics, common mistakes, and a short actionable checklist.
- Be concrete and specific — real tactics, formulas, thresholds and benchmarks where relevant.
- No fluff, no preamble, no "as an AI" — start directly with the content.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an expert reference-writer producing concise, high-signal knowledge notes." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1400,
      temperature: 0.5,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  const content = (json.choices?.[0]?.message?.content as string) ?? "";
  if (!content.trim()) throw new Error("Empty generation");
  return content;
}

export type SeedResult = { processed: number; remaining: number; failed: number; total: number };

/**
 * Seed missing starter knowledge for a workspace. Processes up to `limit` missing
 * topics per call (default 4) and reports how many remain so callers can repeat.
 */
export async function seedExecutiveStarterKnowledge(
  workspaceId: string,
  limit = 4,
): Promise<SeedResult> {
  const sb = supabaseAdmin as any;
  const kbs = await ensureDefaultKnowledgeBases(sb, workspaceId);
  const kbBySlug = new Map(kbs.map((k) => [k.slug, k]));

  const apiKey = await resolveOpenAiKey(sb, workspaceId);

  // Build the full list of expected seed keys, then subtract those already indexed.
  const expected: Array<{ slug: string; topic: string; seedKey: string; kbId: string }> = [];
  for (const [slug, topics] of Object.entries(SEED_TOPICS)) {
    const kb = kbBySlug.get(slug);
    if (!kb) continue;
    for (const topic of topics) {
      expected.push({ slug, topic, seedKey: `${slug}:${topicSlug(topic)}`, kbId: kb.id });
    }
  }
  const total = expected.length;

  const { data: existingRows } = await sb
    .from("executive_documents")
    .select("id, seed_key, embedding_status")
    .eq("workspace_id", workspaceId)
    .not("seed_key", "is", null);
  const existingByKey = new Map<string, { id: string; embedding_status: string }>(
    (existingRows ?? []).map((r: any) => [r.seed_key, { id: r.id, embedding_status: r.embedding_status }]),
  );

  // Missing = not present at all, OR present but not yet indexed (retry).
  const missing = expected.filter((e) => {
    const ex = existingByKey.get(e.seedKey);
    return !ex || ex.embedding_status !== "indexed";
  });

  const batch = missing.slice(0, limit);
  let processed = 0;
  let failed = 0;

  for (const item of batch) {
    try {
      const content = await generateReferenceDoc(item.topic, item.slug, apiKey);

      let docId = existingByKey.get(item.seedKey)?.id;
      if (!docId) {
        const { data: doc, error } = await sb
          .from("executive_documents")
          .insert({
            workspace_id: workspaceId,
            knowledge_base_id: item.kbId,
            source_type: "seed",
            title: item.topic,
            seed_key: item.seedKey,
            embedding_status: "pending",
          })
          .select("id")
          .single();
        if (error || !doc) throw new Error(error?.message ?? "insert failed");
        docId = doc.id;
      }

      await indexTextDocument(sb, { documentId: docId, workspaceId, text: content, apiKey });
      processed++;
    } catch (e) {
      console.error(`[ExecSeed] ${item.seedKey} failed:`, (e as Error)?.message);
      failed++;
    }
  }

  return { processed, remaining: Math.max(0, missing.length - processed), failed, total };
}
