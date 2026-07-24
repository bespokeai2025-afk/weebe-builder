/**
 * Retell deployment sync engine (Task #458).
 *
 * Computes an honest six-state sync status per WEBEE agent by comparing:
 *  - the CURRENT builder config (agents.flow_data + settings) hash
 *  - the LAST DEPLOYED config snapshot (retell_deployment_state)
 *  - the LIVE Retell agent + conversation flow config hash
 *
 * States: in_sync | webee_not_deployed | retell_not_imported | conflict
 *       | failed | credentials_missing
 *
 * Pure helpers (stableStringify, hashRetellConfig, computeSyncState,
 * normalizeRetellAgentForCompare, buildExtractionSchema, compareExtractionSchemas)
 * are exported for e2e testing without live Retell calls.
 *
 * Raw Retell API keys NEVER leave the server — all responses are redacted.
 */
import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  RETELL_BASE,
  RetellApiError,
  retellFetch,
} from "@/lib/builder/retell-telephony.server";

export type RetellSyncState =
  | "in_sync"
  | "webee_not_deployed"
  | "retell_not_imported"
  | "conflict"
  | "failed"
  | "credentials_missing";

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Deterministic JSON stringify (sorted object keys, arrays in order). */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashRetellConfig(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

/**
 * Reduce a Retell agent + conversation flow to the comparable, builder-owned
 * subset. Retell adds server-side defaults, timestamps and version metadata on
 * every read — a naive deep-equal always reports drift. We compare only fields
 * the builder actually manages.
 */
export function normalizeRetellAgentForCompare(
  agent: Record<string, unknown> | null | undefined,
  cf: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const a = agent ?? {};
  const c = cf ?? {};
  const pick = (src: Record<string, unknown>, keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const v = src[k];
      if (v !== undefined && v !== null) out[k] = v;
    }
    return out;
  };
  const AGENT_KEYS = [
    "agent_name", "voice_id", "voice_model", "voice_temperature", "voice_speed",
    "volume", "responsiveness", "interruption_sensitivity", "enable_backchannel",
    "backchannel_frequency", "backchannel_words", "language", "max_call_duration_ms",
    "end_call_after_silence_ms", "webhook_url", "webhook_events", "boosted_keywords",
    "normalize_for_speech", "stt_mode", "denoising_mode", "allow_user_dtmf",
    "post_call_analysis_data", "post_call_analysis_model", "voicemail_option",
    "ambient_sound", "reminder_trigger_ms", "reminder_max_count", "begin_message_delay_ms",
  ];
  const CF_KEYS = [
    "global_prompt", "nodes", "start_node_id", "start_speaker", "model_choice",
    "tools", "knowledge_base_ids", "kb_config", "model_temperature",
    "tool_call_strict_mode", "flex_mode", "begin_after_user_silence_ms",
  ];
  const normNodes = (nodes: unknown) =>
    Array.isArray(nodes)
      ? nodes.map((n) => {
          const node = { ...(n as Record<string, unknown>) };
          // display positions + edge ids churn without semantic change
          delete node.display_position;
          return node;
        })
      : nodes;
  const cfPart = pick(c, CF_KEYS);
  if (cfPart.nodes) cfPart.nodes = normNodes(cfPart.nodes);
  return { agent: pick(a, AGENT_KEYS), conversationFlow: cfPart };
}

export type SyncStateInput = {
  credentialsOk: boolean;
  hasDeployedAgentId: boolean;
  lastDeployFailed: boolean;
  /** hash of the current builder config */
  localHash: string | null;
  /** hash snapshot taken at last successful deploy */
  lastDeployedHash: string | null;
  /** hash of live Retell config right now (null = unreachable/not found) */
  liveHash: string | null;
  /** live hash recorded at last deploy/import (what Retell looked like then) */
  lastLiveHash: string | null;
};

