/**
 * Load Pabau API credentials for a WEBEE workspace (SystemMind CRM connection).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptCredentials } from "@/lib/systemmind/client-api-connections.server";
import type { PabauClientConfig } from "@/lib/pabau/pabau-receptionist.server";
import { DNR_RETELL_AGENT_ID, DNR_WORKSPACE_ID } from "@/lib/dnr/dnr-voice.config";

export function normalizeDnrRetellAgentId(raw: unknown): string {
  const id = String(raw ?? "")
    .trim()
    .replace(/^agents\//, "");
  if (!id || id === "test_agent") return DNR_RETELL_AGENT_ID;
  return id;
}

/** Prefer Retell's call.agent_id over LLM-supplied args.agent_id. */
export function parseDnrRetellAgentId(rawBody: string): string {
  try {
    const quick = JSON.parse(rawBody) as Record<string, unknown>;
    const args = (quick.args ?? {}) as Record<string, unknown>;
    const call = (quick.call ?? {}) as Record<string, unknown>;
    for (const candidate of [call.agent_id, quick.agent_id, args.agent_id]) {
      if (typeof candidate !== "string" || !candidate.trim()) continue;
      return normalizeDnrRetellAgentId(candidate);
    }
  } catch {
    /* ignore */
  }
  return DNR_RETELL_AGENT_ID;
}

function readDotenvValue(name: string): string {
  try {
    const text = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      if (t.slice(0, eq).trim() !== name) continue;
      let v = t.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      return v.trim();
    }
  } catch {
    /* no .env */
  }
  return "";
}

/** Vite often omits non-VITE_* vars from process.env — also read .env on disk. */
export function getPabauConfigFromEnv(): PabauClientConfig | null {
  const apiKey = (process.env.PABAU_API_KEY?.trim() || readDotenvValue("PABAU_API_KEY")).trim();
  if (!apiKey) return null;
  const baseUrl =
    process.env.PABAU_API_BASE?.trim() || readDotenvValue("PABAU_API_BASE") || null;
  return { apiKey, baseUrl };
}

function configFromDecrypted(creds: Record<string, string>): PabauClientConfig | null {
  const apiKey = (creds.apiKey ?? creds.api_key ?? "").trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: creds.baseUrl ?? creds.base_url ?? null,
  };
}

async function loadPabauFromCrm(workspaceId: string): Promise<PabauClientConfig | null> {
  const { data, error } = await supabaseAdmin
    .from("systemmind_crm_connections")
    .select("id, credentials_encrypted, status, credential_keys")
    .eq("workspace_id", workspaceId)
    .eq("provider", "pabau")
    .order("updated_at", { ascending: false })
    .limit(5);

  if (error) {
    console.warn("[dnr-pabau] CRM lookup failed", {
      workspaceId,
      message: error.message,
      code: error.code,
    });
    return null;
  }

  const rows = (data ?? []) as Array<{
    id: string;
    credentials_encrypted: string | null;
    status: string | null;
    credential_keys: unknown;
  }>;
  const ordered = [
    ...rows.filter((r) => r.status === "connected"),
    ...rows.filter((r) => r.status !== "connected"),
  ];

  for (const row of ordered) {
    const blob = row.credentials_encrypted?.trim() ?? "";
    if (!blob) continue;
    const creds = decryptCredentials({ _enc: blob });
    const config = configFromDecrypted(creds);
    if (config) return config;
    console.warn("[dnr-pabau] CRM row present but credentials could not be decrypted", {
      workspaceId,
      connectionId: row.id,
      status: row.status,
      credentialKeys: row.credential_keys,
    });
  }

  if (ordered.length === 0) {
    console.warn("[dnr-pabau] no Pabau CRM row for workspace", { workspaceId });
  }
  return null;
}

export async function getPabauClientConfigForWorkspace(
  workspaceId: string,
): Promise<PabauClientConfig | null> {
  const fromCrm = await loadPabauFromCrm(workspaceId);
  if (fromCrm) return fromCrm;

  const fromEnv = getPabauConfigFromEnv();
  if (fromEnv) {
    console.warn("[dnr-pabau] using PABAU_API_KEY; SystemMind CRM credentials were unreadable", {
      workspaceId,
    });
    return fromEnv;
  }
  return null;
}

export async function resolveWorkspaceIdForRetellAgent(
  retellAgentId: string,
): Promise<string | null> {
  const id = normalizeDnrRetellAgentId(retellAgentId);
  const { data, error } = await supabaseAdmin
    .from("agents")
    .select("workspace_id")
    .or(`retell_agent_id.eq.${id},settings->>deployedRetellAgentId.eq.${id}`)
    .limit(5);

  if (error) {
    console.warn("[dnr-pabau] agent workspace lookup failed", {
      agentId: id,
      message: error.message,
    });
  }

  const rows = (data ?? []) as Array<{ workspace_id: string | null }>;
  const ids = rows.map((r) => r.workspace_id).filter((w): w is string => Boolean(w));
  if (ids.includes(DNR_WORKSPACE_ID)) return DNR_WORKSPACE_ID;
  if (ids.length) return ids[0];
  if (id === DNR_RETELL_AGENT_ID) return DNR_WORKSPACE_ID;
  return null;
}
