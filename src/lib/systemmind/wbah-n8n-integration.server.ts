/**
 * WBAH n8n ↔ SystemMind integration — server-only seed + build session helpers.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";
import {
  WBAH_N8N_WORKFLOW_ID,
  WBAH_N8N_WEBHOOK_URL,
  WBAH_TEMPLATE_SYSTEMMIND_NAME,
  WBAH_WEBEE_RETELL_WEBHOOK_URL,
  buildWbahNewLeadsCallScriptConfig,
  buildWbahNewLeadsSystemMindConfig,
  buildWbahN8nManualUnderstanding,
  buildWbahN8nStructureSnapshot,
} from "@/lib/systemmind/wbah-n8n-integration.shared";

export type WbahN8nIntegrationStatus = {
  workspaceId: string;
  n8nWorkflowRegistered: boolean;
  n8nWorkflowRowId: string | null;
  systemmindTemplateId: string | null;
  systemmindTemplateStatus: string | null;
  lastBuildSessionId: string | null;
  n8nApiConfigured: boolean;
  callScriptConfig: ReturnType<typeof buildWbahNewLeadsCallScriptConfig>;
  migration: {
    webeeWebhookUrl: string;
    executionEnabled: boolean;
    dynamicsConfigured: boolean;
    calendlyConfigured: boolean;
    readyForCutover: boolean;
  };
};

async function upsertN8nDiscoveryRow(workspaceId: string): Promise<string> {
  const sb = supabaseAdmin as any;
  const understanding = buildWbahN8nManualUnderstanding();
  const structure = buildWbahN8nStructureSnapshot();
  const now = new Date().toISOString();

  const row = {
    workspace_id: workspaceId,
    n8n_workflow_id: WBAH_N8N_WORKFLOW_ID,
    name: "WBAH Retell Post-Call (CALLBACK SUPPORT)",
    active: true,
    folder: "WBAH Production",
    tags: ["wbah", "retell", "dynamics", "calendly"],
    trigger_types: ["webhook"],
    node_count: structure.nodes.length,
    connection_count: structure.edges.length,
    node_types: [...new Set(structure.nodes.map((n) => n.type))],
    integrations: ["Retell", "Dynamics 365", "Calendly", "WeeBespoke", "WEBEE"],
    has_webhook: true,
    metadata: {
      webhook_url: WBAH_N8N_WEBHOOK_URL,
      branches: understanding.branches,
      source: "manual_wbah_seed",
    },
    raw_snapshot: { structure, seeded: true },
    understanding,
    confidence: understanding.confidence,
    ai_model: "manual",
    understood_at: now,
    template_type: "customer_specific",
    workflow_category: "Client Qualification",
    classification: {
      type: "customer_specific",
      category: "Client Qualification",
      reasoning: "Production WBAH post-call pipeline registered from known n8n topology.",
      signals: ["wbah", "retell", "dynamics"],
      confidence: 95,
      auto: false,
      snapshot_updated_at: now,
    },
    classified_at: now,
    updated_at: now,
  };

  const { data, error } = await sb
    .from("systemmind_n8n_workflows")
    .upsert(row, { onConflict: "workspace_id,n8n_workflow_id" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

async function upsertSystemMindTemplate(
  workspaceId: string,
  userId: string | null,
  n8nRowId: string,
): Promise<string> {
  const sb = supabaseAdmin as any;
  const understanding = buildWbahN8nManualUnderstanding();
  const structure = buildWbahN8nStructureSnapshot();
  const script = buildWbahNewLeadsCallScriptConfig();
  const now = new Date().toISOString();

  const { data: existing } = await sb
    .from("systemmind_workflow_templates")
    .select("id, current_version")
    .eq("workspace_id", workspaceId)
    .eq("name", WBAH_TEMPLATE_SYSTEMMIND_NAME)
    .maybeSingle();

  const payload = {
    workspace_id: workspaceId,
    name: WBAH_TEMPLATE_SYSTEMMIND_NAME,
    description: understanding.business_summary,
    business_purpose: understanding.purpose,
    category: "Client Qualification",
    template_type: "customer_specific",
    status: "approved",
    is_trusted: true,
    confidence: 95,
    readiness: "ready",
    risk_rating: "medium",
    known_limitations: [
      "Execution remains in n8n — WEBEE documents and builds the call script only.",
      "Dynamics PATCH is not replicated in WEBEE workflow executor for WBAH.",
    ],
    supported_agent_providers: ["retell"],
    supported_crm_providers: ["dynamics", "webhook"],
    supported_calendar_providers: ["calendly"],
    supported_telephony_providers: ["retell"],
    supported_messaging_providers: [],
    required_apis: ["n8n", "dynamics", "calendly", "webespoke"],
    required_credentials: [
      "n8n_production_webhook",
      "dynamics_oauth",
      "calendly_api_token",
      "webespoke_uat",
    ],
    deployment_variables: [
      {
        key: "n8n_webhook_url",
        name: "n8n Retell Webhook URL",
        type: "url",
        category: "webhook",
        description: "Retell agent webhook_url — production post-call receiver.",
        example: "https://bespoke.app.n8n.cloud/webhook/…",
        required: true,
        source: "Retell agent config",
      },
      {
        key: "calendly_event_type",
        name: "Calendly Event Type ID",
        type: "string",
        category: "endpoint",
        description: "Calendly event type for scheduling links.",
        example: "EBGJSBH4HVGLYFN6",
        required: true,
        source: "n8n Create Booking Link node",
      },
    ],
    business_summary: understanding.business_summary,
    technical_summary: understanding.technical_summary,
    dependencies: ["Retell", "n8n yR3vAIdZNLovD8jx", "Dynamics 365", "WeeBespoke UAT"],
    linked_n8n_workflow_ids: [n8nRowId],
    linked_builder_template_ids: [script.global_template_id],
    linked_retell_agent_ids: script.dialer_agents.map((a) => a.retellAgentId),
    structure,
    tags: ["wbah", "new-leads", "n8n", "dynamics", "calendly"],
    source_kind: "manual",
    updated_at: now,
    approved_at: now,
    approved_by: userId,
  };

  if (existing?.id) {
    const { data, error } = await sb
      .from("systemmind_workflow_templates")
      .update(payload)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return String(data.id);
  }

  const { data, error } = await sb
    .from("systemmind_workflow_templates")
    .insert({ ...payload, created_by: userId, current_version: 1 })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

export async function getWbahN8nIntegrationStatusServer(
  workspaceId: string,
): Promise<WbahN8nIntegrationStatus> {
  const sb = supabaseAdmin as any;
  const { isN8nConfigured } = await import("@/lib/systemmind/n8n-client.server");

  const { data: n8nRow } = await sb
    .from("systemmind_n8n_workflows")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("n8n_workflow_id", WBAH_N8N_WORKFLOW_ID)
    .maybeSingle();

  const { data: tpl } = await sb
    .from("systemmind_workflow_templates")
    .select("id, status")
    .eq("workspace_id", workspaceId)
    .eq("name", WBAH_TEMPLATE_SYSTEMMIND_NAME)
    .maybeSingle();

  const { data: session } = await sb
    .from("systemmind_build_sessions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("title", "%WBAH New Leads%n8n%")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { getWbahPostCallReadiness } = await import("@/lib/wbah/post-call/wbah-post-call.server");
  const readiness = getWbahPostCallReadiness();

  return {
    workspaceId,
    n8nWorkflowRegistered: !!n8nRow?.id,
    n8nWorkflowRowId: n8nRow?.id ?? null,
    systemmindTemplateId: tpl?.id ?? null,
    systemmindTemplateStatus: tpl?.status ?? null,
    lastBuildSessionId: session?.id ?? null,
    n8nApiConfigured: isN8nConfigured(),
    callScriptConfig: buildWbahNewLeadsCallScriptConfig(),
    migration: {
      webeeWebhookUrl: WBAH_WEBEE_RETELL_WEBHOOK_URL,
      executionEnabled: readiness.executionEnabled,
      dynamicsConfigured: readiness.dynamics,
      calendlyConfigured: readiness.calendly,
      readyForCutover:
        readiness.executionEnabled && readiness.dynamics && readiness.calendly,
    },
  };
}

export async function seedWbahN8nSystemMindIntegrationServer(args: {
  workspaceId: string;
  userId: string | null;
}): Promise<{
  n8nRowId: string;
  templateId: string;
  scannedLive: boolean;
}> {
  const { workspaceId, userId } = args;
  if (workspaceId !== WBAH_WORKSPACE_ID) {
    throw new Error("WBAH n8n integration seed is only available for the Webuyanyhouse workspace.");
  }

  let scannedLive = false;
  if ((await import("@/lib/systemmind/n8n-client.server")).isN8nConfigured()) {
    try {
      const { scanAndStoreN8nWorkflows } = await import(
        "@/lib/systemmind/n8n-discovery.server"
      );
      await scanAndStoreN8nWorkflows(workspaceId);
      scannedLive = true;
    } catch (e) {
      console.warn("[wbah-n8n] live n8n scan failed, using manual seed:", e);
    }
  }

  const n8nRowId = await upsertN8nDiscoveryRow(workspaceId);
  const templateId = await upsertSystemMindTemplate(workspaceId, userId, n8nRowId);

  return { n8nRowId, templateId, scannedLive };
}

export async function createWbahNewLeadsBuildSessionServer(args: {
  workspaceId: string;
  userId: string | null;
}): Promise<{ sessionId: string; versionId: string }> {
  const { workspaceId, userId } = args;
  if (workspaceId !== WBAH_WORKSPACE_ID) {
    throw new Error("WBAH New Leads build sessions are only for the Webuyanyhouse workspace.");
  }

  await seedWbahN8nSystemMindIntegrationServer({ workspaceId, userId });

  const { createBuildSessionFromConfigServer } = await import(
    "@/lib/systemmind/build-workspace.server"
  );
  const { validateConfigOrThrow } = await import("@/lib/systemmind/build-workspace.server");

  const rawConfig = buildWbahNewLeadsSystemMindConfig();
  const config = validateConfigOrThrow(rawConfig, "WBAH New Leads n8n config");

  return createBuildSessionFromConfigServer({
    workspaceId,
    userId,
    title: "WBAH New Leads Agent + n8n Post-Call",
    sourcePage: "systemmind",
    config,
    assistantSummary:
      "Pre-built SystemMind config for the WBAH New Leads dialer agent and its n8n post-call pipeline " +
      `(workflow ${WBAH_N8N_WORKFLOW_ID}). The call script comes from the Real estate Client Qualification ` +
      "global template. Post-call CRM, Calendly, and dashboard writes remain in n8n — use this session to " +
      "iterate the call script, extraction fields, and outcome rules before changing Retell or n8n.",
    systemNote:
      "Linked n8n workflow: yR3vAIdZNLovD8jx. Retell webhook must stay on n8n unless you are migrating. " +
      "Dialer agents: agent_a031 (WBAH New Leads Agent), agent_698b (WBAH New leads).",
  });
}

export async function saveWbahCallScriptAgentConfigServer(args: {
  workspaceId: string;
  userId: string | null;
  agentId?: string | null;
}): Promise<{ configId: string }> {
  const { workspaceId } = args;
  if (workspaceId !== WBAH_WORKSPACE_ID) {
    throw new Error("WBAH call script config is only for the Webuyanyhouse workspace.");
  }

  const sb = supabaseAdmin as any;
  const scriptConfig = buildWbahNewLeadsCallScriptConfig();
  const title = "WBAH New Leads — Call Script (n8n-linked)";

  const { data: existing } = await sb
    .from("custom_agent_configs")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("title", title)
    .maybeSingle();

  const row = {
    workspace_id: workspaceId,
    agent_id: args.agentId ?? null,
    title,
    crm_mode: "external_n8n",
    source_script: WBAH_TEMPLATE_SYSTEMMIND_NAME,
    status: "draft",
    deployment_readiness_score: scriptConfig.deployment_readiness_score,
    agent_summary: scriptConfig.agent_summary,
    required_variables: scriptConfig.required_variables,
    extraction_fields: scriptConfig.extraction_fields,
    outcome_schema: scriptConfig.outcome_schema,
    crm_field_mapping: scriptConfig.crm_field_mapping,
    webhook_payload_schema: scriptConfig.webhook_payload_schema,
    go_live_checklist: scriptConfig.go_live_checklist,
    deployment_config: {
      suggested_agent_type: scriptConfig.suggested_agent_type,
      retell_webhook_url: scriptConfig.retell_webhook_url,
      n8n_workflow_id: scriptConfig.n8n_workflow_id,
      global_template_id: scriptConfig.global_template_id,
      dialer_agents: scriptConfig.dialer_agents,
    },
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { data, error } = await sb
      .from("custom_agent_configs")
      .update(row)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { configId: String(data.id) };
  }

  const { data, error } = await sb.from("custom_agent_configs").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return { configId: String(data.id) };
}
