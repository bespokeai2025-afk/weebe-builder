/**
 * WBAH post-call workflow wizard — guided Q&A → SystemMind BuildConfig version.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";
import {
  buildWbahNewLeadsCallScriptConfig,
  buildWbahNewLeadsSystemMindConfig,
  WBAH_NEW_LEADS_AGENTS,
  WBAH_WEBEE_RETELL_WEBHOOK_URL,
} from "@/lib/systemmind/wbah-n8n-integration.shared";
import {
  createBuildSessionFromConfigServer,
  insertBuildVersionServer,
  validateConfigOrThrow,
  type BuildConfig,
} from "@/lib/systemmind/build-workspace.server";
import { buildConfigFromPipeline } from "@/lib/systemmind/wbah-workflow-copilot.server";
import {
  defaultWbahPostCallWorkflowConfig,
  emptyWbahPostCallWorkflowConfig,
  wbahStepsToFlowDefinition,
  WBAH_POST_CALL_STEP_CATALOG,
  type WbahPostCallWorkflowConfig,
} from "@/lib/wbah/workflow/wbah-workflow-steps.shared";

export type WbahWorkflowWizardQuestion = {
  id: string;
  prompt: string;
  help?: string;
  type: "text" | "boolean" | "multi_select";
  options?: Array<{ value: string; label: string }>;
  default?: string | boolean | string[];
  required?: boolean;
};

export type WbahWorkflowWizardState = {
  sessionId: string | null;
  questions: WbahWorkflowWizardQuestion[];
  answers: Record<string, string | boolean | string[]>;
  complete: boolean;
};

export function buildWbahWorkflowWizardQuestions(
  answers: Record<string, string | boolean | string[]> = {},
): WbahWorkflowWizardQuestion[] {
  return [
    {
      id: "workflow_name",
      prompt: "What should we call this post-call workflow?",
      help: "Shown in SystemMind Build and Workflows — e.g. WBAH New Leads Post-Call.",
      type: "text",
      default: "WBAH New Leads Post-Call",
      required: true,
    },
    {
      id: "retell_agents",
      prompt: "Which Retell dialer agents should use this workflow?",
      help: "Only matching agents will run this pipeline when a call completes.",
      type: "multi_select",
      options: WBAH_NEW_LEADS_AGENTS.map((a) => ({
        value: a.retellAgentId,
        label: a.label,
      })),
      default: WBAH_NEW_LEADS_AGENTS.map((a) => a.retellAgentId),
      required: true,
    },
    {
      id: "enable_dashboard",
      prompt: "Write call results to the WeeBespoke / UAT dashboard?",
      type: "boolean",
      default: true,
    },
    {
      id: "enable_calendly",
      prompt: "Create Calendly booking links when a slot is captured?",
      type: "boolean",
      default: true,
    },
    {
      id: "enable_calendly_invitee",
      prompt: "Auto-book Calendly invitee after confirmed appointment (n8n nodes 35–37)?",
      type: "boolean",
      default: true,
    },
    {
      id: "enable_dynamics_status",
      prompt: "Update Dynamics lead status (Allen's Logic — callback / logged / disqualified)?",
      type: "boolean",
      default: true,
    },
    {
      id: "enable_dynamics_property",
      prompt: "Update Dynamics property & contact fields from structured_json_output?",
      type: "boolean",
      default: true,
    },
    {
      id: "enable_calls_tab",
      prompt: "Upsert calls into the WEBEE Calls tab?",
      type: "boolean",
      default: true,
    },
    {
      id: "enable_live_transcript",
      prompt: "Stream live transcript to WEBEE during the call?",
      type: "boolean",
      default: (answers.enable_live_transcript as boolean | undefined) ?? true,
    },
    {
      id: "purpose",
      prompt: "Describe what this workflow should do (optional notes for your team).",
      type: "text",
      default: "",
    },
  ];
}

function answersToPipeline(answers: Record<string, string | boolean | string[]>): WbahPostCallWorkflowConfig {
  const base = defaultWbahPostCallWorkflowConfig({
    name: String(answers.workflow_name ?? "WBAH Post-Call").slice(0, 200),
    purpose: String(answers.purpose ?? "").slice(0, 2000),
    retell_agents: Array.isArray(answers.retell_agents)
      ? (answers.retell_agents as string[])
      : WBAH_NEW_LEADS_AGENTS.map((a) => a.retellAgentId),
  });

  const toggles: Record<string, boolean | undefined> = {
    live_transcript: answers.enable_live_transcript as boolean | undefined,
    dashboard_raw: answers.enable_dashboard as boolean | undefined,
    dashboard_analyzed: answers.enable_dashboard as boolean | undefined,
    calendly_link: answers.enable_calendly as boolean | undefined,
    calendly_invitee: answers.enable_calendly_invitee as boolean | undefined,
    dynamics_allens: answers.enable_dynamics_status as boolean | undefined,
    dynamics_agentic: answers.enable_dynamics_property as boolean | undefined,
    wbah_calls_upsert: answers.enable_calls_tab as boolean | undefined,
  };

  base.steps = base.steps.map((s) => ({
    ...s,
    enabled: toggles[s.id] ?? s.enabled,
  }));

  return base;
}

export function buildConfigFromWizardAnswers(
  answers: Record<string, string | boolean | string[]>,
): BuildConfig {
  const script = buildWbahNewLeadsCallScriptConfig();
  const wbahPipeline = answersToPipeline(answers);
  const flow = wbahStepsToFlowDefinition(wbahPipeline);
  const base = buildWbahNewLeadsSystemMindConfig();

  const config: BuildConfig = {
    ...base,
    workflow: {
      ...base.workflow,
      name: wbahPipeline.name,
      purpose: wbahPipeline.purpose || base.workflow.purpose,
      trigger_type: "call_completed",
      trigger_config: {
        ...(base.workflow.trigger_config as Record<string, unknown>),
        retell_agents: wbahPipeline.retell_agents,
        wbah_post_call: wbahPipeline,
      },
      steps: flow.steps as BuildConfig["workflow"]["steps"],
    },
    channel_setup: {
      ...(base.channel_setup as Record<string, unknown>),
      wbah_post_call: wbahPipeline,
    },
    extraction_fields: script.extraction_fields.map((f) => ({
      name: f.name,
      type: f.type,
      description: f.description,
    })),
    test_plan: [
      "Place a test call with lead_id in Retell dynamic variables.",
      "Confirm dashboard row in UAT for call_analyzed.",
      ...(wbahPipeline.steps.find((s) => s.id === "dynamics_allens" && s.enabled)
        ? ["Verify Dynamics new_currentstatus updated (Allen's Logic)."]
        : []),
      ...(wbahPipeline.steps.find((s) => s.id === "dynamics_agentic" && s.enabled)
        ? ["Verify Dynamics property fields (street, bedrooms, etc.) updated."]
        : []),
      "Apply workflow in SystemMind Build and activate after test passes.",
    ],
  };

  return validateConfigOrThrow(config, "WBAH workflow wizard");
}

/** Minimal build config for a brand-new blank workflow (no pre-loaded n8n graph). */
export function buildEmptyWbahPostCallBuildConfig(
  overrides: { name?: string } = {},
): BuildConfig {
  const wbahPipeline = emptyWbahPostCallWorkflowConfig({
    name: overrides.name ?? "Untitled workflow",
    workflow_kind: "general",
  });
  const flow = wbahStepsToFlowDefinition(wbahPipeline);

  const config: BuildConfig = {
    agent_prompt: "",
    workflow: {
      name: wbahPipeline.name,
      purpose: "",
      trigger_type: "call_completed",
      trigger_config: {
        external_orchestrator: "webee",
        webee_webhook_url: WBAH_WEBEE_RETELL_WEBHOOK_URL,
        retell_agents: [],
        wbah_post_call: wbahPipeline,
      },
      steps: flow.steps as BuildConfig["workflow"]["steps"],
      n8n_graph: wbahPipeline.n8n_graph,
    },
    variables: [],
    extraction_fields: [],
    follow_up_rules: [],
    channel_setup: {
      wbah_post_call: wbahPipeline,
    },
    required_credentials: [],
    risks: [],
    test_plan: ["Add steps on the canvas, save, run a test call, then Apply and activate."],
  };

  return validateConfigOrThrow(config, "WBAH empty workflow");
}

