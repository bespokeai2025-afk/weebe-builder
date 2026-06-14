// ── SystemMind Workflow Intelligence — server-only ─────────────────────────────
// SERVER ONLY. Loaded dynamically inside createServerFn handlers.
//
// Exports:
//   scanAndStoreAgentWorkflows  — scan agents table → systemmind_workflow_library
//   extractAndStorePatterns     — AI pattern extraction → systemmind_workflow_patterns
//   generateWorkflowDraft       — AI draft generation  → systemmind_workflow_drafts
//   analyzeWorkflowRepair       — deterministic + AI repair analysis
//   querySystemMindKnowledgeContext — multi-source knowledge query (KB + library + playbooks)
//   seedRepairPlaybooks         — idempotent seed of 22 default playbooks

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Agent type → display category ─────────────────────────────────────────────
const AGENT_TYPE_CATEGORY: Record<string, string> = {
  lead_generation:      "Lead Generation",
  receptionist:         "Receptionist",
  client_qualification: "Client Qualification",
  legal_intake:         "Legal Intake",
  real_estate:          "Real Estate Qualification",
  appointment_booking:  "Appointment Booking",
  document_collection:  "Document Collection",
  whatsapp_automation:  "WhatsApp Automation",
  follow_up:            "Follow-Up Campaign",
  crm_sync:             "CRM Sync",
  call_transfer:        "Call Transfer",
  knowledge_base_agent: "Knowledge Base Agent",
};