/** Pure six-state diff. Exported for tests. */
export function computeSyncState(i: SyncStateInput): RetellSyncState {
  if (!i.credentialsOk) return "credentials_missing";
  if (i.lastDeployFailed) return "failed";
  if (!i.hasDeployedAgentId) return "webee_not_deployed";
  // Never snapshotted → we cannot claim sync; treat as WEBEE changes not deployed.
  if (!i.lastDeployedHash) return "webee_not_deployed";
  const localChanged = i.localHash !== null && i.localHash !== i.lastDeployedHash;
  const retellChanged =
    i.liveHash !== null && i.lastLiveHash !== null && i.liveHash !== i.lastLiveHash;
  if (localChanged && retellChanged) return "conflict";
  if (localChanged) return "webee_not_deployed";
  if (retellChanged) return "retell_not_imported";
  return "in_sync";
}

// ── Extraction schema (post-call analysis) from approved variables ───────────

export type ExtractionField = {
  type: "string" | "number" | "boolean" | "enum";
  name: string;
  description: string;
  examples?: string[];
  choices?: string[];
};

const EXTRACTION_TYPE_MAP: Record<string, ExtractionField["type"]> = {
  number: "number", currency: "number", boolean: "boolean",
  single_select: "enum", multi_select: "enum",
};

/**
 * Build the Retell post_call_analysis_data schema from APPROVED variables
 * (status approved/edited) whose direction flows Retell→WEBEE.
 * Pure — takes rows, returns schema. Exported for tests.
 */
export function buildExtractionSchema(
  variables: Array<{
    name: string;
    label?: string | null;
    description?: string | null;
    data_type?: string | null;
    status?: string | null;
    direction?: string | null;
    example_value?: string | null;
    default_value?: string | null;
  }>,
): ExtractionField[] {
  const OUT_DIRECTIONS = new Set(["retell_to_webee", "retell_to_crm_via_webee", "bidirectional"]);
  const seen = new Set<string>();
  const out: ExtractionField[] = [];
  for (const v of variables) {
    const name = (v.name ?? "").trim();
    if (!name || seen.has(name)) continue;
    if (!["approved", "edited"].includes(v.status ?? "")) continue;
    if (!OUT_DIRECTIONS.has(v.direction ?? "")) continue;
    seen.add(name);
    let type = EXTRACTION_TYPE_MAP[v.data_type ?? ""] ?? "string";
    const examples = [v.example_value, v.default_value]
      .map((x) => (x ?? "").trim())
      .filter(Boolean);
    const field: ExtractionField = {
      type,
      name,
      description: (v.description || v.label || name).trim(),
    };
    if (type === "enum") {
      if (examples.length) field.choices = examples;
      else { type = "string"; field.type = "string"; }
    } else if (examples.length && type === "string") {
      field.examples = examples;
    }
    out.push(field);
  }
  return out;
}

/**
 * Compare the schema we sent against what Retell stored (read-back).
 * Returns mismatched field names; empty array = verified. Pure — for tests.
 */
export function compareExtractionSchemas(
  sent: ExtractionField[],
  live: Array<Record<string, unknown>>,
): string[] {
  const liveByName = new Map(live.map((f) => [String(f.name ?? ""), f]));
  const mismatches: string[] = [];
  for (const f of sent) {
    const actual = liveByName.get(f.name);
    if (!actual) { mismatches.push(f.name); continue; }
    if (String(actual.type) !== f.type) { mismatches.push(f.name); continue; }
    if (f.type === "enum") {
      const liveChoices = Array.isArray(actual.choices) ? actual.choices.map(String) : [];
      if (stableStringify(liveChoices) !== stableStringify(f.choices ?? [])) mismatches.push(f.name);
    }
  }
  return mismatches;
}

// ── Server-side data access ───────────────────────────────────────────────────

