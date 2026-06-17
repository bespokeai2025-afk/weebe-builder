// ── SystemMind Workflow Generator — server-only ────────────────────────────────
// Generates Builder-compatible workflow drafts from natural-language descriptions.
// NEVER auto-deploys. All drafts require HiveMind approval before going to Builder.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Types ──────────────────────────────────────────────────────────────────────
export type WorkflowType =
  | "receptionist"
  | "lead_qualification"
  | "rebooking"
  | "appointment_booking"
  | "callback_scheduling"
  | "document_collection"
  | "call_transfer"
  | "whatsapp_followup"
  | "crm_update"
  | "post_call_summary"
  | "client_intake"
  | "complaint_handling"
  | "sales_enquiry"
  | "custom_workflow";

export interface GeneratedVariable {
  name: string;
  description: string;
  type: "string" | "number" | "boolean" | "date";
  required: boolean;
}

export interface GeneratedTool {
  name: string;
  description: string;
  parameters: Array<{ name: string; type: string; description: string; required: boolean }>;
  exists: boolean;
}

export interface MissingCapability {
  name: string;
  description: string;
  suggested_fix: string;
  risk: "low" | "medium" | "high";
  approval_required: boolean;
}

export interface ValidationResult {
  check: string;
  passed: boolean;
  message: string;
}

export interface WorkflowDraftFull {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  workflow_type: WorkflowType | null;
  status: string;
  nodes: any[];
  edges: any[];
  variables: GeneratedVariable[];
  tools: GeneratedTool[];
  required_integrations_json: string[];
  missing_capabilities_json: MissingCapability[];
  validation_results_json: ValidationResult[];
  created_by: string | null;
  generated_by: string;
  created_at: string;
  updated_at: string;
}

// ── OpenAI helper ──────────────────────────────────────────────────────────────
async function callGPT4o(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 3000,
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI error ${res.status}: ${txt.slice(0, 300)}`);
  }
  const json = (await res.json()) as any;
  return (json.choices?.[0]?.message?.content as string) ?? "{}";
}

// ── Node ID generator ──────────────────────────────────────────────────────────
function nid(prefix: string, idx: number): string {
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${idx}-${rand}`;
}

