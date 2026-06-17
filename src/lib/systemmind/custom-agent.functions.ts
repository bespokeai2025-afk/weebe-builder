// ── Custom Agent Workflow Generator + Deployment Configurator ─────────────────
// SERVER FUNCTIONS for the "Custom" agent type in Builder.
//
// Option A: generateCustomWorkflow  — generates nodes/edges from description
// Option B: analyzeScript           — analyzes existing script → deployment config
//
// Supporting:
//   saveCustomAgentConfig         — upsert to custom_agent_configs
//   getCustomAgentConfig          — read config for an agent
//   createAdminChangeRequest      — log a billable capability gap
//   adminListChangeRequests       — admin read of all change requests
//   adminUpdateChangeRequest      — admin update status/notes/billing

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin");
  if (!data || data.length === 0) throw new Error("Forbidden");
}

// ── OpenAI mini helper (local, server-only) ───────────────────────────────────
async function gptMini(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1200,
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      max_tokens: maxTokens,
      temperature: 0.35,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI error ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  return (json.choices?.[0]?.message?.content as string) ?? "";
}

function parseJson(raw: string, fallback: any = {}): any {
  try {
    return JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    return fallback;
  }
}

// ── A: Generate workflow draft from description ────────────────────────────────
export const generateCustomWorkflowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context, data }: any) => {
    const { description, category = "custom" } = data as {
      description: string;
      category?: string;
    };
    const { supabase, workspaceId } = context as any;

    // Pull OpenAI key from workspace settings
    const { data: ws } = await supabase
      .from("workspace_settings")
      .select("openai_api_key")
      .eq("workspace_id", workspaceId)
      .single();
    const apiKey = ws?.openai_api_key ?? process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) throw new Error("No OpenAI API key configured. Add one in Settings → AI.");

    // Dynamic import to keep server-only code isolated
    const { generateWorkflowDraft } = await import("./systemmind-workflow.server");
    const result = await generateWorkflowDraft(workspaceId, { description, category }, apiKey);

    // Log to executive_events via bridge
    try {
      const { insertExecutiveEvent } = await import("@/lib/executives/executive-bridge.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await insertExecutiveEvent(supabaseAdmin as any, workspaceId, {
        source: "systemmind",
        event_type: "custom_workflow_requested",
        summary: `Custom workflow draft generated: "${description.slice(0, 80)}"`,
        severity: "info",
      });
    } catch { /* non-fatal */ }

    return result;
  });

