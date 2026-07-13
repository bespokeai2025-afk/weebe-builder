/**
 * Retell telephony plumbing + phone-number service functions.
 *
 * Extracted from retell.functions.ts so BOTH the client-callable server fns
 * (manual deploy flow) and server-side orchestration (SystemMind Deployment
 * Orchestrator) reuse the exact same logic — never two deploy paths.
 *
 * Key model (two-tier): explicit production key > per-agent stored key
 * (agent_retell_secrets) > workspace key (workspace_settings.retell_workspace_id)
 * > platform RETELL_API_KEY.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const RETELL_BASE = "https://api.retellai.com";

export class RetellApiError extends Error {
  constructor(
    public path: string,
    public status: number,
    message: string,
  ) {
    super(`${path} (${status}): ${message}`);
    this.name = "RetellApiError";
  }
}

export function isRetellAuthError(error: unknown) {
  return error instanceof RetellApiError && (error.status === 401 || error.status === 403);
}

export function maskApiKey(key: string) {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return `${trimmed.slice(0, 4)}…`;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

export async function loadStoredProductionRetellApiKey(
  agentRowId: string | undefined,
  userId: string,
) {
  if (!agentRowId) return null;
  const admin = supabaseAdmin as any;
  const { data, error } = await admin
    .from("agent_retell_secrets")
    .select("production_api_key")
    .eq("agent_id", agentRowId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.production_api_key === "string" ? data.production_api_key : null;
}

export async function rememberProductionRetellApiKey(
  agentRowId: string | undefined,
  userId: string,
  apiKey: string | undefined,
) {
  const trimmed = apiKey?.trim();
  if (!agentRowId || !trimmed) return;
  const admin = supabaseAdmin as any;
  const masked = maskApiKey(trimmed);
  const { error: secretErr } = await admin.from("agent_retell_secrets").upsert(
    {
      user_id: userId,
      agent_id: agentRowId,
      production_api_key: trimmed,
      production_api_key_masked: masked,
    },
    { onConflict: "user_id,agent_id" },
  );
  if (secretErr) throw new Error(secretErr.message);
  const { data, error: readErr } = await supabaseAdmin
    .from("agents")
    .select("settings")
    .eq("id", agentRowId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  const settings =
    data?.settings && typeof data.settings === "object" && !Array.isArray(data.settings)
      ? { ...(data.settings as Record<string, unknown>) }
      : {};
  delete settings.productionRetellApiKey;
  const next = {
    ...settings,
    productionRetellApiKeyMasked: masked,
    productionRetellApiKeySavedAt: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin
    .from("agents")
    .update({ settings: next })
    .eq("id", agentRowId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function retellFetch(
  path: string,
  body: unknown,
  method = "POST",
  overrideApiKey?: string,
) {
  const apiKey = overrideApiKey || process.env.RETELL_API_KEY;
  if (!apiKey) throw new Error("RETELL_API_KEY is not configured");
  const res = await fetch(`${RETELL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const message =
      typeof parsed === "object" && parsed && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : typeof parsed === "object" && parsed && "error_message" in parsed
          ? String((parsed as { error_message: unknown }).error_message)
          : text || res.statusText;
    throw new RetellApiError(path, res.status, message);
  }
  return parsed as Record<string, unknown>;
}

export async function retellFetchForAgent(
  path: string,
  body: unknown,
  method: string,
  userId: string,
  agentRowId?: string,
  explicitApiKey?: string,
  workspaceId?: string,
) {
  const explicit = explicitApiKey?.trim() || undefined;
  let stored = explicit ? null : await loadStoredProductionRetellApiKey(agentRowId, userId);
  // Fall back to the admin-provisioned workspace-level production API key.
  if (!explicit && !stored && workspaceId) {
    const { data: ws } = await supabaseAdmin
      .from("workspace_settings")
      .select("retell_workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const wsKey = (ws?.retell_workspace_id as string | undefined)?.trim();
    if (wsKey && wsKey.startsWith("key_")) stored = wsKey;
  }
  const resp = await retellFetch(path, body, method, explicit ?? stored ?? undefined);
  if (explicit) await rememberProductionRetellApiKey(agentRowId, userId, explicit);
  return resp;
}

/**
 * When a workspace has its own Retell key, only the cloned production agent ID
 * (agents.settings.deployedRetellAgentId) is valid there — builder-draft agent
 * IDs belong to the platform Retell workspace and Retell rejects them.
 */