async function resolveBuilderKey(workspaceId: string): Promise<{ key: string | null; source: string }> {
  const { data: ws } = await supabaseAdmin
    .from("workspace_settings")
    .select("retell_workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const wsKey = (ws?.retell_workspace_id as string | undefined)?.trim();
  if (wsKey && wsKey.startsWith("key_")) return { key: wsKey, source: "workspace" };
  const platform = process.env.RETELL_API_KEY?.trim();
  if (platform) return { key: platform, source: "platform" };
  return { key: null, source: "none" };
}

type AgentRow = {
  id: string;
  workspace_id: string;
  name: string | null;
  retell_agent_id: string | null;
  retell_conversation_flow_id: string | null;
  flow_data: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
};

async function loadAgentRow(workspaceId: string, agentRowId: string): Promise<AgentRow | null> {
  const { data } = await supabaseAdmin
    .from("agents")
    .select("id, workspace_id, name, retell_agent_id, retell_conversation_flow_id, flow_data, settings")
    .eq("id", agentRowId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return (data as AgentRow | null) ?? null;
}

function deployedIdsOf(agent: AgentRow): { agentId: string | null; cfId: string | null } {
  const s = (agent.settings ?? {}) as Record<string, unknown>;
  return {
    agentId:
      ((s.deployedRetellAgentId as string | undefined) || agent.retell_agent_id || null),
    cfId:
      ((s.deployedConversationFlowId as string | undefined) ||
        (s.conversationFlowId as string | undefined) ||
        agent.retell_conversation_flow_id ||
        null),
  };
}

async function fetchLiveRetellConfig(
  retellAgentId: string,
  key: string,
): Promise<{ agent: Record<string, unknown>; cf: Record<string, unknown> | null } | { error: string; notFound: boolean }> {
  try {
    const agent = await retellFetch(`/get-agent/${retellAgentId}`, undefined, "GET", key);
    let cf: Record<string, unknown> | null = null;
    const re = agent.response_engine as Record<string, unknown> | undefined;
    const cfId = re?.type === "conversation-flow" ? String(re.conversation_flow_id ?? "") : "";
    if (cfId) {
      try {
        cf = await retellFetch(`/get-conversation-flow/${cfId}`, undefined, "GET", key);
      } catch {
        cf = null;
      }
    }
    return { agent, cf };
  } catch (e) {
    const notFound = e instanceof RetellApiError && e.status === 404;
    return { error: (e as Error).message, notFound };
  }
}

/** Compute the current local builder-config hash for an agent row. */
export function localConfigHashForAgent(agent: AgentRow): string | null {
  const flow = agent.flow_data;
  if (!flow || typeof flow !== "object" || !Object.keys(flow).length) return null;
  const s = (agent.settings ?? {}) as Record<string, unknown>;
  // Exclude deploy bookkeeping keys from the local hash — they change on
  // deploy without any semantic builder change.
  const settingsForHash = { ...s };
  for (const k of [
    "deployedRetellAgentId", "deployedConversationFlowId", "conversationFlowId",
    "agentId", "productionRetellApiKey", "productionRetellApiKeyMasked",
    "productionRetellApiKeySavedAt", "lastDeployedAt",
  ]) delete settingsForHash[k];
  return hashRetellConfig({ flow, settings: settingsForHash, name: agent.name });
}

export type RetellSyncStatus = {
  state: RetellSyncState;
  retellAgentId: string | null;
  conversationFlowId: string | null;
  keySource: "workspace" | "platform" | "none";
  lastDeployStatus: string;
  lastDeployError: string | null;
  lastDeployedAt: string | null;
  lastSyncedAt: string;
  liveReachable: boolean;
  liveError: string | null;
  extractionVerified: boolean;
  extractionVerifiedAt: string | null;
  extractionFieldCount: number;
  evidence: {
    localHash: string | null;
    lastDeployedHash: string | null;
    liveHash: string | null;
    lastLiveHash: string | null;
  };
};

/**
 * Compute the live sync status for one agent. Fetches the live Retell config
 * (read-back), compares against the last-deploy snapshot + current builder
 * config and persists the observed live hash + timestamp.
 */
export async function getRetellSyncStatusServer(
  workspaceId: string,
  agentRowId: string,
): Promise<RetellSyncStatus> {
  const agent = await loadAgentRow(workspaceId, agentRowId);
  if (!agent) throw new Error("Agent not found in this workspace");

  const { key, source } = await resolveBuilderKey(workspaceId);
  const { agentId: retellAgentId, cfId } = deployedIdsOf(agent);

  const { data: stateRow } = await supabaseAdmin
    .from("retell_deployment_state")
    .select("*")
    .eq("agent_id", agentRowId)
    .maybeSingle();
  const st = (stateRow ?? {}) as Record<string, unknown>;

  const localHash = localConfigHashForAgent(agent);
  let liveHash: string | null = null;
  let liveReachable = false;
  let liveError: string | null = null;
  let liveAgentGone = false;

  if (key && retellAgentId) {
    const live = await fetchLiveRetellConfig(retellAgentId, key);
    if ("error" in live) {
      liveError = live.error;
      liveAgentGone = live.notFound;
    } else {
      liveReachable = true;
      liveHash = hashRetellConfig(normalizeRetellAgentForCompare(live.agent, live.cf));
    }
  }

  const state = computeSyncState({
    credentialsOk: !!key,
    hasDeployedAgentId: !!retellAgentId && !liveAgentGone,
    lastDeployFailed: st.last_deploy_status === "failed",
    localHash,
    lastDeployedHash: (st.last_deployed_hash as string | null) ?? null,
    liveHash,
    lastLiveHash: (st.last_live_hash as string | null) ?? null,
  });

  const now = new Date().toISOString();
  // Persist observation (server-only write; best-effort).
  try {
    await supabaseAdmin.from("retell_deployment_state").upsert(
      {
        workspace_id: workspaceId,
        agent_id: agentRowId,
        retell_agent_id: retellAgentId,
        conversation_flow_id: cfId,
        last_synced_at: now,
        updated_at: now,
      } as never,
      { onConflict: "agent_id" },
    );
  } catch { /* non-fatal */ }

  const extractionSchema = Array.isArray(st.extraction_schema)
    ? (st.extraction_schema as unknown[])
    : [];

  return {
    state,
    retellAgentId,
    conversationFlowId: cfId,
    keySource: source as "workspace" | "platform" | "none",
    lastDeployStatus: (st.last_deploy_status as string | undefined) ?? "never",
    lastDeployError: (st.last_deploy_error as string | null) ?? null,
    lastDeployedAt: (st.last_deployed_at as string | null) ?? null,
    lastSyncedAt: now,
    liveReachable,
    liveError,
    extractionVerified: Boolean(st.extraction_verified),
    extractionVerifiedAt: (st.extraction_verified_at as string | null) ?? null,
    extractionFieldCount: extractionSchema.length,
    evidence: {
      localHash,
      lastDeployedHash: (st.last_deployed_hash as string | null) ?? null,
      liveHash,
      lastLiveHash: (st.last_live_hash as string | null) ?? null,
    },
  };
}

/**
 * Record a successful/failed deploy snapshot. Called from deployAgentToRetell
 * after Retell writes so the diff engine has an anchor. On success we read the
 * live config back and store BOTH the deployed-config hash and the live hash.
 */
export async function recordDeploySnapshot(args: {
  workspaceId: string;
  agentRowId: string;
  retellAgentId: string | null;
  conversationFlowId: string | null;
  success: boolean;
  error?: string | null;
  builderKey?: string | null;
}) {
  const now = new Date().toISOString();
  let lastDeployedHash: string | null = null;
  let lastLiveHash: string | null = null;
  let deployedConfig: Record<string, unknown> | null = null;

  if (args.success && args.retellAgentId) {
    const key = args.builderKey ?? (await resolveBuilderKey(args.workspaceId)).key;
    if (key) {
      const live = await fetchLiveRetellConfig(args.retellAgentId, key);
      if (!("error" in live)) {
        deployedConfig = normalizeRetellAgentForCompare(live.agent, live.cf);
        lastLiveHash = hashRetellConfig(deployedConfig);
        lastDeployedHash = lastLiveHash;
      }
    }
    // Anchor the local hash too: fetch the agent row and store its local hash
    // as the deployed snapshot so subsequent local edits show as undeployed.
    const agent = await loadAgentRow(args.workspaceId, args.agentRowId);
    if (agent) {
      const localHash = localConfigHashForAgent(agent);
      if (localHash) lastDeployedHash = localHash;
    }
  }

  try {
    await supabaseAdmin.from("retell_deployment_state").upsert(
      {
        workspace_id: args.workspaceId,
        agent_id: args.agentRowId,
        retell_agent_id: args.retellAgentId,
        conversation_flow_id: args.conversationFlowId,
        last_deploy_status: args.success ? "success" : "failed",
        last_deploy_error: args.success ? null : (args.error ?? "Deploy failed"),
        ...(args.success
          ? {
              last_deployed_hash: lastDeployedHash,
              last_live_hash: lastLiveHash,
              last_deployed_config: deployedConfig as never,
              last_deployed_at: now,
            }
          : {}),
        updated_at: now,
      } as never,
      { onConflict: "agent_id" },
    );
  } catch (e) {
    console.warn("[retell-sync] deploy snapshot write failed (non-fatal)", e);
  }
}

/**
 * Mark the current live Retell config as imported (after importAgentJson
 * resync) so retell_not_imported clears without a redeploy.
 */
export async function recordImportSnapshot(workspaceId: string, agentRowId: string) {
  const agent = await loadAgentRow(workspaceId, agentRowId);
  if (!agent) throw new Error("Agent not found in this workspace");
  const { key } = await resolveBuilderKey(workspaceId);
  const { agentId: retellAgentId, cfId } = deployedIdsOf(agent);
  if (!key || !retellAgentId) throw new Error("No Retell credentials or deployed agent");
  const live = await fetchLiveRetellConfig(retellAgentId, key);
  if ("error" in live) throw new Error(`Could not read live Retell config: ${live.error}`);
  const normalized = normalizeRetellAgentForCompare(live.agent, live.cf);
  const liveHash = hashRetellConfig(normalized);
  const localHash = localConfigHashForAgent(agent);
  const now = new Date().toISOString();
  await supabaseAdmin.from("retell_deployment_state").upsert(
    {
      workspace_id: workspaceId,
      agent_id: agentRowId,
      retell_agent_id: retellAgentId,
      conversation_flow_id: cfId,
      last_deployed_hash: localHash,
      last_live_hash: liveHash,
      last_deployed_config: normalized as never,
      last_deploy_status: "success",
      last_deploy_error: null,
      updated_at: now,
    } as never,
    { onConflict: "agent_id" },
  );
  return { liveHash, localHash };
}

/**
 * Field-level compare between the last-deployed snapshot and the live Retell
 * config. Returns redacted diff entries — never raw keys.
 */
export async function compareRetellConfigServer(workspaceId: string, agentRowId: string) {
  const agent = await loadAgentRow(workspaceId, agentRowId);
  if (!agent) throw new Error("Agent not found in this workspace");
  const { key } = await resolveBuilderKey(workspaceId);
  const { agentId: retellAgentId } = deployedIdsOf(agent);
  if (!key) throw new Error("No Retell credentials configured");
  if (!retellAgentId) throw new Error("Agent is not deployed to Retell yet");
  const live = await fetchLiveRetellConfig(retellAgentId, key);
  if ("error" in live) throw new Error(`Could not read live Retell config: ${live.error}`);
  const liveNorm = normalizeRetellAgentForCompare(live.agent, live.cf);

  const { data: stateRow } = await supabaseAdmin
    .from("retell_deployment_state")
    .select("last_deployed_config")
    .eq("agent_id", agentRowId)
    .maybeSingle();
  const snapshot = (stateRow?.last_deployed_config ?? null) as Record<string, unknown> | null;

  const diffs: Array<{ path: string; changed: "live_only" | "snapshot_only" | "different" }> = [];
  const walk = (a: unknown, b: unknown, path: string, depth: number) => {
    if (depth > 3) {
      if (stableStringify(a) !== stableStringify(b)) diffs.push({ path, changed: "different" });
      return;
    }
    if (a === undefined && b === undefined) return;
    if (a === undefined) { diffs.push({ path, changed: "live_only" }); return; }
    if (b === undefined) { diffs.push({ path, changed: "snapshot_only" }); return; }
    if (typeof a === "object" && a && typeof b === "object" && b && !Array.isArray(a) && !Array.isArray(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        if (/api[_-]?key|secret|token|password/i.test(k)) continue;
        walk((b as Record<string, unknown>)[k], (a as Record<string, unknown>)[k], path ? `${path}.${k}` : k, depth + 1);
      }
      return;
    }
    if (stableStringify(a) !== stableStringify(b)) diffs.push({ path, changed: "different" });
  };
  walk(snapshot ?? {}, liveNorm, "", 0);
  return {
    hasSnapshot: snapshot !== null,
    diffCount: diffs.length,
    diffs: diffs.slice(0, 100),
  };
}

// ── Extraction schema deploy + read-back verification ─────────────────────────

export async function deployExtractionSchemaServer(workspaceId: string, agentRowId: string) {
  const agent = await loadAgentRow(workspaceId, agentRowId);
  if (!agent) throw new Error("Agent not found in this workspace");
  const { key } = await resolveBuilderKey(workspaceId);
  const { agentId: retellAgentId } = deployedIdsOf(agent);
  if (!key) throw new Error("No Retell credentials configured");
  if (!retellAgentId) throw new Error("Deploy the agent to Retell before configuring extraction");

  const { data: vars } = await supabaseAdmin
    .from("systemmind_dynamic_variables")
    .select("name, label, description, data_type, status, direction, example_value, default_value")
    .eq("workspace_id", workspaceId)
    .eq("agent_id", agentRowId)
    .in("status", ["approved", "edited"]);

  const schema = buildExtractionSchema((vars ?? []) as never[]);
  if (!schema.length) {
    throw new Error("No approved variables flow from Retell to WEBEE — nothing to configure");
  }

  // Merge with any existing analysis fields Retell already has that we do not
  // manage (e.g. auto-injected booking fields) — ours win on name collision.
  const live = await fetchLiveRetellConfig(retellAgentId, key);
  if ("error" in live) throw new Error(`Could not read live agent: ${live.error}`);
  const existing = Array.isArray(live.agent.post_call_analysis_data)
    ? (live.agent.post_call_analysis_data as Array<Record<string, unknown>>)
    : [];
  const ourNames = new Set(schema.map((f) => f.name));
  const merged = [...existing.filter((f) => !ourNames.has(String(f.name))), ...schema];

  await retellFetch(`/update-agent/${retellAgentId}`, { post_call_analysis_data: merged }, "PATCH", key);

  // Read back and verify BEFORE marking configured.
  const after = await retellFetch(`/get-agent/${retellAgentId}`, undefined, "GET", key);
  const liveSchema = Array.isArray(after.post_call_analysis_data)
    ? (after.post_call_analysis_data as Array<Record<string, unknown>>)
    : [];
  const mismatches = compareExtractionSchemas(schema, liveSchema);
  const verified = mismatches.length === 0;
  const now = new Date().toISOString();

  await supabaseAdmin.from("retell_deployment_state").upsert(
    {
      workspace_id: workspaceId,
      agent_id: agentRowId,
      retell_agent_id: retellAgentId,
      extraction_schema: schema as never,
      extraction_verified: verified,
      extraction_verified_at: verified ? now : null,
      updated_at: now,
    } as never,
    { onConflict: "agent_id" },
  );

  return { fieldCount: schema.length, verified, mismatches, fields: schema };
}