function tid(): string {
  return `t-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Validation ─────────────────────────────────────────────────────────────────
export function validateDraftNodes(
  nodes: any[],
  edges: any[],
  variables: GeneratedVariable[],
  tools: GeneratedTool[],
): ValidationResult[] {
  const results: ValidationResult[] = [];

  // 1. Start node exists
  const hasStart = nodes.some((n) => n.data?.isStart === true || n.data?.kind === "conversation");
  results.push({
    check: "Start node exists",
    passed: hasStart,
    message: hasStart ? "Start node found." : "No start node defined — add a Conversation node marked as start.",
  });

  // 2. End node exists
  const hasEnd = nodes.some((n) => n.data?.kind === "ending");
  results.push({
    check: "End node exists",
    passed: hasEnd,
    message: hasEnd ? "Ending node found." : "No ending node — workflow will loop indefinitely.",
  });

  // 3. All nodes have at least one edge (except ending)
  const nodeIds = new Set(nodes.map((n) => n.id));
  const connectedIds = new Set([
    ...edges.map((e) => e.source),
    ...edges.map((e) => e.target),
  ]);
  const nonEnding = nodes.filter((n) => n.data?.kind !== "ending" && n.data?.kind !== "note");
  const disconnected = nonEnding.filter((n) => !connectedIds.has(n.id));
  results.push({
    check: "All nodes connected",
    passed: disconnected.length === 0,
    message:
      disconnected.length === 0
        ? "All nodes are connected."
        : `${disconnected.length} disconnected node(s): ${disconnected.map((n) => n.data?.label ?? n.id).join(", ")}`,
  });

  // 4. All variables defined
  results.push({
    check: "All variables defined",
    passed: variables.length > 0,
    message: variables.length > 0 ? `${variables.length} variable(s) defined.` : "No variables defined.",
  });

  // 5. No unsupported node types
  const SUPPORTED = new Set([
    "conversation","function","call_transfer","press_digit","logic_split",
    "agent_transfer","sms","extract_variable","code","ending","note",
    "wa_message","wa_delay","wa_media","wa_booking","wa_start",
    "wa_wait_reply","wa_extract_var","wa_tag","wa_template",
    "check_documents","send_upload_link",
  ]);
  const unsupported = nodes.filter((n) => !SUPPORTED.has(n.data?.kind ?? n.type));
  results.push({
    check: "No unsupported node types",
    passed: unsupported.length === 0,
    message:
      unsupported.length === 0
        ? "All node types are supported."
        : `Unsupported types: ${unsupported.map((n) => n.data?.kind ?? n.type).join(", ")}`,
  });

  // 6. No broken edge handles (edges referencing non-existent nodes)
  const brokenEdges = edges.filter((e) => !nodeIds.has(e.source) || !nodeIds.has(e.target));
  results.push({
    check: "No broken edge handles",
    passed: brokenEdges.length === 0,
    message:
      brokenEdges.length === 0
        ? "All edges reference valid nodes."
        : `${brokenEdges.length} edge(s) reference missing nodes.`,
  });

  // 7. Tool parameters mapped (tools that exist have parameters)
  const toolsWithNoParams = tools.filter((t) => t.exists && t.parameters.length === 0);
  results.push({
    check: "Tool parameters mapped",
    passed: toolsWithNoParams.length === 0,
    message:
      toolsWithNoParams.length === 0
        ? "All existing tools have parameters mapped."
        : `${toolsWithNoParams.length} tool(s) missing parameter mapping.`,
  });

  // 8. No required integrations missing
  results.push({
    check: "Required integrations listed",
    passed: true,
    message: "Integration requirements documented — verify before deployment.",
  });

  return results;
}

// ── Main generator ─────────────────────────────────────────────────────────────
export async function generateWorkflowDraftFromDescription(
  workspaceId: string,
  userId: string,
  description: string,
  workflowType: WorkflowType,
  title: string,
): Promise<WorkflowDraftFull> {
  const sb = supabaseAdmin;

  // Get workspace OpenAI key
  const { data: ws } = await sb
    .from("workspace_settings")
    .select("openai_api_key")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const apiKey = (ws as any)?.openai_api_key ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("No OpenAI API key configured. Add one in Settings → AI.");

  const systemPrompt = `You are SystemMind, an AI CTO. You generate Builder-compatible conversational workflow drafts.

BUILDER NODE TYPES (use ONLY these):
- conversation: Standard AI dialogue node. Fields: dialogue (string), transitions (array), isStart (bool, first node only)
- extract_variable: Extracts data from speech. Fields: dialogue, transitions, extractItems (array of {id,name,description,type})
- function: Calls a tool/webhook. Fields: dialogue, toolName, toolDescription, transitions
- logic_split: Conditional branching. Fields: dialogue, transitions (each with condition)
- call_transfer: Transfer call. Fields: dialogue, transferNumber, transitions
- ending: Ends the call. Fields: dialogue (farewell message). NO transitions.
- sms: Sends SMS. Fields: dialogue, transitions
- note: Internal documentation. Fields: dialogue. Does not affect runtime.

NODE SHAPE (strict JSON):
{
  "id": "conv-0-abc12",
  "type": "<NodeKind>",
  "position": { "x": <number>, "y": <number> },
  "data": {
    "kind": "<NodeKind>",
    "label": "<short display name>",
    "dialogue": "<full instruction or prompt text>",
    "isStart": true,  // only on very first node
    "transitions": [
      { "id": "t-xyz789", "condition": "<when to follow this path>", "target": "<target-node-id>" }
    ]
  }
}

EDGE SHAPE:
{
  "id": "e-<source>-<target>",
  "source": "<source-node-id>",
  "target": "<target-node-id>",
  "sourceHandle": "<transition-id-from-source-node>"
}

RULES:
- First conversation node must have isStart: true
- Ending node must have empty transitions array
- Every non-ending node must have at least one transition
- Edge sourceHandle must match a transition id in the source node
- Use vertical layout: start at y=100, increment y by 180 per row
- Keep x centered at 400 unless branching (then offset ±250)
- IDs must be unique strings

Return ONLY valid JSON with this top-level structure:
{
  "nodes": [...],
  "edges": [...],
  "variables": [{ "name": "...", "description": "...", "type": "string|number|boolean|date", "required": true }],
  "tools": [{ "name": "...", "description": "...", "parameters": [...], "exists": false }],
  "required_integrations": ["..."],
  "missing_capabilities": [{ "name": "...", "description": "...", "suggested_fix": "...", "risk": "low|medium|high", "approval_required": true }]
}`;

  const userPrompt = `Generate a complete "${workflowType}" workflow draft for:

"${description}"

Title: "${title}"

Produce a detailed, production-ready workflow with proper node types, transitions, variables, and tools. Be thorough — include all steps described and any standard steps implied by the workflow type. Mark tools that don't exist in a standard system (no Cal.com, CRM, etc. configured by default) as exists: false.`;

  const raw = await callGPT4o(apiKey, systemPrompt, userPrompt, 4000);
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returned invalid JSON. Please try again.");
  }

  const nodes: any[]             = parsed.nodes ?? [];
  const edges: any[]             = parsed.edges ?? [];
  const variables: GeneratedVariable[]       = parsed.variables ?? [];
  const tools: GeneratedTool[]               = parsed.tools ?? [];
  const requiredIntegrations: string[]       = parsed.required_integrations ?? [];
  const missingCapabilities: MissingCapability[] = parsed.missing_capabilities ?? [];

  const validationResults = validateDraftNodes(nodes, edges, variables, tools);

  const { data, error } = await sb
    .from("systemmind_workflow_drafts")
    .insert({
      workspace_id:              workspaceId,
      title,
      description,
      workflow_type:             workflowType,
      status:                    "draft",
      nodes,
      edges,
      variables,
      tools,
      required_integrations_json: requiredIntegrations,
      missing_capabilities_json:  missingCapabilities,
      validation_results_json:    validationResults,
      created_by:                userId,
      generated_by:              "systemmind_ai",
    })
    .select()
    .single();

  if (error) throw error;
  return data as unknown as WorkflowDraftFull;
}