// ── B: Analyze script for deployment configuration ────────────────────────────
export const analyzeScriptFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context, data }: any) => {
    const {
      scriptText,
      crmMode = "webee",
      extractionHints = "",
      webhookSpec = "",
      agentTitle = "Custom Agent",
    } = data as {
      scriptText: string;
      crmMode: string;
      extractionHints?: string;
      webhookSpec?: string;
      agentTitle?: string;
    };

    const { supabase, workspaceId } = context as any;

    const { data: ws } = await supabase
      .from("workspace_settings")
      .select("openai_api_key")
      .eq("workspace_id", workspaceId)
      .single();
    const apiKey = ws?.openai_api_key ?? process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) throw new Error("No OpenAI API key configured. Add one in Settings → AI.");

    const prompt = `You are an expert AI voice agent deployment configurator. Analyze the provided script and generate a complete deployment configuration JSON.

SCRIPT / TRANSCRIPT:
${scriptText.slice(0, 8000)}

CRM MODE: ${crmMode}
${extractionHints ? `EXTRACTION HINTS: ${extractionHints}` : ""}
${webhookSpec ? `WEBHOOK SPEC: ${webhookSpec}` : ""}

Return ONLY valid JSON (no markdown, no comments):
{
  "agent_summary": "2-3 sentence description of what this agent does",
  "deployment_readiness_score": 0-100,
  "required_variables": [
    { "name": "str", "type": "string|number|boolean", "description": "str", "example": "str", "required": true }
  ],
  "extraction_fields": [
    { "field_name": "str", "display_name": "str", "type": "string|number|boolean|enum", "description": "str", "example": "str", "priority": "high|medium|low", "extract_after": "which node/step to extract after" }
  ],
  "outcome_schema": [
    { "outcome_id": "str", "label": "str", "description": "str", "maps_to_status": "str", "color": "green|yellow|red|blue", "disposition": "success|failure|follow_up|transfer" }
  ],
  "crm_field_mapping": {
    "standard": { "name": "field_name_in_script", "email": "field_name", "phone": "field_name" },
    "custom": [ { "webee_field": "str", "crm_field": "str", "transform": "str or null" } ]
  },
  "calendar_mapping": {
    "trigger_outcome_ids": ["outcome_id"],
    "cal_event_type": "str",
    "attendee_email_field": "str",
    "attendee_name_field": "str"
  },
  "webhook_payload_schema": {
    "url_placeholder": "https://your-endpoint.com/webhook",
    "method": "POST",
    "headers": { "Content-Type": "application/json" },
    "payload": { "fields": [ { "key": "str", "source_field": "str", "type": "str" } ] }
  },
  "required_tools": [
    { "tool_name": "str", "purpose": "str", "available_in_builder": true, "required_params": ["str"] }
  ],
  "missing_capabilities": [
    { "capability": "str", "why_needed": "str", "workaround": "str or null", "requires_admin_request": true }
  ],
  "go_live_checklist": [
    { "id": "str", "category": "provider|crm|webhook|extraction|general", "item": "str", "required": true, "completed": false }
  ],
  "deployment_config": {
    "suggested_agent_type": "receptionist|lead_generation|client_qualification|custom",
    "suggested_voice": "str",
    "language": "en-US",
    "estimated_call_duration_mins": 3,
    "key_behaviors": ["str"]
  }
}

Be thorough and practical. Identify ALL data points mentioned in the script for extraction. Readiness score 85+ means ready to deploy, 50-84 needs work, below 50 has gaps.`;

    const raw = await gptMini(
      apiKey,
      [
        { role: "system", content: "Deployment configurator. Return ONLY valid JSON." },
        { role: "user", content: prompt },
      ],
      3000,
    );

    const parsed = parseJson(raw, {
      agent_summary: "Custom agent",
      deployment_readiness_score: 0,
      required_variables: [],
      extraction_fields: [],
      outcome_schema: [],
      crm_field_mapping: {},
      calendar_mapping: {},
      webhook_payload_schema: {},
      required_tools: [],
      missing_capabilities: [],
      go_live_checklist: [],
      deployment_config: { suggested_agent_type: "custom" },
    });

    // Log to executive events
    try {
      const { insertExecutiveEvent } = await import("@/lib/executives/executive-bridge.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await insertExecutiveEvent(supabaseAdmin as any, workspaceId, {
        source: "systemmind",
        event_type: "script_config_requested",
        summary: `Script deployment analysis complete. Readiness: ${parsed.deployment_readiness_score ?? 0}%. Agent: "${agentTitle}"`,
        severity: "info",
      });
    } catch { /* non-fatal */ }

    // Auto-create admin change requests for missing capabilities that require one
    try {
      const caps = (parsed.missing_capabilities ?? []).filter((c: any) => c.requires_admin_request);
      if (caps.length > 0) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const rows = caps.map((c: any) => ({
          workspace_id: workspaceId,
          request_type: "custom_tool",
          title: c.capability,
          missing_capability: c.capability,
          technical_summary: c.why_needed,
          status: "open",
          billing_status: "pending_quote",
          billable: true,
        }));
        await (supabaseAdmin as any).from("admin_change_requests").insert(rows);
      }
    } catch { /* non-fatal */ }

    return { config: parsed };
  });

// ── Save / upsert custom agent config ─────────────────────────────────────────
export const saveCustomAgentConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context, data }: any) => {
    const { agentId, title, config, crm_mode, source_script, existingId } = data as {
      agentId?: string;
      title: string;
      config: any;
      crm_mode: string;
      source_script?: string;
      existingId?: string;
    };
    const { supabase, workspaceId } = context as any;

    const payload = {
      workspace_id: workspaceId,
      agent_id: agentId ?? null,
      title,
      crm_mode,
      source_script: source_script ?? null,
      deployment_readiness_score: config.deployment_readiness_score ?? 0,
      agent_summary: config.agent_summary ?? null,
      required_variables: config.required_variables ?? [],
      extraction_fields: config.extraction_fields ?? [],
      outcome_schema: config.outcome_schema ?? [],
      crm_field_mapping: config.crm_field_mapping ?? {},
      calendar_mapping: config.calendar_mapping ?? {},
      webhook_payload_schema: config.webhook_payload_schema ?? {},
      required_tools: config.required_tools ?? [],
      missing_capabilities: config.missing_capabilities ?? [],
      go_live_checklist: config.go_live_checklist ?? [],
      deployment_config: config.deployment_config ?? {},
      updated_at: new Date().toISOString(),
    };

    if (existingId) {
      const { data: row, error } = await supabase
        .from("custom_agent_configs")
        .update(payload)
        .eq("id", existingId)
        .eq("workspace_id", workspaceId)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: row.id };
    }

    const { data: row, error } = await supabase
      .from("custom_agent_configs")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