/** Full production template — all n8n nodes, wires, and executor steps. */
export function buildTemplateWbahPostCallBuildConfig(): BuildConfig {
  const wbahPipeline = defaultWbahPostCallWorkflowConfig({
    name: "WBAH New Leads Post-Call",
    purpose: "Production WBAH post-call template (n8n yR3vAIdZNLovD8jx replacement).",
    retell_agents: WBAH_NEW_LEADS_AGENTS.map((a) => a.retellAgentId),
  });
  const graph = wbahPipeline.n8n_graph!;
  return buildConfigFromPipeline(wbahPipeline, {
    nodes: graph.nodes.map((n) => ({ id: n.id, position: n.position })),
    edges: graph.edges,
  });
}

export type WbahWorkflowStartMode = "blank" | "template";

export async function startWbahWorkflowWizardServer(args: {
  workspaceId: string;
  userId: string | null;
  mode?: WbahWorkflowStartMode;
}): Promise<WbahWorkflowWizardState> {
  if (args.workspaceId !== WBAH_WORKSPACE_ID) {
    throw new Error("WBAH workflow wizard is only for the Webuyanyhouse workspace.");
  }

  const mode = args.mode ?? "blank";

  if (mode === "blank") {
    const { sessionId } = await createBuildSessionFromConfigServer({
      workspaceId: args.workspaceId,
      userId: args.userId,
      title: "Post-Call — Untitled",
      sourcePage: "wbah_workflow_wizard",
      config: buildEmptyWbahPostCallBuildConfig(),
      assistantSummary: "Blank post-call workflow. Add steps from the canvas or copilot.",
      systemNote: `Webhook: ${WBAH_WEBEE_RETELL_WEBHOOK_URL}. Configure steps, save, test, then Apply + activate.`,
    });

    return {
      sessionId,
      questions: buildWbahWorkflowWizardQuestions(),
      answers: {},
      complete: false,
    };
  }

  const questions = buildWbahWorkflowWizardQuestions();
  const defaults = Object.fromEntries(
    questions.map((q) => [q.id, q.default ?? (q.type === "boolean" ? false : "")]),
  );

  const { sessionId } = await createBuildSessionFromConfigServer({
    workspaceId: args.workspaceId,
    userId: args.userId,
    title: "Post-Call — WBAH New Leads",
    sourcePage: "wbah_workflow_wizard",
    config: buildTemplateWbahPostCallBuildConfig(),
    assistantSummary:
      "Production WBAH post-call template — full n8n graph (~40 nodes) and all executor steps enabled.",
    systemNote: `Webhook: ${WBAH_WEBEE_RETELL_WEBHOOK_URL}. Edit, save, test, then Apply + activate.`,
  });

  return {
    sessionId,
    questions,
    answers: defaults,
    complete: false,
  };
}

