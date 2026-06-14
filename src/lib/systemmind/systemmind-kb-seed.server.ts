// ── SystemMind Knowledge Base Seeder (SERVER ONLY) ─────────────────────────────
// Generates Architecture KB and Workflow KB starter documents via OpenAI and
// stores them in the systemmind executive knowledge base so
// querySystemMindKnowledgeContext has grounding material from day one.
//
// Mirrors the pattern of executive-knowledge-seed.server.ts:
//   • Each topic has a stable `seed_key` — already-indexed docs are skipped.
//   • Processing is batched (`limit` per call, default 4) so calls never time out.
//   • Callers re-invoke until `remaining === 0`.
//
// Repair KB is handled separately by seedRepairPlaybooks() in
// systemmind-workflow.server.ts (22 structured playbooks in a dedicated table).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  resolveOpenAiKey,
  ensureDefaultKnowledgeBases,
} from "@/lib/executives/executive-knowledge.server";
import { indexTextDocument } from "@/lib/executives/executive-document-processing.server";

// ── Topic definitions ──────────────────────────────────────────────────────────
// Deterministic topic lists → stable seed_keys → idempotent on every run.

const ARCHITECTURE_TOPICS = [
  "Platform Architecture Overview",
  "Provider Framework and Registry",
  "Database Schema and Core Tables",
  "Agent Builder Flow Structure",
  "Knowledge System and RAG Pipeline",
  "Campaign Engine and Scheduling",
  "Deployment and Infrastructure",
  "Cost Tracking and Observability",
];

const WORKFLOW_TOPICS = [
  "Node Types and Their Purpose",
  "Edge Conditions and Routing Logic",
  "Common Workflow Patterns",
  "Flow Design Best Practices",
  "Variable System and Data Capture",
  "Multi-Channel Deployment Options",
  "Testing and Debugging Flows",
  "Agent Settings and Configuration",
];

// key prefix for each group — must not collide with existing seed keys
const ARCH_PREFIX = "systemmind-arch";
const WF_PREFIX = "systemmind-wf";

// ── Helpers ───────────────────────────────────────────────────────────────────