// ── Get custom agent config for an agent ──────────────────────────────────────
export const getCustomAgentConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context, data }: any) => {
    const { agentId } = data as { agentId: string };
    const { supabase, workspaceId } = context as any;

    const { data: row } = await supabase
      .from("custom_agent_configs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return { config: row ?? null };
  });

// ── Create admin change request ────────────────────────────────────────────────
export const createAdminChangeRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context, data }: any) => {
    const {
      requestType,
      title,
      missingCapability,
      technicalSummary,
      estimatedEffort,
      agentId,
      configId,
    } = data as {
      requestType: string;
      title: string;
      missingCapability?: string;
      technicalSummary?: string;
      estimatedEffort?: string;
      agentId?: string;
      configId?: string;
    };
    const { supabase, workspaceId } = context as any;

    const { data: user } = await supabase.auth.getUser();
    const userId = user?.user?.id ?? null;

    const { data: row, error } = await supabase
      .from("admin_change_requests")
      .insert({
        workspace_id: workspaceId,
        requested_by: userId,
        source_agent_id: agentId ?? null,
        source_config_id: configId ?? null,
        request_type: requestType,
        title,
        missing_capability: missingCapability ?? null,
        technical_summary: technicalSummary ?? null,
        estimated_effort: estimatedEffort ?? null,
        status: "open",
        billing_status: "pending_quote",
        billable: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Emit HiveMind event
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const existing = await (supabaseAdmin as any)
        .from("hivemind_events")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("trigger_type", "admin_change_request")
        .gte("created_at", new Date(Date.now() - 86400000).toISOString())
        .maybeSingle();
      if (!existing?.data) {
        await (supabaseAdmin as any).from("hivemind_events").insert({
          workspace_id: workspaceId,
          trigger_type: "admin_change_request",
          severity: "warning",
          priority: 6,
          title: "Admin Change Request",
          description: `New billable change request: "${title}"`,
          metadata: { request_id: row.id, type: requestType },
        });
      }
    } catch { /* non-fatal */ }

    return { id: row.id };
  });

// ── Admin: list all change requests ───────────────────────────────────────────
export const adminListChangeRequestsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context, data }: any) => {
    const { status } = (data ?? {}) as { status?: string };
    const { supabase } = context as any;
    const { data: authUser } = await supabase.auth.getUser();
    await assertAdmin(authUser?.user?.id ?? "");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = (supabaseAdmin as any)
      .from("admin_change_requests")
      .select(
        "id, workspace_id, request_type, title, missing_capability, technical_summary, estimated_effort, billable, billing_status, quote_amount_pence, status, admin_notes, created_at, updated_at, workspaces(name)",
      )
      .order("created_at", { ascending: false });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { requests: rows ?? [] };
  });

// ── Admin: update change request ──────────────────────────────────────────────
export const adminUpdateChangeRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context, data }: any) => {
    const { id, status, billingStatus, quoteAmountPence, adminNotes } = data as {
      id: string;
      status?: string;
      billingStatus?: string;
      quoteAmountPence?: number;
      adminNotes?: string;
    };
    const { supabase } = context as any;
    const { data: user } = await supabase.auth.getUser();
    await assertAdmin(user?.user?.id ?? "");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const updates: any = { updated_at: new Date().toISOString() };
    if (status) updates.status = status;
    if (billingStatus) updates.billing_status = billingStatus;
    if (quoteAmountPence !== undefined) updates.quote_amount_pence = quoteAmountPence;
    if (adminNotes !== undefined) updates.admin_notes = adminNotes;
    if (status === "resolved" || status === "declined") {
      updates.reviewed_by = user?.user?.id ?? null;
      updates.reviewed_at = new Date().toISOString();
    }

    const { error } = await (supabaseAdmin as any)
      .from("admin_change_requests")
      .update(updates)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