export async function saveWbahWorkflowFromAnswersServer(args: {
  workspaceId: string;
  userId: string | null;
  sessionId: string;
  answers: Record<string, string | boolean | string[]>;
}): Promise<{
  versionId: string;
  pipelineName: string;
  enabledStepCount: number;
  enabledSteps: string[];
}> {
  if (args.workspaceId !== WBAH_WORKSPACE_ID) {
    throw new Error("WBAH workflow wizard is only for the Webuyanyhouse workspace.");
  }

  const config = buildConfigFromWizardAnswers(args.answers);
  const pipeline = (config.channel_setup as Record<string, unknown>)
    .wbah_post_call as WbahPostCallWorkflowConfig;

  const { versionId } = await insertBuildVersionServer({
    workspaceId: args.workspaceId,
    userId: args.userId,
    sessionId: args.sessionId,
    userPrompt: `WBAH workflow wizard save: ${pipeline.name}`,
    summary: `Saved post-call workflow with ${pipeline.steps.filter((s) => s.enabled).length} enabled step(s): ${pipeline.steps.filter((s) => s.enabled).map((s) => s.title ?? s.id).join(", ")}.`,
    config,
  });

  return {
    versionId,
    pipelineName: pipeline.name,
    enabledStepCount: pipeline.steps.filter((s) => s.enabled).length,
    enabledSteps: pipeline.steps.filter((s) => s.enabled).map((s) => s.title ?? s.id),
  };
}