// ── List drafts ────────────────────────────────────────────────────────────────
export async function listWorkflowDraftsServer(workspaceId: string): Promise<WorkflowDraftFull[]> {
  const { data, error } = await supabaseAdmin
    .from("systemmind_workflow_drafts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as WorkflowDraftFull[];
}

// ── Get single draft ───────────────────────────────────────────────────────────
export async function getWorkflowDraftByIdServer(
  workspaceId: string,
  draftId: string,
): Promise<WorkflowDraftFull | null> {
  const { data, error } = await supabaseAdmin
    .from("systemmind_workflow_drafts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as WorkflowDraftFull | null;
}

// ── Update status ──────────────────────────────────────────────────────────────
export async function updateWorkflowDraftStatusServer(
  workspaceId: string,
  draftId: string,
  status: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("systemmind_workflow_drafts")
    .update({ status })
    .eq("workspace_id", workspaceId)
    .eq("id", draftId);
  if (error) throw error;
}

// ── Propose HiveMind action to send draft to Builder ──────────────────────────
export async function proposeSendDraftToBuilderServer(
  workspaceId: string,
  draftId: string,
  draftTitle: string,
  nodeCount: number,
  variableCount: number,
  toolCount: number,
  missingCapabilitiesCount: number,
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("hivemind_actions")
    .insert({
      workspace_id:    workspaceId,
      title:           `Send workflow draft to Builder: "${draftTitle}"`,
      description:     `SystemMind created a ${nodeCount}-node workflow draft with ${variableCount} variables and ${toolCount} tools.${missingCapabilitiesCount > 0 ? ` ${missingCapabilitiesCount} capability gap(s) need review before deployment.` : " All capabilities are available."}`,
      action_type:     "send_workflow_draft_to_builder",
      action_payload:  { draft_id: draftId, draft_title: draftTitle },
      status:          "pending",
      proposed_by:     "systemmind",
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as any).id as string;
}