function topicSlug(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function generateArchitectureDoc(topic: string, apiKey: string): Promise<string> {
  const prompt = `Write a practical, dense reference note on "${topic}" for an AI Chief Technology Officer (CTO) to use as decision-support knowledge about this AI voice-agent and executive-intelligence platform.

Context about the platform:
- Users build voice/WhatsApp agent conversation flows in a visual drag-and-drop builder (React Flow)
- Agents are deployed via Retell AI (OmniVoice), ElevenLabs (HyperStream), or OpenAI Realtime (VoxStream) for voice; Twilio, WATI, or Meta for WhatsApp
- Three AI executives: SystemMind (CTO), GrowthMind (CMO), HiveMind (COO)
- Stack: TanStack Start (SSR), Supabase (PostgreSQL + pgvector + Auth + Storage), Vite, shadcn/ui
- Provider framework with 12 categories, credential storage, health checks, fallback chains, and usage tracking
- Knowledge system uses OpenAI text-embedding-3-small (1536 dims) + pgvector for RAG

Requirements:
- 500-800 words, structured with markdown headings and bullet points.
- Cover: core concepts, how it works in this platform, key design decisions, failure modes, and a short operational checklist.
- Be concrete and specific — real names, table names, function patterns, thresholds where relevant.
- No fluff, no preamble, no "as an AI" — start directly with the content.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert technical writer producing concise, high-signal architecture reference notes for AI platform CTOs.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1400,
      temperature: 0.4,
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

async function generateWorkflowDoc(topic: string, apiKey: string): Promise<string> {
  const prompt = `Write a practical, dense reference note on "${topic}" for an AI Chief Technology Officer (CTO) to use as decision-support knowledge about conversation workflow design in this AI voice-agent platform.

Context about the workflow system:
- Conversation flows are directed graphs: nodes (start, message, condition, question, transfer, webhook, end, knowledge_base) connected by edges
- Flows are stored as flow_data JSONB (nodes[], edges[]) in the agents table
- Edges can carry conditions (yes/no handles from condition nodes) or default handles
- Agents can be deployed as voice (Retell/ElevenLabs/OpenAI Realtime) or WhatsApp (Twilio/WATI/Meta)
- Variables can be captured via question nodes and referenced as {{variableName}} in dialogue
- Webhook nodes make external HTTP calls; knowledge_base nodes query the agent's RAG index
- For OpenAI Realtime, the flow graph is compiled into a single instruction string at runtime

Requirements:
- 500-800 words, structured with markdown headings and bullet points.
- Cover: core concepts, practical usage patterns, common mistakes, edge cases, and a short design checklist.
- Be concrete and specific — real node type names, field names, patterns that matter in production.
- No fluff, no preamble, no "as an AI" — start directly with the content.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert technical writer producing concise, high-signal workflow reference notes for AI platform CTOs.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1400,
      temperature: 0.4,
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

// ── Public API ────────────────────────────────────────────────────────────────

export type SeedResult = { processed: number; remaining: number; failed: number; total: number };

/**
 * Seed missing Architecture KB and Workflow KB starter knowledge for a workspace.
 * Generates content via OpenAI (gpt-4o-mini) using deterministic topic prompts.
 * Processes up to `limit` missing topics per call (default 4) and reports how
 * many remain so callers can repeat until `remaining === 0`.
 */
export async function seedSystemMindKnowledgeBases(
  workspaceId: string,
  limit = 4,
): Promise<SeedResult> {
  const sb = supabaseAdmin as any;
  const kbs = await ensureDefaultKnowledgeBases(sb, workspaceId);
  const systemmindKb = kbs.find((k: any) => k.slug === "systemmind");
  if (!systemmindKb) {
    return { processed: 0, remaining: 0, failed: 0, total: 0 };
  }

  const apiKey = await resolveOpenAiKey(sb, workspaceId);

  // Build full expected seed list
  const expected: Array<{
    seedKey: string;
    topic: string;
    group: "arch" | "wf";
    kbId: string;
  }> = [
    ...ARCHITECTURE_TOPICS.map((topic) => ({
      seedKey: `${ARCH_PREFIX}:${topicSlug(topic)}`,
      topic,
      group: "arch" as const,
      kbId: systemmindKb.id,
    })),
    ...WORKFLOW_TOPICS.map((topic) => ({
      seedKey: `${WF_PREFIX}:${topicSlug(topic)}`,
      topic,
      group: "wf" as const,
      kbId: systemmindKb.id,
    })),
  ];
  const total = expected.length;

  // Fetch already-seeded docs
  const { data: existingRows } = await sb
    .from("executive_documents")
    .select("id, seed_key, embedding_status")
    .eq("workspace_id", workspaceId)
    .not("seed_key", "is", null);

  const existingByKey = new Map<string, { id: string; embedding_status: string }>(
    (existingRows ?? []).map((r: any) => [r.seed_key, { id: r.id, embedding_status: r.embedding_status }]),
  );

  // Missing = not present at all, OR present but not yet indexed (retry)
  const missing = expected.filter((e) => {
    const ex = existingByKey.get(e.seedKey);
    return !ex || ex.embedding_status !== "indexed";
  });

  const batch = missing.slice(0, limit);
  let processed = 0;
  let failed = 0;

  for (const item of batch) {
    try {
      const content =
        item.group === "arch"
          ? await generateArchitectureDoc(item.topic, apiKey)
          : await generateWorkflowDoc(item.topic, apiKey);

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
      console.error(`[SystemMindKbSeed] ${item.seedKey} failed:`, (e as Error)?.message);
      failed++;
    }
  }

  return {
    processed,
    remaining: Math.max(0, missing.length - processed - failed),
    failed,
    total,
  };
}