export async function activateWbahWorkflowServer(args: {
  workspaceId: string;
  userId: string | null;
  workflowId: string;
}): Promise<{ ok: boolean }> {
  if (args.workspaceId !== WBAH_WORKSPACE_ID) {
    throw new Error("Only Webuyanyhouse workspace.");
  }

  const sb = supabaseAdmin as any;
  const { getTestGateForSessionServer } = await import(
    "@/lib/systemmind/build-workspace-testcall.server"
  );

  const { data: wf } = await sb
    .from("workspace_workflows")
    .select("id, source_build_session_id, name")
    .eq("id", args.workflowId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!wf) throw new Error("Workflow not found.");

  if (wf.source_build_session_id) {
    const { data: version } = await sb
      .from("systemmind_build_versions")
      .select("id")
      .eq("session_id", wf.source_build_session_id)
      .in("status", ["applied", "deployed"])
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (version?.id) {
      const gate = await getTestGateForSessionServer({
        workspaceId: args.workspaceId,
        sessionId: wf.source_build_session_id,
        versionId: version.id,
      });
      if (gate.status !== "passed") {
        throw new Error(
          "Test call must pass before activating this workflow. Run a test from SystemMind Build → Test tab.",
        );
      }
    }
  }

  await sb
    .from("workspace_workflows")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", args.workflowId)
    .eq("workspace_id", args.workspaceId);

  await sb
    .from("workspace_workflows")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("workspace_id", args.workspaceId)
    .eq("trigger_type", "call_completed")
    .neq("id", args.workflowId);

  return { ok: true };
}

export function catalogForUi(): typeof WBAH_POST_CALL_STEP_CATALOG {
  return WBAH_POST_CALL_STEP_CATALOG;
}

export async function listWbahPostCallDraftSessions(workspaceId: string): Promise<
  Array<{
    sessionId: string;
    title: string;
    versionNumber: number | null;
    versionStatus: string | null;
    updatedAt: string | null;
  }>
> {
  if (workspaceId !== WBAH_WORKSPACE_ID) return [];

  const sb = supabaseAdmin as any;
  const { data: sessions, error } = await sb
    .from("systemmind_build_sessions")
    .select("id, title, updated_at, current_version_id")
    .eq("workspace_id", workspaceId)
    .eq("is_deleted", false)
    .or("title.ilike.Post-Call —%,title.ilike.%WBAH Post-Call%")
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);

  const rows = (sessions ?? []) as Array<Record<string, unknown>>;
  const versionIds = rows.map((s) => s.current_version_id).filter(Boolean) as string[];
  const versionMap = new Map<string, { version_number: number; status: string }>();

  if (versionIds.length) {
    const { data: versions } = await sb
      .from("systemmind_build_versions")
      .select("id, version_number, status")
      .in("id", versionIds);
    for (const v of (versions ?? []) as Array<Record<string, unknown>>) {
      versionMap.set(String(v.id), {
        version_number: Number(v.version_number ?? 0),
        status: String(v.status ?? "draft"),
      });
    }
  }

  return rows.map((s) => {
    const ver = s.current_version_id ? versionMap.get(String(s.current_version_id)) : null;
    return {
      sessionId: String(s.id),
      title: String(s.title ?? "WBAH Post-Call Workflow"),
      versionNumber: ver?.version_number ?? null,
      versionStatus: ver?.status ?? null,
      updatedAt: s.updated_at ? String(s.updated_at) : null,
    };
  });
}
