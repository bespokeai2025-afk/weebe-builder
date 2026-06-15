// ── SystemMind Workflow Intelligence — scoring, cloning, comparison, examples ──
// Server-only. Import dynamically inside createServerFn handlers.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Success Rate ───────────────────────────────────────────────────────────────

export type SuccessRateStats = {
  total: number;
  successful: number;
  rate: number;
};

export async function getWorkflowSuccessRatesServer(
  workspaceId: string,
): Promise<Record<string, SuccessRateStats>> {
  const sb = supabaseAdmin as any;
  try {
    const { data: calls } = await sb
      .from("calls")
      .select("agent_id, call_status")
      .eq("workspace_id", workspaceId)
      .limit(5000);

    const byAgent: Record<string, { total: number; successful: number }> = {};
    for (const call of calls ?? []) {
      if (!call.agent_id) continue;
      if (!byAgent[call.agent_id]) byAgent[call.agent_id] = { total: 0, successful: 0 };
      byAgent[call.agent_id].total++;
      if (call.call_status === "completed") byAgent[call.agent_id].successful++;
    }

    const result: Record<string, SuccessRateStats> = {};
    for (const [agentId, stats] of Object.entries(byAgent)) {
      result[agentId] = {
        ...stats,
        rate: stats.total > 0 ? Math.round((stats.successful / stats.total) * 100) : 0,
      };
    }
    return result;
  } catch {
    return {};
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export function computeWorkflowScore(row: any): number {
  const nc = Number(row.node_count ?? 0);
  const ec = Number(row.edge_count ?? 0);
  if (nc === 0) return 0;
  let score = 30;
  if (nc === 1) score += 20;
  else if (ec >= nc - 1) score += 30;
  else if (ec > 0) score += 15;
  // else: nodes but disconnected — no connectivity bonus
  if (row.has_knowledge_base) score += 10;
  if ((row.tool_ids ?? []).length > 0) score += 10;
  if (row.has_booking) score += 5;
  if (row.has_webhook) score += 5;
  if (row.provider) score += 5;
  if (row.has_transfer) score += 5;
  return Math.min(100, score);
}

export function computeWorkflowComplexity(row: any): { label: string; color: string } {
  const nc = Number(row.node_count ?? 0);
  if (nc === 0) return { label: "Empty",    color: "text-red-400" };
  if (nc <= 2)  return { label: "Minimal",  color: "text-slate-400" };
  if (nc <= 4)  return { label: "Simple",   color: "text-sky-400" };
  if (nc <= 8)  return { label: "Moderate", color: "text-emerald-400" };
  if (nc <= 15) return { label: "Complex",  color: "text-amber-400" };
  return             { label: "Advanced",  color: "text-violet-400" };
}

export function computeWorkflowHealth(score: number): { label: string; color: string; badgeClass: string } {
  if (score >= 80) return { label: "Healthy",        color: "text-emerald-400", badgeClass: "bg-emerald-500/15 text-emerald-400" };
  if (score >= 60) return { label: "Good",           color: "text-sky-400",     badgeClass: "bg-sky-500/15 text-sky-400" };
  if (score >= 40) return { label: "Needs Attention", color: "text-amber-400",  badgeClass: "bg-amber-500/15 text-amber-400" };
  if (score >  0)  return { label: "Critical",       color: "text-red-400",     badgeClass: "bg-red-500/15 text-red-400" };
  return                  { label: "Broken",         color: "text-red-500",     badgeClass: "bg-red-500/20 text-red-500" };
}

// ── Workflow Intelligence ─────────────────────────────────────────────────────

export type ScoredWorkflow = {
  id: string;
  agent_id: string;
  workflow_name: string;
  category: string;
  provider: string | null;
  node_count: number;
  edge_count: number;
  has_webhook: boolean;
  has_booking: boolean;
  has_transfer: boolean;
  has_knowledge_base: boolean;
  tool_ids: string[];
  node_types: string[];
  scanned_at: string;
  score: number;
  complexity: { label: string; color: string };
  health: { label: string; color: string; badgeClass: string };
  successRate: SuccessRateStats | null;
};

export async function getWorkflowIntelligenceServer(workspaceId: string): Promise<ScoredWorkflow[]> {
  const sb = supabaseAdmin as any;
  const [{ data: rows, error }, successRates] = await Promise.all([
    sb
      .from("systemmind_workflow_library")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("scanned_at", { ascending: false }),
    getWorkflowSuccessRatesServer(workspaceId),
  ]);
  if (error) throw new Error(error.message);
  return (rows ?? []).map((row: any) => {
    const score = computeWorkflowScore(row);
    const sr = successRates[row.agent_id] ?? null;
    // Boost score slightly if call success rate is high
    const adjustedScore = sr && sr.total >= 5 && sr.rate >= 80 ? Math.min(100, score + 10) : score;
    return {
      ...row,
      score: adjustedScore,
      complexity: computeWorkflowComplexity(row),
      health: computeWorkflowHealth(adjustedScore),
      successRate: sr,
    };
  });
}

// ── Clone Workflow to Draft ────────────────────────────────────────────────────

export async function cloneWorkflowToDraftServer(
  workspaceId: string,
  agentId: string,
  newTitle: string,
) {
  const sb = supabaseAdmin as any;
  const { data: agent, error } = await sb
    .from("agents")
    .select("id, name, agent_type, flow_data, variables, settings")
    .eq("id", agentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !agent) throw new Error("Agent not found or access denied.");

  const flowData = agent.flow_data ?? {};
  const rawNodes: any[] = flowData.nodes ?? [];
  const rawEdges: any[] = flowData.edges ?? [];

  const nodes = rawNodes.map((n: any) => ({
    id: n.id,
    type: n.type ?? "conversation",
    name: n.data?.name ?? n.data?.label ?? n.type ?? n.id,
    description: n.data?.description ?? n.data?.dialogue ?? "",
    instruction: n.data?.instruction ?? n.data?.prompt ?? "",
  }));

  const edges = rawEdges.map((e: any) => ({
    from: e.source,
    to: e.target,
    condition: e.data?.condition ?? e.label ?? "",
  }));

  const variables: any[] = (agent.variables ?? []).map((v: any) => ({
    name: v.name ?? v.variable_name ?? "",
    type: v.type ?? "string",
    description: v.description ?? "",
    example: v.example ?? "",
  }));

  const { data: draft, error: insertError } = await sb
    .from("systemmind_workflow_drafts")
    .insert({
      workspace_id: workspaceId,
      title: newTitle || `Clone of ${agent.name}`,
      description: `Cloned from agent: ${agent.name}`,
      category: agent.agent_type ?? "General",
      status: "draft",
      nodes,
      edges,
      variables,
      tools: [],
      webhook_suggestions: [],
      kb_suggestions: [],
      follow_up_suggestions: [],
      generated_by: "clone",
      source_patterns: [],
    })
    .select("id, title")
    .single();

  if (insertError) throw new Error(`Failed to clone: ${insertError.message}`);
  return draft;
}

// ── Compare Workflows (AI) ─────────────────────────────────────────────────────

export type WorkflowComparison = {
  agentAName: string;
  agentBName: string;
  scoreA: number;
  scoreB: number;
  complexityA: string;
  complexityB: string;
  similarities: string[];
  differencesA: string[];
  differencesB: string[];
  recommendation: string;
  winnerKey: "A" | "B" | "tie";
};

export async function compareWorkflowsServer(
  workspaceId: string,
  agentIdA: string,
  agentIdB: string,
  apiKey: string,
): Promise<WorkflowComparison> {
  const sb = supabaseAdmin as any;

  const [{ data: rowA }, { data: rowB }] = await Promise.all([
    sb.from("systemmind_workflow_library").select("*").eq("agent_id", agentIdA).eq("workspace_id", workspaceId).maybeSingle(),
    sb.from("systemmind_workflow_library").select("*").eq("agent_id", agentIdB).eq("workspace_id", workspaceId).maybeSingle(),
  ]);

  if (!rowA) throw new Error("Workflow A not found in library. Scan agents first.");
  if (!rowB) throw new Error("Workflow B not found in library. Scan agents first.");

  const scoreA = computeWorkflowScore(rowA);
  const scoreB = computeWorkflowScore(rowB);
  const cxA = computeWorkflowComplexity(rowA).label;
  const cxB = computeWorkflowComplexity(rowB).label;

  const fmt = (r: any) =>
    `Name: ${r.workflow_name}\nCategory: ${r.category}\nProvider: ${r.provider ?? "unknown"}\n` +
    `Nodes: ${r.node_count}, Edges: ${r.edge_count}\nComplexity: ${computeWorkflowComplexity(r).label}\n` +
    `Node types: ${(r.node_types ?? []).join(", ")}\nTools: ${(r.tool_ids ?? []).join(", ") || "none"}\n` +
    `Webhook: ${r.has_webhook}, Booking: ${r.has_booking}, Transfer: ${r.has_transfer}, KB: ${r.has_knowledge_base}`;

  const prompt = `Compare these two AI agent workflows.\n\nWorkflow A:\n${fmt(rowA)}\n\nWorkflow B:\n${fmt(rowB)}\n\nReturn ONLY valid JSON:\n{"similarities":["string"],"differencesA":["string"],"differencesB":["string"],"recommendation":"string","winnerKey":"A|B|tie"}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a workflow analyst. Return ONLY valid JSON." },
        { role: "user", content: prompt },
      ],
      max_tokens: 800, temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const json = (await res.json()) as any;
  const raw = (json.choices?.[0]?.message?.content as string) ?? "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim()); } catch { /* use defaults */ }

  return {
    agentAName: rowA.workflow_name,
    agentBName: rowB.workflow_name,
    scoreA, scoreB, complexityA: cxA, complexityB: cxB,
    similarities: parsed.similarities ?? [],
    differencesA: parsed.differencesA ?? [],
    differencesB: parsed.differencesB ?? [],
    recommendation: parsed.recommendation ?? "",
    winnerKey: parsed.winnerKey === "A" ? "A" : parsed.winnerKey === "B" ? "B" : "tie",
  };
}

// ── Workflow Examples ─────────────────────────────────────────────────────────

export type WorkflowExample = {
  key: string;
  title: string;
  subtitle: string;
  description: string;
  category: string;
  tags: string[];
  estimatedNodes: string;
  complexity: string;
};

export function getWorkflowExamples(): WorkflowExample[] {
  return [
    {
      key: "receptionist",
      title: "Build Receptionist",
      subtitle: "Professional call handler & router",
      description:
        "A professional AI receptionist. Greets callers warmly, collects name and reason for call, identifies intent, routes to the correct department or person, offers to take a message if unavailable, and optionally books appointments via Cal.com. Handles common FAQs and maintains a friendly tone throughout.",
      category: "Receptionist",
      tags: ["routing", "booking", "FAQ", "call-transfer"],
      estimatedNodes: "6–9",
      complexity: "Moderate",
    },
    {
      key: "qualification",
      title: "Build Qualification Agent",
      subtitle: "Lead scoring & routing",
      description:
        "A lead qualification agent for sales. Introduces itself, asks 4–6 qualifying questions (budget, timeline, authority, pain points), scores the lead based on answers, routes high-quality leads to a sales conversation or calendar booking, and politely nurtures unqualified leads with follow-up options.",
      category: "Client Qualification",
      tags: ["lead-scoring", "routing", "sales", "booking"],
      estimatedNodes: "7–10",
      complexity: "Moderate",
    },
    {
      key: "legal_intake",
      title: "Build Legal Intake",
      subtitle: "Case intake & consultation booking",
      description:
        "A legal intake agent for law firms. Greets with a confidentiality disclaimer, identifies the type of legal matter (personal injury, family law, criminal, etc.), systematically collects case details, performs a basic conflict-of-interest check, schedules a consultation using Cal.com, and sends confirmation with next steps.",
      category: "Legal Intake",
      tags: ["legal", "intake", "booking", "conflict-check"],
      estimatedNodes: "8–12",
      complexity: "Complex",
    },
    {
      key: "whatsapp_flow",
      title: "Build WhatsApp Flow",
      subtitle: "Conversational WA automation",
      description:
        "A WhatsApp automation agent. Handles incoming messages, understands user intent using NLP, responds with relevant information from the knowledge base, handles common FAQs automatically, collects contact details for follow-up, and escalates complex or unresolved queries to a human agent. Supports rich messages and quick-reply buttons.",
      category: "WhatsApp Automation",
      tags: ["whatsapp", "messaging", "FAQ", "escalation", "KB"],
      estimatedNodes: "6–8",
      complexity: "Moderate",
    },
    {
      key: "followup_campaign",
      title: "Build Follow-Up Campaign",
      subtitle: "Multi-touch nurture sequence",
      description:
        "A follow-up campaign agent for lead nurturing. Starts with a personalised initial outreach, follows up after 3 days if no response, handles common objections with prepared responses, moves interested leads to a meeting or demo booking, respects opt-out requests immediately, and sends a final re-engagement message after 14 days of silence.",
      category: "Follow-Up Campaign",
      tags: ["follow-up", "nurture", "campaign", "objection-handling", "booking"],
      estimatedNodes: "8–11",
      complexity: "Complex",
    },
  ];
}

// ── Generate from Example ─────────────────────────────────────────────────────

export async function generateFromExampleServer(
  workspaceId: string,
  exampleKey: string,
  customDesc: string,
  apiKey: string,
) {
  const examples = getWorkflowExamples();
  const example = examples.find((e) => e.key === exampleKey);
  if (!example) throw new Error(`Unknown example key: ${exampleKey}`);

  const description = customDesc.trim() ? `${example.description}\n\nAdditional requirements: ${customDesc}` : example.description;

  const { generateWorkflowDraft } = await import("./systemmind-workflow.server");
  return generateWorkflowDraft(workspaceId, { description, category: example.category }, apiKey);
}