function deriveCategory(agentType: string | null | undefined): string {
  if (!agentType) return "General";
  return (
    AGENT_TYPE_CATEGORY[agentType] ??
    agentType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// ── Mini OpenAI chat helper ────────────────────────────────────────────────────
async function gptMini(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 800,
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      max_tokens: maxTokens,
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI error ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  return (json.choices?.[0]?.message?.content as string) ?? "";
}

// ── Flow analysis helpers ──────────────────────────────────────────────────────
type FlowNode = {
  id: string;
  type?: string;
  data?: Record<string, any>;
  position?: { x: number; y: number };
};
type FlowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};

function analyzeFlow(flowData: any) {
  const nodes: FlowNode[] = flowData?.nodes ?? [];
  const edges: FlowEdge[] = flowData?.edges ?? [];

  const nodeTypes = Array.from(
    new Set(nodes.map((n) => n.type).filter(Boolean)),
  ) as string[];

  const toolIds: string[] = [];
  let hasWebhook = false;
  let hasBooking = false;
  let hasTransfer = false;
  let hasKnowledgeBase = false;

  for (const node of nodes) {
    const data = node.data ?? {};
    const ntype = (node.type ?? "").toLowerCase();

    if (data.toolId) toolIds.push(String(data.toolId));
    if (data.tool_id) toolIds.push(String(data.tool_id));
    if (Array.isArray(data.tools)) {
      for (const t of data.tools) {
        if (t?.id || t?.name) toolIds.push(String(t.id ?? t.name));
      }
    }

    if (ntype.includes("webhook") || data.webhookUrl || data.webhook_url) hasWebhook = true;
    if (ntype.includes("call_transfer") || ntype.includes("transfer")) hasTransfer = true;
    if (data.knowledgeBaseId || data.knowledge_base_id || ntype.includes("knowledge"))
      hasKnowledgeBase = true;
    if (
      ntype.includes("booking") ||
      (data.toolId && String(data.toolId).toLowerCase().includes("cal")) ||
      (data.toolId && String(data.toolId).toLowerCase().includes("booking"))
    )
      hasBooking = true;
  }

  return {
    nodes,
    edges,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodeTypes,
    toolIds: Array.from(new Set(toolIds)),
    hasWebhook,
    hasBooking,
    hasTransfer,
    hasKnowledgeBase,
  };
}

// ── 1. Scan + store agent workflows ───────────────────────────────────────────
export async function scanAndStoreAgentWorkflows(workspaceId: string): Promise<{
  scanned: number;
  stored: number;
  templates: number;
  campaigns: number;
}> {
  const sb = supabaseAdmin as any;
  const now = new Date().toISOString();

  // ── 1a. Scan agents → systemmind_workflow_library ──────────────────────────
  const { data: agents, error } = await sb
    .from("agents")
    .select("id, name, agent_type, voice_provider, flow_data, settings, variables")
    .eq("workspace_id", workspaceId)
    .order("name");

  if (error) throw new Error(`Failed to read agents: ${error.message}`);

  let stored = 0;
  for (const agent of agents ?? []) {
    try {
      const settings = agent.settings ?? {};
      const flow = analyzeFlow(agent.flow_data);
      const row = {
        workspace_id: workspaceId,
        agent_id: agent.id,
        workflow_name: agent.name,
        agent_type: agent.agent_type ?? null,
        category: deriveCategory(agent.agent_type),
        channel: settings.channelType ?? "voice",
        provider: agent.voice_provider ?? null,
        node_count: flow.nodeCount,
        edge_count: flow.edgeCount,
        node_types: flow.nodeTypes,
        tool_ids: flow.toolIds,
        has_webhook: flow.hasWebhook,
        has_booking: flow.hasBooking,
        has_transfer: flow.hasTransfer,
        has_knowledge_base: flow.hasKnowledgeBase,
        deployment_mode: settings.deploymentMode ?? null,
        flow_snapshot: {
          nodes: flow.nodes.slice(0, 20).map((n) => ({
            id: n.id,
            type: n.type,
            hasPrompt: !!(n.data?.prompt || n.data?.instruction || n.data?.dialogue),
            hasTool: !!(n.data?.toolId || n.data?.tool_id),
          })),
          edgeCount: flow.edgeCount,
        },
        scanned_at: now,
      };
      const { error: upsertError } = await sb
        .from("systemmind_workflow_library")
        .upsert(row, { onConflict: "workspace_id,agent_id" });
      if (!upsertError) stored++;
    } catch {
      // Skip agents with malformed flow data
    }
  }

  // ── 1b. Scan agent_templates (in-memory — no FK to agents table) ───────────
  let templateCount = 0;
  try {
    const { data: templates } = await sb
      .from("agent_templates")
      .select("id, name, agent_type, flow_data, settings")
      .or(`scope.eq.public,workspace_id.eq.${workspaceId}`)
      .limit(100);

    for (const tpl of templates ?? []) {
      try {
        analyzeFlow(tpl.flow_data); // validates parseable
        templateCount++;
      } catch { /* skip */ }
    }
  } catch { /* graceful — agent_templates may not exist */ }

  // ── 1c. Scan campaigns (email + whatsapp + growth) in-memory ──────────────
  let campaignCount = 0;
  try {
    const [{ data: emailCampaigns }, { data: watiCampaigns }, { data: growthCampaigns }] =
      await Promise.all([
        sb.from("hexmail_campaigns").select("id").eq("workspace_id", workspaceId).limit(200),
        sb.from("wati_campaigns").select("id").eq("workspace_id", workspaceId).limit(200),
        sb.from("growthmind_growth_campaigns").select("id").eq("workspace_id", workspaceId).limit(200),
      ]).catch(() => [{ data: [] }, { data: [] }, { data: [] }]);
    campaignCount =
      (emailCampaigns?.length ?? 0) +
      (watiCampaigns?.length ?? 0) +
      (growthCampaigns?.length ?? 0);
  } catch { /* graceful */ }

  return {
    scanned: (agents ?? []).length,
    stored,
    templates: templateCount,
    campaigns: campaignCount,
  };
}

// ── 2. Extract workflow patterns (AI) ─────────────────────────────────────────
export async function extractAndStorePatterns(
  workspaceId: string,
  category: string | null | undefined,
  apiKey: string,
): Promise<{ extracted: number }> {
  const sb = supabaseAdmin as any;

  let q = sb
    .from("systemmind_workflow_library")
    .select("*")
    .eq("workspace_id", workspaceId);
  if (category) q = q.eq("category", category);
  const { data: workflows, error } = await q;
  if (error || !workflows?.length) return { extracted: 0 };

  const byCategory = new Map<string, any[]>();
  for (const wf of workflows) {
    const cat = wf.category ?? "General";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(wf);
  }

  let extracted = 0;
  for (const [cat, wfs] of byCategory) {
    try {
      const summary = wfs
        .map(
          (w, i) =>
            `${i + 1}. "${w.workflow_name}" (${w.provider ?? "unknown provider"}): ` +
            `${w.node_count} nodes, types: ${(w.node_types ?? []).join(", ")}. ` +
            `Tools: ${(w.tool_ids ?? []).join(", ") || "none"}. ` +
            `Webhook: ${w.has_webhook}, Booking: ${w.has_booking}, Transfer: ${w.has_transfer}, KB: ${w.has_knowledge_base}.`,
        )
        .join("\n");

      const prompt = `Analyse these "${cat}" AI agent workflows and extract reusable patterns.

WORKFLOWS:
${summary}

Return a JSON object (ONLY valid JSON, no markdown):
{
  "patterns": [
    {
      "pattern_name": "string",
      "description": "string",
      "node_sequence": ["string"],
      "common_tools": ["string"],
      "common_variables": ["string"],
      "logic_split_pattern": "string or null",
      "booking_pattern": "string or null",
      "transfer_pattern": "string or null",
      "document_pattern": "string or null",
      "confidence_score": 0.0
    }
  ]
}

Return 1-3 patterns max. Be concise.`;

      const raw = await gptMini(
        apiKey,
        [
          { role: "system", content: "Workflow pattern analyst. Return ONLY valid JSON." },
          { role: "user", content: prompt },
        ],
        1200,
      );

      let parsed: any = { patterns: [] };
      try {
        parsed = JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim());
      } catch { /* skip */ }

      for (const p of parsed?.patterns ?? []) {
        await sb.from("systemmind_workflow_patterns").upsert(
          {
            workspace_id: workspaceId,
            category: cat,
            pattern_name: String(p.pattern_name ?? "Pattern").slice(0, 120),
            description: String(p.description ?? "").slice(0, 500),
            node_sequence: Array.isArray(p.node_sequence) ? p.node_sequence.map(String) : [],
            common_tools: Array.isArray(p.common_tools) ? p.common_tools.map(String) : [],
            common_variables: Array.isArray(p.common_variables) ? p.common_variables.map(String) : [],
            logic_split_pattern: p.logic_split_pattern
              ? String(p.logic_split_pattern).slice(0, 300)
              : null,
            booking_pattern: p.booking_pattern ? String(p.booking_pattern).slice(0, 300) : null,
            transfer_pattern: p.transfer_pattern ? String(p.transfer_pattern).slice(0, 300) : null,
            document_pattern: p.document_pattern ? String(p.document_pattern).slice(0, 300) : null,
            example_workflow_ids: wfs
              .slice(0, 3)
              .map((w: any) => w.agent_id)
              .filter(Boolean),
            confidence_score:
              typeof p.confidence_score === "number"
                ? Math.min(1, Math.max(0, p.confidence_score))
                : 0.5,
            generated_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,category,pattern_name" },
        );
        extracted++;
      }
    } catch {
      // Pattern extraction failed for this category; continue
    }
  }

  return { extracted };
}

// ── 3. Generate workflow draft (AI) ───────────────────────────────────────────
export async function generateWorkflowDraft(
  workspaceId: string,
  opts: { description: string; category: string },
  apiKey: string,
): Promise<{ draftId: string; draft: any }> {
  const sb = supabaseAdmin as any;

  const { data: patterns } = await sb
    .from("systemmind_workflow_patterns")
    .select("pattern_name, description, node_sequence, common_tools, common_variables")
    .eq("workspace_id", workspaceId)
    .eq("category", opts.category)
    .limit(3);

  let knowledgeContext = "";
  try {
    // Use full multi-source KB: Architecture KB + Workflow Patterns + Repair Playbooks
    knowledgeContext = await querySystemMindKnowledgeContext(
      workspaceId,
      `${opts.category} workflow design best practices ${opts.description}`,
      apiKey,
    );
  } catch { /* graceful */ }

  const patternContext = patterns?.length
    ? `\nREUSABLE PATTERNS:\n${patterns
        .map(
          (p: any) =>
            `- ${p.pattern_name}: ${p.description}\n  Nodes: ${(p.node_sequence ?? []).join(" → ")}\n  Tools: ${(p.common_tools ?? []).join(", ")}`,
        )
        .join("\n")}`
    : "";

  const prompt = `Generate a structured workflow DRAFT for the following request. This is a draft only — do NOT deploy.

REQUEST: ${opts.description}
CATEGORY: ${opts.category}
${patternContext}
${knowledgeContext ? `\nKNOWLEDGE:\n${knowledgeContext}` : ""}

Return a JSON object (ONLY valid JSON, no markdown):
{
  "title": "string",
  "nodes": [
    { "id": "string", "type": "conversation|function|call_transfer|end", "name": "string", "description": "string", "instruction": "string" }
  ],
  "edges": [
    { "from": "node-id", "to": "node-id", "condition": "string" }
  ],
  "variables": [
    { "name": "string", "type": "string", "description": "string", "example": "string" }
  ],
  "tools": [
    { "name": "string", "description": "string", "required_params": ["string"] }
  ],
  "webhook_suggestions": [
    { "name": "string", "purpose": "string", "endpoint_pattern": "string" }
  ],
  "kb_suggestions": ["string"],
  "follow_up_suggestions": ["string"]
}

Keep it practical and minimal (5-10 nodes).`;

  const raw = await gptMini(
    apiKey,
    [
      { role: "system", content: "Workflow architect. Return ONLY valid JSON." },
      { role: "user", content: prompt },
    ],
    2000,
  );

  let parsed: any = { title: opts.description, nodes: [], edges: [], variables: [], tools: [] };
  try {
    parsed = JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim());
  } catch { /* use default */ }

  const { data: draft, error } = await sb
    .from("systemmind_workflow_drafts")
    .insert({
      workspace_id: workspaceId,
      title: parsed.title ?? opts.description,
      description: opts.description,
      category: opts.category,
      status: "draft",
      nodes: parsed.nodes ?? [],
      edges: parsed.edges ?? [],
      variables: parsed.variables ?? [],
      tools: parsed.tools ?? [],
      webhook_suggestions: parsed.webhook_suggestions ?? [],
      kb_suggestions: parsed.kb_suggestions ?? [],
      follow_up_suggestions: parsed.follow_up_suggestions ?? [],
      generated_by: "systemmind",
      source_patterns: (patterns ?? []).map((p: any) => p.id).filter(Boolean),
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to save draft: ${error.message}`);
  return { draftId: draft.id, draft: parsed };
}

// ── 4. Workflow repair analysis ────────────────────────────────────────────────
export type RepairIssue = {
  type: string;
  nodeId?: string;
  edgeId?: string;
  problem: string;
  impact: string;
  suggestedFix: string;
  confidence: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  rollbackPlan: string;
};

export async function analyzeWorkflowRepair(
  workspaceId: string,
  agentId: string,
  apiKey: string,
): Promise<{ agentName: string; issues: RepairIssue[]; summary: string; requiresApproval: boolean }> {
  const sb = supabaseAdmin as any;

  const { data: agent, error } = await sb
    .from("agents")
    .select("id, name, agent_type, voice_provider, flow_data, settings, variables")
    .eq("id", agentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !agent) throw new Error("Agent not found or access denied.");

  const flow = analyzeFlow(agent.flow_data);
  const nodes = flow.nodes;
  const edges = flow.edges;
  const issues: RepairIssue[] = [];

  // Build edge maps
  const incomingCount = new Map<string, number>();
  const outgoingCount = new Map<string, number>();
  for (const n of nodes) { incomingCount.set(n.id, 0); outgoingCount.set(n.id, 0); }
  for (const e of edges) {
    incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1);
    outgoingCount.set(e.source, (outgoingCount.get(e.source) ?? 0) + 1);
  }

  // Check: missing / multiple start nodes
  const startNodes = nodes.filter(
    (n) => (incomingCount.get(n.id) ?? 0) === 0 && String(n.type ?? "").toLowerCase() !== "end",
  );
  if (nodes.length > 1 && startNodes.length === 0) {
    issues.push({
      type: "missing_start_node",
      problem: "No entry point found — every node has at least one incoming edge, creating a loop.",
      impact: "The workflow will never start. The voice provider cannot determine where to begin.",
      suggestedFix: "Designate the first conversation node as the start by removing any edges that point to it.",
      confidence: 95,
      riskLevel: "critical",
      rollbackPlan: "Re-add the removed edge if the fix causes other issues.",
    });
  }
  if (startNodes.length > 1) {
    issues.push({
      type: "multiple_start_nodes",
      problem: `${startNodes.length} nodes have no incoming edges — ambiguous entry point.`,
      impact: "Provider may pick the wrong entry node or fail to initialise the session.",
      suggestedFix: `Connect all orphan nodes. Only one node should have zero incoming edges. IDs: ${startNodes.map((n) => n.id).join(", ")}`,
      confidence: 80,
      riskLevel: "high",
      rollbackPlan: "Remove added edges if the flow behaviour changes unexpectedly.",
    });
  }

  // Check: missing end node
  const endNodes = nodes.filter((n) => (outgoingCount.get(n.id) ?? 0) === 0);
  if (endNodes.length === 0 && nodes.length > 0) {
    issues.push({
      type: "missing_end_node",
      problem: "No terminal node — every node has at least one outgoing edge.",
      impact: "The call may loop indefinitely or not terminate cleanly.",
      suggestedFix: "Add an 'end' node and connect the final conversation node to it.",
      confidence: 90,
      riskLevel: "high",
      rollbackPlan: "Remove the end node if the flow requires indefinite session behaviour.",
    });
  }

  // Check: disconnected nodes (no incoming AND no outgoing)
  const disconnected = nodes.filter(
    (n) =>
      (incomingCount.get(n.id) ?? 0) === 0 &&
      (outgoingCount.get(n.id) ?? 0) === 0 &&
      nodes.length > 1,
  );
  for (const n of disconnected) {
    issues.push({
      type: "disconnected_node",
      nodeId: n.id,
      problem: `Node "${n.id}" (type: ${n.type ?? "unknown"}) is completely disconnected — no edges in or out.`,
      impact: "This node is unreachable and will never execute. It confuses the AI and wastes resources.",
      suggestedFix: "Connect this node into the flow or delete it if it is no longer needed.",
      confidence: 99,
      riskLevel: "medium",
      rollbackPlan: "Restore the deleted node from agent version history if needed.",
    });
  }

  // Check: webhook nodes with empty URL
  for (const n of nodes) {
    const data = n.data ?? {};
    const ntype = String(n.type ?? "").toLowerCase();
    if (
      (ntype.includes("webhook") || data.webhookUrl !== undefined) &&
      !data.webhookUrl &&
      !data.webhook_url
    ) {
      issues.push({
        type: "missing_webhook_url",
        nodeId: n.id,
        problem: `Webhook node "${n.id}" has no URL configured.`,
        impact: "The webhook call will fail silently, breaking any flow branch that depends on it.",
        suggestedFix: "Set the webhookUrl property on this node to the correct endpoint URL.",
        confidence: 95,
        riskLevel: "high",
        rollbackPlan: "Clear the URL again if the endpoint changes or is not ready.",
      });
    }
  }

  // Check: call transfer nodes with no phone number
  for (const n of nodes) {
    const data = n.data ?? {};
    const ntype = String(n.type ?? "").toLowerCase();
    if (
      ntype.includes("transfer") &&
      !data.transferNumber &&
      !data.transfer_number &&
      !data.phoneNumber
    ) {
      issues.push({
        type: "missing_transfer_number",
        nodeId: n.id,
        problem: `Call transfer node "${n.id}" has no phone number configured.`,
        impact: "The transfer will fail, causing a call drop or hang.",
        suggestedFix: "Set the transferNumber field to a valid E.164 phone number (e.g. +12025551234).",
        confidence: 95,
        riskLevel: "high",
        rollbackPlan: "Remove the transfer node if a valid number cannot be sourced.",
      });
    }
  }

  // Check: function nodes missing tool ID
  for (const n of nodes) {
    const data = n.data ?? {};
    if (String(n.type ?? "") === "function" && !data.toolId && !data.tool_id) {
      issues.push({
        type: "missing_tool_id",
        nodeId: n.id,
        problem: `Function node "${n.id}" has no toolId — no tool definition is attached.`,
        impact: "The function call will fail; the AI has no tool to invoke.",
        suggestedFix: "Attach a tool definition to this node via the Builder function panel.",
        confidence: 90,
        riskLevel: "high",
        rollbackPlan: "Remove the function node if no suitable tool is available.",
      });
    }
  }

  // Check: broken edge handles
  const nodeTransitionMap = new Map<string, Set<string>>();
  for (const n of nodes) {
    const handles = new Set<string>();
    const data = n.data ?? {};
    if (Array.isArray(data.transitions)) {
      for (const t of data.transitions) if (t.id) handles.add(String(t.id));
    }
    if (Array.isArray(data.edges)) {
      for (const e of data.edges) if (e.id) handles.add(String(e.id));
    }
    nodeTransitionMap.set(n.id, handles);
  }
  for (const e of edges) {
    if (!e.sourceHandle || e.sourceHandle.startsWith("__")) continue;
    const srcHandles = nodeTransitionMap.get(e.source);
    if (srcHandles && srcHandles.size > 0 && !srcHandles.has(e.sourceHandle)) {
      issues.push({
        type: "broken_edge_handle",
        edgeId: e.id,
        problem: `Edge "${e.id}" references handle "${e.sourceHandle}" on node "${e.source}" which no longer exists.`,
        impact: "This transition may never fire, creating a dead path in the workflow.",
        suggestedFix:
          "Re-draw this connection from the correct transition handle in the Builder canvas.",
        confidence: 75,
        riskLevel: "medium",
        rollbackPlan: "Delete the edge and re-connect manually if the source node transitions change.",
      });
    }
  }

  const requiresApproval = issues.some(
    (i) => i.riskLevel === "critical" || i.riskLevel === "high",
  );

  // AI-enhanced summary
  let aiSummary = "";
  try {
    if (!apiKey) throw new Error("no key");
    const issueLines =
      issues.length > 0
        ? issues.map((i) => `- [${i.riskLevel.toUpperCase()}] ${i.type}: ${i.problem}`).join("\n")
        : "No structural issues detected.";
    const prompt = `SystemMind CTO reviewing workflow "${agent.name}" (${agent.agent_type ?? "unknown"}, ${agent.voice_provider ?? "unknown"}).
${nodes.length} nodes, ${edges.length} edges. Node types: ${flow.nodeTypes.join(", ")}.
${issueLines}
Write a concise 3-5 sentence technical assessment: overall health, biggest risk, ONE most important fix. Direct and specific.`;
    aiSummary = await gptMini(
      apiKey,
      [
        { role: "system", content: "Concise technical reviewer. 3-5 sentences only." },
        { role: "user", content: prompt },
      ],
      300,
    );
  } catch {
    aiSummary =
      issues.length === 0
        ? `"${agent.name}" passed all structural checks. No immediate repairs required.`
        : `"${agent.name}" has ${issues.length} issue(s) requiring attention. Review the findings below.`;
  }

  return { agentName: agent.name, issues, summary: aiSummary, requiresApproval };
}

// ── 5. Multi-source knowledge query ───────────────────────────────────────────
export async function querySystemMindKnowledgeContext(
  workspaceId: string,
  query: string,
  apiKey?: string,
): Promise<string> {
  const sb = supabaseAdmin as any;
  const parts: string[] = [];

  // Source 1: Executive KB RAG (semantic embeddings)
  try {
    const { getRetrievedKnowledgeBlock } = await import(
      "@/lib/executives/executive-knowledge.server"
    );
    const block = await getRetrievedKnowledgeBlock({
      workspaceId,
      mindType: "systemmind",
      query,
      topK: 4,
      ...(apiKey ? { apiKey } : {}),
    });
    if (block) parts.push(block);
  } catch { /* graceful */ }

  // Source 2: Relevant repair playbooks (keyword)
  try {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);
    if (terms.length > 0) {
      const { data: playbooks } = await sb
        .from("systemmind_repair_playbooks")
        .select("problem, fix_steps, risk_level")
        .eq("workspace_id", workspaceId)
        .or(terms.map((t: string) => `problem.ilike.%${t}%`).join(","))
        .limit(3);
      if (playbooks?.length) {
        parts.push(
          "## Relevant Repair Playbooks\n" +
            playbooks
              .map(
                (p: any) =>
                  `• [${p.risk_level.toUpperCase()}] ${p.problem}\n  Fix: ${(p.fix_steps ?? []).slice(0, 2).join("; ")}`,
              )
              .join("\n"),
        );
      }
    }
  } catch { /* graceful */ }

  // Source 3: Relevant workflow patterns (keyword on description)
  try {
    const { data: patterns } = await sb
      .from("systemmind_workflow_patterns")
      .select("category, pattern_name, description, node_sequence, common_tools")
      .eq("workspace_id", workspaceId)
      .limit(3);
    if (patterns?.length) {
      parts.push(
        "## Workflow Patterns Available\n" +
          patterns
            .map((p: any) => `• ${p.pattern_name} (${p.category}): ${p.description}`)
            .join("\n"),
      );
    }
  } catch { /* graceful */ }

  return parts.join("\n\n");
}

// ── 6. Repair playbook seed data ──────────────────────────────────────────────
type PlaybookSeed = {
  key: string;
  category: "repair" | "provider";
  problem: string;
  symptoms: readonly string[];
  checks: readonly string[];
  fix_steps: readonly string[];
  affected_files: readonly string[];
  risk_level: "low" | "medium" | "high" | "critical";
  rollback_plan: string;
  provider: string | null;
};

const REPAIR_PLAYBOOKS_SEED: PlaybookSeed[] = [
  // ── Structural repair (12) ─────────────────────────────────────────────────
  {
    key: "broken-webhook",
    category: "repair",
    problem: "Broken Webhook — webhook node not receiving or sending data",
    symptoms: ["Webhook node shows error", "No data received at endpoint", "Flow stops at webhook step"],
    checks: [
      "Verify webhookUrl is set and reachable from the internet",
      "Check endpoint returns 200 within 5 seconds",
      "Confirm payload schema matches what the node sends",
      "Test with webhook.site before wiring live",
    ],
    fix_steps: [
      "Open the webhook node in Builder and check the URL field",
      "Paste the URL into a browser or Postman — confirm it responds",
      "Check the receiving server logs for incoming requests",
      "Set a fallback transition for webhook failures",
    ],
    affected_files: ["flow_data.nodes[webhookNode]"],
    risk_level: "high",
    rollback_plan: "Remove the webhook URL and set the fallback path as the primary transition.",
    provider: null,
  },
  {
    key: "missing-variable-mapping",
    category: "repair",
    problem: "Missing Variable Mapping — variable used in prompt but not defined in agent variables",
    symptoms: ["AI outputs literal {{variableName}} text", "Variable panel shows no entries", "Post-call data missing"],
    checks: [
      "Check all node prompts for {{variable}} references",
      "Compare against the Variables panel in Builder",
      "Verify variable type matches expected value (string vs number)",
    ],
    fix_steps: [
      "Open the Variables panel in Builder",
      "Add each missing variable with name, type, and clear description",
      "Re-test the flow to confirm variables populate correctly",
    ],
    affected_files: ["agents.variables", "flow_data.nodes[].data.prompt"],
    risk_level: "medium",
    rollback_plan: "Remove added variables if they cause unexpected post-call analysis changes.",
    provider: null,
  },
  {
    key: "disconnected-node",
    category: "repair",
    problem: "Disconnected Node — node exists in Builder but has no connections",
    symptoms: ["Node appears on canvas with no lines", "SystemMind audit flags it", "AI skips the expected step"],
    checks: [
      "Open Builder and visually inspect all nodes",
      "Run SystemMind Workflow Inspect to confirm disconnected node IDs",
      "Check whether the node was intentionally removed or accidentally orphaned",
    ],
    fix_steps: [
      "If needed: draw an edge from the correct source node to this node",
      "If obsolete: delete it from the canvas",
      "Re-test the complete flow from start to end",
    ],
    affected_files: ["flow_data.nodes", "flow_data.edges"],
    risk_level: "medium",
    rollback_plan: "Use browser history or a saved agent version to restore deleted nodes.",
    provider: null,
  },
  {
    key: "missing-start-node",
    category: "repair",
    problem: "Missing Start Node — no node is designated as the entry point",
    symptoms: ["Provider cannot initialise the call", "Flow never starts", "Console shows 'no start node'"],
    checks: [
      "Check that exactly one node has zero incoming edges",
      "Confirm the first node is a conversation node (not function or transfer)",
      "Verify flow_data.nodes array is not empty",
    ],
    fix_steps: [
      "Identify the opening greeting node",
      "Delete any edges that point to it",
      "Ensure it has at least one outgoing transition",
      "Re-deploy the agent after the fix",
    ],
    affected_files: ["flow_data.nodes", "flow_data.edges"],
    risk_level: "critical",
    rollback_plan: "Restore the deleted edge from agent version history.",
    provider: null,
  },
  {
    key: "missing-end-node",
    category: "repair",
    problem: "Missing End Node — the flow has no terminal step",
    symptoms: ["Call loops indefinitely", "Provider does not hang up cleanly", "No end-of-call webhook fires"],
    checks: [
      "Verify at least one node has zero outgoing edges",
      "Check that an 'end' type node exists in Builder",
      "Confirm the final conversation node connects to the end node",
    ],
    fix_steps: [
      "Add an 'end' node from the Builder node palette",
      "Connect the final conversation node to the end node",
      "Set any post-call data extraction on the end node",
      "Re-deploy and test a full call run",
    ],
    affected_files: ["flow_data.nodes", "flow_data.edges"],
    risk_level: "high",
    rollback_plan: "Remove the end node if the flow requires an indefinite session.",
    provider: null,
  },
  {
    key: "openai-tool-schema-mismatch",
    category: "repair",
    problem: "OpenAI Tool Schema Mismatch — function node tool definition is invalid or incomplete",
    symptoms: ["OpenAI returns 400 on tool call", "AI ignores the tool", "Tool call never fires"],
    checks: [
      "Verify tool definition has: name, description, parameters (JSON Schema object)",
      "Check all required parameters are listed in the 'required' array",
      "Confirm parameter types are valid JSON Schema types",
      "Validate schema at jsonschema.dev",
    ],
    fix_steps: [
      "Open the function node in Builder",
      "Check the tool JSON — ensure parameters.type is 'object'",
      "Add all required fields to the 'required' array",
      "Remove unsupported schema keywords (e.g. 'default' at root level)",
    ],
    affected_files: ["flow_data.nodes[functionNode].data.toolDefinition"],
    risk_level: "high",
    rollback_plan: "Revert to the last working tool schema from agent history.",
    provider: "OPENAI_REALTIME",
  },
  {
    key: "retell-shows-disconnected",
    category: "repair",
    problem: "Retell Shows Disconnected — agent in Retell dashboard shows as inactive",
    symptoms: ["Retell dashboard shows inactive status", "Calls fail to route", "No retell_agent_id on agent row"],
    checks: [
      "Verify RETELL_API_KEY or workspace retell_workspace_id is set",
      "Check the agent row has a valid retell_agent_id",
      "Confirm Retell API is reachable from the server",
      "Look for 401/403 errors in server logs",
    ],
    fix_steps: [
      "Go to Settings → Integrations and confirm Retell API key",
      "Re-deploy the agent from the Builder deploy button",
      "If retell_agent_id is missing, deploy the agent first",
      "Check Retell dashboard to confirm 'active' status",
    ],
    affected_files: ["agents.retell_agent_id", "workspace_settings.retell_workspace_id"],
    risk_level: "high",
    rollback_plan: "Re-deploy with the previous agent configuration if the new deployment fails.",
    provider: "RETELL",
  },
  {
    key: "calcom-booking-fails",
    category: "repair",
    problem: "Cal.com Booking Fails — booking tool cannot create or retrieve calendar slots",
    symptoms: ["Booking node returns error", "AI says 'no available slots'", "No booking record created"],
    checks: [
      "Verify calcom_api_key is set in Settings → Integrations",
      "Check the event type ID in the booking tool definition",
      "Confirm the Cal.com account has available slots in the configured time zone",
    ],
    fix_steps: [
      "Add or refresh the Cal.com API key in Settings → Integrations",
      "Verify the event type ID matches a live Cal.com event",
      "Check the time zone setting in Cal.com matches the expected region",
      "Re-test with a live call or Builder test mode",
    ],
    affected_files: ["workspace_settings.calcom_api_key", "flow_data.nodes[bookingNode].data.toolId"],
    risk_level: "medium",
    rollback_plan: "Replace the booking node with a 'collect contact info' node until Cal.com is configured.",
    provider: "CALCOM",
  },
  {
    key: "whatsapp-webhook-fails",
    category: "repair",
    problem: "WhatsApp Webhook Fails — incoming WhatsApp messages not received by the agent",
    symptoms: ["Messages sent but agent does not respond", "No inbound webhook events in logs", "WATI/Meta shows undelivered"],
    checks: [
      "Verify webhook URL is registered in WATI or Meta developer portal",
      "Confirm the webhook URL is publicly accessible (not localhost)",
      "Check the verify token matches platform configuration",
      "Look for 4xx/5xx responses in webhook logs",
    ],
    fix_steps: [
      "Go to Settings → Integrations → WhatsApp and verify WATI connector is active",
      "Register the webhook URL in your WATI/Meta account",
      "Test the webhook with a manual POST to /api/webhooks/whatsapp",
      "Confirm the agent has channelType: whatsapp in its settings",
    ],
    affected_files: ["workspace_settings.whatsapp_phone_id", "src/server.ts"],
    risk_level: "high",
    rollback_plan: "Disable the WhatsApp channel on the agent until the webhook is restored.",
    provider: "WHATSAPP",
  },
  {
    key: "knowledge-base-not-attached",
    category: "repair",
    problem: "Knowledge Base Not Attached — agent has a KB node but no knowledge base selected",
    symptoms: ["AI gives generic responses instead of KB-grounded ones", "KB node appears empty in Builder", "No document retrieval in call logs"],
    checks: [
      "Open the KB node — check if a knowledge base is selected",
      "Verify the knowledge base has indexed documents (Knowledge Centre → status)",
      "Confirm the KB is in 'indexed' status, not 'pending' or 'failed'",
    ],
    fix_steps: [
      "Open the KB node and select the correct knowledge base from the dropdown",
      "If no KBs exist, go to Knowledge Centre and upload documents first",
      "Wait for documents to reach 'indexed' status before testing",
      "Re-deploy the agent after attaching the KB",
    ],
    affected_files: ["flow_data.nodes[kbNode].data.knowledgeBaseId", "executive_documents.embedding_status"],
    risk_level: "medium",
    rollback_plan: "Remove the KB node if no knowledge base can be attached in the short term.",
    provider: null,
  },
  {
    key: "hyperstream-call-not-logged",
    category: "repair",
    problem: "HyperStream Call Not Logged — voice calls complete but no call record appears",
    symptoms: ["Call list shows no new entries", "Session ends but provider_usage not updated", "No post-call webhook fired"],
    checks: [
      "Check server logs for /api/hyperstream/webhook errors during call",
      "Verify HyperStream relay is running and connected",
      "Confirm provider_usage table receives inserts after calls",
      "Look for CORS or auth errors in browser console during the call",
    ],
    fix_steps: [
      "Restart the HyperStream relay (restart the 'Start application' workflow)",
      "Check call logging middleware in src/server.ts is active",
      "Confirm the 5s ping/pong mechanism is working in the browser client",
      "Re-test with a fresh call and monitor server logs in real time",
    ],
    affected_files: ["src/lib/hyperstream/hyperstream-relay.ts", "src/server.ts"],
    risk_level: "medium",
    rollback_plan: "Fall back to Retell provider if HyperStream relay issues persist.",
    provider: "HYPERSTREAM",
  },
  {
    key: "voxstream-tool-call-fails",
    category: "repair",
    problem: "VoxStream Tool Call Fails — VoxStream session invokes a tool but receives an error",
    symptoms: ["Tool call response not received", "AI skips the tool step", "VoxStream session drops after tool invocation"],
    checks: [
      "Verify the tool definition schema is valid (see openai-tool-schema-mismatch playbook)",
      "Check that the tool endpoint returns valid JSON within the session timeout",
      "Confirm VoxStream session.init includes the tools array",
    ],
    fix_steps: [
      "Test the tool endpoint independently before wiring to VoxStream",
      "Ensure the tool response matches the expected schema format",
      "Add the tool to the session.init tools array if missing",
      "Set a fallback response for tool errors in the session config",
    ],
    affected_files: ["src/lib/providers/voxstream/", "flow_data.nodes[functionNode].data.toolDefinition"],
    risk_level: "high",
    rollback_plan: "Disable the tool call and route to a fallback conversation node temporarily.",
    provider: "VOXSTREAM",
  },
  // ── Provider playbooks (10) ────────────────────────────────────────────────
  {
    key: "provider-retell",
    category: "provider",
    problem: "Retell Provider — setup, agent deployment, and call routing",
    symptoms: ["Retell not appearing in providers", "API key rejected", "Agents not deploying to Retell"],
    checks: [
      "Verify RETELL_API_KEY env var or workspace retell_workspace_id",
      "Confirm Retell account has available concurrent call slots",
      "Check network connectivity to api.retellai.com",
    ],
    fix_steps: [
      "Add Retell API key in Settings → Integrations",
      "Deploy a test agent using the Builder deploy panel",
      "Monitor the Retell dashboard for agent status",
      "Configure voice_provider: RETELL on agents needing Retell routing",
    ],
    affected_files: ["workspace_settings.retell_workspace_id", "agents.retell_agent_id"],
    risk_level: "medium",
    rollback_plan: "Switch agent voice_provider to OPENAI_REALTIME if Retell is unavailable.",
    provider: "RETELL",
  },
  {
    key: "provider-hyperstream",
    category: "provider",
    problem: "HyperStream Real-Time Audio Relay — setup and troubleshooting",
    symptoms: ["Voice sessions failing to connect", "Audio choppy or silent", "WebSocket closes immediately"],
    checks: [
      "Confirm ELEVENLABS_API_KEY and OPENAI_API_KEY are set",
      "Verify the HyperStream relay Vite plugin is active in dev",
      "Check browser sends audio at 24kHz (resampled via AudioWorklet)",
      "Monitor WebSocket ping/pong — browser must ping every 5s",
    ],
    fix_steps: [
      "Restart the application workflow",
      "Confirm the AudioWorklet resampler is initialised before sending audio",
      "Check HyperStream relay logs for connection errors",
      "Verify the model name matches the OpenAI Realtime model format",
    ],
    affected_files: ["src/lib/hyperstream/hyperstream-relay.ts"],
    risk_level: "high",
    rollback_plan: "Disable HyperStream and use ElevenLabs REST TTS as a fallback.",
    provider: "HYPERSTREAM",
  },
  {
    key: "provider-voxstream",
    category: "provider",
    problem: "VoxStream Voice Provider — setup and session management",
    symptoms: ["VoxStream sessions not starting", "Tool calls failing", "Session drops after init"],
    checks: [
      "Verify VoxStream API credentials are set",
      "Check session.init payload includes agent_id and tools",
      "Confirm network allows WebSocket connections to VoxStream endpoint",
    ],
    fix_steps: [
      "Configure VoxStream credentials in Settings → Integrations",
      "Use Builder test mode to validate the session.init flow",
      "Ensure all tool definitions are included in the session payload",
    ],
    affected_files: ["src/lib/providers/voxstream/"],
    risk_level: "medium",
    rollback_plan: "Fall back to Retell or HyperStream for voice calls.",
    provider: "VOXSTREAM",
  },
  {
    key: "provider-openai-tool-calling",
    category: "provider",
    problem: "OpenAI Tool Calling — function definitions and response mapping",
    symptoms: ["AI does not invoke tools", "Tool schema validation errors", "Partial tool responses"],
    checks: [
      "Validate each tool's JSON schema at jsonschema.dev",
      "Ensure parameters.type is 'object' with 'properties' defined",
      "Confirm tool names are unique and contain no spaces",
      "Verify tool responses are parsed and mapped back to variables",
    ],
    fix_steps: [
      "Use the Builder function panel to define tool schemas",
      "Add a 'required' array listing all mandatory parameters",
      "Test with the OpenAI Playground before deploying to production",
      "Map tool responses to agent variables using the response mapping panel",
    ],
    affected_files: ["flow_data.nodes[functionNode].data.toolDefinition"],
    risk_level: "medium",
    rollback_plan: "Simplify the tool schema to only essential parameters if validation fails.",
    provider: "OPENAI_REALTIME",
  },
  {
    key: "provider-calcom",
    category: "provider",
    problem: "Cal.com Calendar Integration — API setup and event type configuration",
    symptoms: ["No available slots returned", "Booking creation fails", "Invalid event type error"],
    checks: [
      "Verify calcom_api_key is set in workspace_settings",
      "Confirm the event type ID is correct and the event is active",
      "Check the time zone matches the user's region",
    ],
    fix_steps: [
      "Add the Cal.com API key in Settings → Integrations",
      "Find the eventTypeId in Cal.com dashboard → Event Types",
      "Set the eventTypeId in the booking node tool definition",
      "Run a test booking via Builder test mode",
    ],
    affected_files: ["workspace_settings.calcom_api_key", "flow_data.nodes[bookingNode]"],
    risk_level: "low",
    rollback_plan: "Replace the booking node with a 'collect contact info' node until Cal.com is configured.",
    provider: "CALCOM",
  },
  {
    key: "provider-whatsapp",
    category: "provider",
    problem: "WhatsApp Channel — WATI / Meta setup and webhook registration",
    symptoms: ["Messages sent but not received by agent", "Webhook not verified", "Template messages rejected"],
    checks: [
      "Verify whatsapp_phone_id and WATI connector are set",
      "Confirm webhook is registered and verified in WATI/Meta portal",
      "Check that message templates are approved for outbound use",
    ],
    fix_steps: [
      "Configure the WATI connector in Settings → Integrations",
      "Register the webhook URL in WATI: /api/webhooks/whatsapp",
      "Set agents with channelType: whatsapp in their settings",
      "Use approved message templates for outbound WhatsApp messages",
    ],
    affected_files: ["workspace_settings.whatsapp_phone_id", "src/server.ts"],
    risk_level: "medium",
    rollback_plan: "Disable WhatsApp channel and use voice-only agents until connector is fixed.",
    provider: "WHATSAPP",
  },
  {
    key: "provider-twilio",
    category: "provider",
    problem: "Twilio Telephony — SID/token setup and TwiML webhook configuration",
    symptoms: ["Twilio calls not routing to agents", "Auth errors in logs", "Phone number not verified"],
    checks: [
      "Verify twilio_account_sid and twilio_auth_token in workspace_settings",
      "Confirm the Twilio phone number is active and verified",
      "Check TwiML webhook is correctly set on the Twilio phone number",
    ],
    fix_steps: [
      "Add Twilio credentials in Settings → Integrations",
      "In Twilio console, set the webhook URL on your phone number to the platform's Twilio endpoint",
      "Test with an inbound call to the Twilio number",
      "Monitor Twilio console for webhook delivery status",
    ],
    affected_files: ["workspace_settings.twilio_account_sid", "workspace_settings.twilio_auth_token"],
    risk_level: "medium",
    rollback_plan: "Remove Twilio webhook and revert to direct SIP if Twilio routing fails.",
    provider: "TWILIO",
  },
  {
    key: "provider-frejun",
    category: "provider",
    problem: "FreJun SIP/Cloud Telephony — credentials and SIP trunk setup",
    symptoms: ["FreJun calls not connecting", "SIP registration failing", "Call audio not passing through"],
    checks: [
      "Verify FreJun API credentials are set in workspace_settings",
      "Confirm SIP trunk is configured with the correct host/port",
      "Check network allows SIP protocol on port 5060/5061",
    ],
    fix_steps: [
      "Add FreJun API key and SIP credentials in Settings → Integrations",
      "Configure SIP trunk in FreJun dashboard pointing to the platform's SIP endpoint",
      "Test connectivity with SIP OPTIONS ping",
      "Route inbound DID numbers to the SIP trunk",
    ],
    affected_files: ["workspace_settings (frejun fields)"],
    risk_level: "medium",
    rollback_plan: "Switch to Twilio or Retell telephony if FreJun SIP cannot be established.",
    provider: "FREJUN",
  },
  {
    key: "provider-growthmind-integration",
    category: "provider",
    problem: "GrowthMind ↔ SystemMind Data Integration — executive council reporting",
    symptoms: ["GrowthMind data missing from HiveMind briefing", "Marketing council summary empty", "Cross-executive summary failing"],
    checks: [
      "Verify buildGrowthMindExecutiveSummary returns data",
      "Check workspace has GrowthMind data (leads, campaigns, goals)",
      "Confirm executive bridge server imports from correct paths",
    ],
    fix_steps: [
      "Seed GrowthMind with initial data via Goals and Campaigns pages",
      "Check executive-bridge.server.ts for import errors",
      "Restart the application workflow to clear any stale module cache",
      "Verify GrowthMind score calculation has the required DB tables",
    ],
    affected_files: ["src/lib/executives/executive-bridge.server.ts", "src/lib/growthmind/growthmind.functions.ts"],
    risk_level: "low",
    rollback_plan: "Remove GrowthMind context from HiveMind briefing temporarily if the bridge fails.",
    provider: "GROWTHMIND",
  },
  {
    key: "provider-hivemind-integration",
    category: "provider",
    problem: "HiveMind Action Approval Centre — repair plan submission and SystemMind reporting",
    symptoms: ["Repair plans not appearing in HiveMind Actions", "HiveMind not reporting SystemMind findings", "Action approval loop broken"],
    checks: [
      "Verify hivemind_actions table schema (migration 20260622000001 applied)",
      "Check that SystemMind repair plans are being submitted to the actions table",
      "Confirm HiveMind Actions page reads from hivemind_actions with workspace_id filter",
    ],
    fix_steps: [
      "Apply migration 20260622000001 in Supabase if not already done",
      "Submit a repair plan from SystemMind → Workflows → Inspect Agent",
      "Go to HiveMind → Actions to review and approve/reject",
      "Confirm SystemMind executive summary includes workflowLibraryCount in HiveMind's context",
    ],
    affected_files: ["src/lib/hivemind/hivemind.ai.ts", "src/lib/executives/executive-bridge.server.ts"],
    risk_level: "low",
    rollback_plan: "Manage repair approvals manually outside the platform until the Actions integration is verified.",
    provider: "HIVEMIND",
  },
];

export async function seedRepairPlaybooks(
  workspaceId: string,
): Promise<{ seeded: number; total: number }> {
  const sb = supabaseAdmin as any;

  const keys = REPAIR_PLAYBOOKS_SEED.map((p) => p.key);
  const { data: existing } = await sb
    .from("systemmind_repair_playbooks")
    .select("playbook_key")
    .eq("workspace_id", workspaceId)
    .in("playbook_key", keys);

  const existingKeys = new Set((existing ?? []).map((r: any) => r.playbook_key));
  const toInsert = REPAIR_PLAYBOOKS_SEED.filter((p) => !existingKeys.has(p.key));

  if (toInsert.length === 0) return { seeded: 0, total: REPAIR_PLAYBOOKS_SEED.length };

  const rows = toInsert.map((p) => ({
    workspace_id: workspaceId,
    playbook_key: p.key,
    category: p.category,
    problem: p.problem,
    symptoms: p.symptoms as string[],
    checks: p.checks as string[],
    fix_steps: p.fix_steps as string[],
    affected_files: p.affected_files as string[],
    risk_level: p.risk_level,
    rollback_plan: p.rollback_plan,
    provider: p.provider,
  }));

  const { error } = await sb.from("systemmind_repair_playbooks").insert(rows);
  if (error) throw new Error(`Playbook seeding failed: ${error.message}`);

  return { seeded: toInsert.length, total: REPAIR_PLAYBOOKS_SEED.length };
}