export async function resolveAgentIdForWorkspace(
  agentId: string | undefined,
  agentRowId: string | undefined,
  workspaceId: string | undefined,
): Promise<boolean> {
  if (!agentId) return false;

  // No workspace override key → platform key handles everything; any agent ID is fine.
  if (!workspaceId) return true;
  const { data: ws } = await supabaseAdmin
    .from("workspace_settings")
    .select("retell_workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const wsKey = (ws?.retell_workspace_id as string | undefined)?.trim();
  if (!wsKey || !wsKey.startsWith("key_")) return true; // no workspace key → safe

  // Workspace has its own key — only the cloned production agent ID is valid.
  if (!agentRowId) return false;
  const { data: agentRow } = await supabaseAdmin
    .from("agents")
    .select("settings")
    .eq("id", agentRowId)
    .maybeSingle();
  const deployedId = (
    agentRow?.settings as Record<string, unknown> | null
  )?.deployedRetellAgentId as string | undefined;
  return deployedId === agentId;
}

// ── Phone-number services (shared by manual server fns + orchestrator) ────────

export async function buyRetellPhoneNumberService(args: {
  userId: string;
  workspaceId?: string;
  areaCode?: number;
  tollFree?: boolean;
  nickname?: string;
  inboundAgentId?: string;
  outboundAgentId?: string;
  productionApiKey?: string;
  agentRowId?: string;
}): Promise<{ phoneNumber: string; nickname: string; type: string }> {
  const body: Record<string, unknown> = {
    phone_number_pricing_type: args.tollFree ? "toll_free" : "standard",
  };
  if (args.areaCode) body.area_code = args.areaCode;
  if (args.nickname) body.nickname = args.nickname;

  // Only attach agent IDs if they belong to the workspace that owns the API key.
  const agentIdSafe = await resolveAgentIdForWorkspace(
    args.inboundAgentId ?? args.outboundAgentId,
    args.agentRowId,
    args.workspaceId,
  );
  if (args.inboundAgentId && agentIdSafe) body.inbound_agent_id = args.inboundAgentId;
  if (args.outboundAgentId && agentIdSafe) body.outbound_agent_id = args.outboundAgentId;

  const resp = await retellFetchForAgent(
    `/create-phone-number`,
    body,
    "POST",
    args.userId,
    args.agentRowId,
    args.productionApiKey,
    args.workspaceId,
  );
  return {
    phoneNumber: String(resp.phone_number ?? ""),
    nickname: String(resp.nickname ?? ""),
    type: String(resp.phone_number_type ?? ""),
  };
}

export async function importSipPhoneNumberService(args: {
  userId: string;
  workspaceId?: string;
  phoneNumber: string;
  terminationUri: string;
  sipUsername?: string;
  sipPassword?: string;
  nickname?: string;
  inboundAgentId?: string;
  outboundAgentId?: string;
  productionApiKey?: string;
  agentRowId?: string;
}): Promise<{ phoneNumber: string; nickname: string }> {
  if (!/^\+\d{7,15}$/.test(args.phoneNumber)) {
    throw new Error("Phone number must be in E.164 format, e.g. +447533043457");
  }
  if (!args.terminationUri.trim()) {
    throw new Error("Termination URI is required");
  }
  const body: Record<string, unknown> = {
    phone_number: args.phoneNumber,
    termination_uri: args.terminationUri.trim(),
  };
  if (args.sipUsername) body.sip_trunk_auth_username = args.sipUsername;
  if (args.sipPassword) body.sip_trunk_auth_password = args.sipPassword;
  if (args.nickname) body.nickname = args.nickname;
  const agentIdSafe = await resolveAgentIdForWorkspace(
    args.inboundAgentId ?? args.outboundAgentId,
    args.agentRowId,
    args.workspaceId,
  );
  if (args.inboundAgentId && agentIdSafe) body.inbound_agent_id = args.inboundAgentId;
  if (args.outboundAgentId && agentIdSafe) body.outbound_agent_id = args.outboundAgentId;
  const resp = await retellFetchForAgent(
    `/import-phone-number`,
    body,
    "POST",
    args.userId,
    args.agentRowId,
    args.productionApiKey,
    args.workspaceId,
  );
  return {
    phoneNumber: String(resp.phone_number ?? args.phoneNumber),
    nickname: String(resp.nickname ?? ""),
  };
}

export async function listRetellPhoneNumbersService(args: {
  userId: string;
  workspaceId?: string;
  productionApiKey?: string;
  agentRowId?: string;
}): Promise<
  Array<{
    phoneNumber: string;
    nickname: string;
    inboundAgentId: string | null;
    outboundAgentId: string | null;
  }>
> {
  let resp: Record<string, unknown>;
  try {
    resp = await retellFetchForAgent(
      `/list-phone-numbers`,
      undefined,
      "GET",
      args.userId,
      args.agentRowId,
      args.productionApiKey,
      args.workspaceId,
    );
  } catch (error) {
    if (isRetellAuthError(error)) {
      console.warn("[retell] list-phone-numbers auth failed", {
        userId: args.userId,
        agentRowId: args.agentRowId,
        hasExplicitKey: Boolean(args.productionApiKey?.trim()),
      });
      throw new Error(
        "Retell rejected your production API key (401/403). Re-enter the production API key above and try again.",
      );
    }
    throw error;
  }
  const arr = Array.isArray(resp) ? resp : [];
  return arr.map((n) => {
    const item = n as Record<string, unknown>;
    return {
      phoneNumber: String(item.phone_number ?? ""),
      nickname: String(item.nickname ?? ""),
      inboundAgentId: (item.inbound_agent_id as string | undefined) ?? null,
      outboundAgentId: (item.outbound_agent_id as string | undefined) ?? null,
    };
  });
}

export async function assignNumberToAgentService(args: {
  userId: string;
  workspaceId?: string;
  phoneNumber: string;
  inboundAgentId?: string;
  outboundAgentId?: string;
  productionApiKey?: string;
  agentRowId?: string;
}): Promise<{ phoneNumber: string }> {
  const body: Record<string, unknown> = {};
  // Only include agent IDs that actually exist in the workspace that owns the API key.
  const agentIdSafe = await resolveAgentIdForWorkspace(
    args.inboundAgentId ?? args.outboundAgentId,
    args.agentRowId,
    args.workspaceId,
  );
  if (args.inboundAgentId !== undefined) {
    body.inbound_agent_id = agentIdSafe ? args.inboundAgentId : null;
  }
  if (args.outboundAgentId !== undefined) {
    body.outbound_agent_id = agentIdSafe ? args.outboundAgentId : null;
  }
  const resp = await retellFetchForAgent(
    `/update-phone-number/${encodeURIComponent(args.phoneNumber)}`,
    body,
    "PATCH",
    args.userId,
    args.agentRowId,
    args.productionApiKey,
    args.workspaceId,
  );
  return { phoneNumber: String(resp.phone_number ?? args.phoneNumber) };
}
