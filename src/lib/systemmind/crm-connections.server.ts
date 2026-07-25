// ── SystemMind CRM connections — server-only core (Task #457) ─────────────────
// Per-workspace CRM connection lifecycle: secure credential storage (AES,
// server-only tables), evidence-based connection testing, live schema
// discovery persistence and OAuth refresh handling.
//
// SAFETY INVARIANTS
//   • workspace_id comes ONLY from server context (callers pass it from auth).
//   • Credential VALUES never leave this module: every read is masked to
//     credential key NAMES only; test reports/discovery snapshots are scrubbed.
//   • Tables are server-only (RLS zero-policies + REVOKE) — no client reads.
//   • WBAH is hard-blocked on every entry point.
//   • Existing runtime adapters (src/lib/crm/*, src/lib/providers/crm/*) are
//     untouched — this layer only powers connect/test/discover.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertNotWbahWorkspace } from "@/lib/wbah-exclusion.shared";
import { encryptCredentials, decryptCredentials } from "@/lib/systemmind/client-api-connections.server";
import { writeSystemMindAudit } from "@/lib/systemmind/systemmind-automation.server";
import {
  CRM_CONNECTOR_REGISTRY,
  getConnectorEntry,
  buildConnector,
} from "@/lib/systemmind/crm-connections/connector-registry";
import { assertSafeCredentialUrls } from "@/lib/systemmind/crm-connections/url-guard";
import type { CrmTestReport, CrmDiscoverySnapshot } from "@/lib/systemmind/crm-connections/contract";

const sb = supabaseAdmin as any;

export const MASKED_VALUE = "••••••••";

// ── Types returned to the client (always masked) ─────────────────────────────

export type CrmConnectionSummary = {
  id: string;
  provider: string;
  label: string;
  status: "unverified" | "connected" | "failed";
  credentialKeys: string[];
  /** Non-secret credential values (urls, header names…); secrets are MASKED_VALUE. */
  maskedCredentials: Record<string, string>;
  lastTestReport: CrmTestReport | null;
  lastTestedAt: string | null;
  tokenExpiresAt: string | null;
  lastRefreshedAt: string | null;
  hasDiscovery: boolean;
  discoverySummary: { objectCount: number; fieldCount: number; pipelineCount: number; ownerCount: number; discoveredAt: string } | null;
  createdAt: string;
  updatedAt: string;
};

function scrubReport(r: any): CrmTestReport | null {
  if (!r || typeof r !== "object") return null;
  return r as CrmTestReport;
}

// Strict masked-read contract: EVERY stored credential value is masked on
// read, regardless of secret classification — the client only ever learns
// which keys are set, never their values.
function maskCreds(creds: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(creds)) out[k] = MASKED_VALUE;
  return out;
}

// Defense-in-depth scrubbing of external-system text before it is persisted
// or returned: redact any occurrence of a stored credential value plus common
// token shapes that a reflective/malicious endpoint could echo back.
function scrubSecretText(text: string, creds: Record<string, string>): string {
  let out = text;
  for (const v of Object.values(creds)) {
    if (v && v.length >= 6) out = out.split(v).join(MASKED_VALUE);
  }
  out = out.replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASKED_VALUE}`);
  out = out.replace(/(["']?(?:access_token|refresh_token|api_?key|client_secret|password|authorization)["']?\s*[:=]\s*["']?)[^"'\s,}]{6,}/gi, `$1${MASKED_VALUE}`);
  return out;
}

function scrubReportSecrets(r: CrmTestReport, creds: Record<string, string>): CrmTestReport {
  return {
    ...r,
    steps: r.steps.map((s) => ({ ...s, detail: scrubSecretText(s.detail ?? "", creds) })),
    error: r.error ? scrubSecretText(r.error, creds) : r.error,
    sampleRecord: r.sampleRecord
      ? Object.fromEntries(Object.entries(r.sampleRecord).map(([k, v]) => [k, scrubSecretText(String(v), creds)]))
      : r.sampleRecord,
  };
}

async function loadRow(workspaceId: string, id: string) {
  const { data, error } = await sb
    .from("systemmind_crm_connections")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("CRM connection not found in this workspace.");
  return data;
}

async function toSummary(row: any, discovery?: any | null): Promise<CrmConnectionSummary> {
  let disc = discovery;
  if (disc === undefined) {
    const { data } = await sb
      .from("systemmind_crm_discoveries")
      .select("object_count, field_count, pipeline_count, owner_count, discovered_at")
      .eq("connection_id", row.id)
      .maybeSingle();
    disc = data ?? null;
  }
  const creds = decryptCredentials(row.credentials_encrypted ? { _enc: row.credentials_encrypted } : null);
  return {
    id: String(row.id),
    provider: String(row.provider),
    label: String(row.label ?? ""),
    status: (row.status ?? "unverified") as CrmConnectionSummary["status"],
    credentialKeys: Object.keys(creds),
    maskedCredentials: maskCreds(creds),
    lastTestReport: scrubReport(row.last_test_report),
    lastTestedAt: row.last_tested_at ?? null,
    tokenExpiresAt: row.token_expires_at ?? null,
    lastRefreshedAt: row.last_refreshed_at ?? null,
    hasDiscovery: !!disc,
    discoverySummary: disc
      ? {
          objectCount: Number(disc.object_count ?? 0),
          fieldCount: Number(disc.field_count ?? 0),
          pipelineCount: Number(disc.pipeline_count ?? 0),
          ownerCount: Number(disc.owner_count ?? 0),
          discoveredAt: String(disc.discovered_at ?? ""),
        }
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ── Registry metadata (non-secret, safe for the client) ──────────────────────

export function listConnectorCatalog() {
  return CRM_CONNECTOR_REGISTRY.map((e) => ({
    provider: e.provider,
    label: e.label,
    description: e.description,
    supportsDiscovery: e.supportsDiscovery,
    supportsOAuthRefresh: e.supportsOAuthRefresh,
    fields: e.fields,
  }));
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function listCrmConnectionsServer(args: { workspaceId: string }): Promise<CrmConnectionSummary[]> {
  assertNotWbahWorkspace(args.workspaceId);
  const { data, error } = await sb
    .from("systemmind_crm_connections")
    .select("*")
    .eq("workspace_id", args.workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const { data: discs } = await sb
    .from("systemmind_crm_discoveries")
    .select("connection_id, object_count, field_count, pipeline_count, owner_count, discovered_at")
    .eq("workspace_id", args.workspaceId);
  const byConn = new Map((discs ?? []).map((d: any) => [String(d.connection_id), d]));
  return Promise.all(rows.map((r: any) => toSummary(r, byConn.get(String(r.id)) ?? null)));
}

export async function saveCrmConnectionServer(args: {
  workspaceId: string;
  userId: string | null;
  id?: string | null;
  provider: string;
  label?: string;
  credentials: Record<string, string>;
}): Promise<CrmConnectionSummary> {
  assertNotWbahWorkspace(args.workspaceId);
  const entry = getConnectorEntry(args.provider);
  if (!entry) throw new Error(`Unsupported CRM provider: ${args.provider}`);

  // Merge: blank or masked incoming values keep the previously stored secret.
  let merged: Record<string, string> = {};
  let existing: any = null;
  if (args.id) {
    existing = await loadRow(args.workspaceId, args.id);
    if (existing.provider !== args.provider) throw new Error("Provider cannot be changed on an existing connection.");
    merged = decryptCredentials(existing.credentials_encrypted ? { _enc: existing.credentials_encrypted } : null);
  }
  let credsChanged = false;
  for (const [k, v] of Object.entries(args.credentials ?? {})) {
    const val = String(v ?? "").trim();
    if (!val || val === MASKED_VALUE) continue;
    if (merged[k] !== val) credsChanged = true;
    merged[k] = val;
  }
  const allowedKeys = new Set(entry.fields.map((f) => f.key));
  for (const k of Object.keys(merged)) {
    if (!allowedKeys.has(k)) delete merged[k];
  }

  const missing = entry.fields.filter((f) => f.required && !merged[f.key]);
  if (missing.length) throw new Error(`Missing required field(s): ${missing.map((f) => f.label).join(", ")}`);

  await assertSafeCredentialUrls(args.provider, merged);

  const enc = encryptCredentials(merged);
  const payload = {
    workspace_id: args.workspaceId,
    provider: args.provider,
    label: String(args.label ?? existing?.label ?? entry.label),
    credentials_encrypted: enc._enc ?? "",
    credential_keys: Object.keys(merged),
    updated_at: new Date().toISOString(),
    ...(credsChanged || !existing ? { status: "unverified", last_test_report: null, last_tested_at: null } : {}),
  };

  let row: any;
  if (existing) {
    const { data, error } = await sb
      .from("systemmind_crm_connections")
      .update(payload)
      .eq("id", existing.id)
      .eq("workspace_id", args.workspaceId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    row = data;
  } else {
    const { data, error } = await sb
      .from("systemmind_crm_connections")
      .insert({ ...payload, created_by: args.userId })
      .select("*")
      .single();
    if (error) {
      if (String(error.code) === "23505") throw new Error("A connection with this provider and label already exists.");
      throw new Error(error.message);
    }
    row = data;
  }

  await writeSystemMindAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    actionType: existing ? "crm_connection_updated" : "crm_connection_created",
    targetType: "crm_connection",
    targetId: String(row.id),
    finalAfterState: { provider: args.provider, label: row.label, credentialKeys: Object.keys(merged) },
  }).catch(() => {});

  return toSummary(row);
}

export async function deleteCrmConnectionServer(args: { workspaceId: string; userId: string | null; id: string }) {
  assertNotWbahWorkspace(args.workspaceId);
  const row = await loadRow(args.workspaceId, args.id);
  const { error } = await sb
    .from("systemmind_crm_connections")
    .delete()
    .eq("id", args.id)
    .eq("workspace_id", args.workspaceId);
  if (error) throw new Error(error.message);
  await writeSystemMindAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    actionType: "crm_connection_deleted",
    targetType: "crm_connection",
    targetId: args.id,
    beforeState: { provider: row.provider, label: row.label },
  }).catch(() => {});
  return { ok: true };
}

// ── OAuth refresh (persisting the refreshed token) ────────────────────────────

async function refreshAndPersist(row: any, workspaceId: string): Promise<boolean> {
  const creds = decryptCredentials(row.credentials_encrypted ? { _enc: row.credentials_encrypted } : null);
  const connector = await buildConnector(String(row.provider), creds, { workspaceId });
  if (!connector.refreshCredentials) return false;
  const result = await connector.refreshCredentials().catch(() => null);
  if (!result || !Object.keys(result.updated).length) return false;
  const merged = { ...creds, ...result.updated };
  const enc = encryptCredentials(merged);
  await sb
    .from("systemmind_crm_connections")
    .update({
      credentials_encrypted: enc._enc ?? "",
      credential_keys: Object.keys(merged),
      token_expires_at: result.expiresAt ?? null,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("workspace_id", workspaceId);
  return true;
}

export async function refreshCrmCredentialsServer(args: { workspaceId: string; userId: string | null; id: string }) {
  assertNotWbahWorkspace(args.workspaceId);
  const row = await loadRow(args.workspaceId, args.id);
  const entry = getConnectorEntry(String(row.provider));
  if (!entry?.supportsOAuthRefresh) throw new Error(`${row.provider} does not support OAuth token refresh.`);
  const refreshed = await refreshAndPersist(row, args.workspaceId);
  if (!refreshed) {
    throw new Error("Token refresh failed — check the refresh token, client ID and client secret.");
  }
  const fresh = await loadRow(args.workspaceId, args.id);
  return toSummary(fresh);
}

// ── Testing with evidence ─────────────────────────────────────────────────────

export async function testCrmConnectionServer(args: {
  workspaceId: string;
  userId: string | null;
  id: string;
}): Promise<{ connection: CrmConnectionSummary; report: CrmTestReport }> {
  assertNotWbahWorkspace(args.workspaceId);
  let row = await loadRow(args.workspaceId, args.id);
  const entry = getConnectorEntry(String(row.provider));

  // Proactively refresh OAuth tokens so the refreshed token is PERSISTED
  // (connectors also retry on 401 internally, but that copy is in-memory only).
  if (entry?.supportsOAuthRefresh) {
    const ok = await refreshAndPersist(row, args.workspaceId).catch(() => false);
    if (ok) row = await loadRow(args.workspaceId, args.id);
  }

  const creds = decryptCredentials(row.credentials_encrypted ? { _enc: row.credentials_encrypted } : null);
  await assertSafeCredentialUrls(String(row.provider), creds);
  const connector = await buildConnector(String(row.provider), creds, { workspaceId: args.workspaceId });

  let reportResult: CrmTestReport;
  try {
    reportResult = await connector.testConnection();
  } catch (e) {
    reportResult = {
      ok: false,
      steps: [{ key: "auth", label: "Authenticate", ok: false, detail: e instanceof Error ? e.message : String(e) }],
      sampleRecord: null,
      fieldCount: null,
      testedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
  }

  reportResult = scrubReportSecrets(reportResult, creds);
  const status = reportResult.ok ? "connected" : "failed";
  const { data: updated, error } = await sb
    .from("systemmind_crm_connections")
    .update({
      status,
      last_test_report: reportResult,
      last_tested_at: reportResult.testedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.id)
    .eq("workspace_id", args.workspaceId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await writeSystemMindAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    actionType: "crm_connection_tested",
    targetType: "crm_connection",
    targetId: args.id,
    finalAfterState: { provider: row.provider, status, ok: reportResult.ok },
  }).catch(() => {});

  return { connection: await toSummary(updated), report: reportResult };
}

// ── Discovery persistence ─────────────────────────────────────────────────────

function countFields(snapshot: CrmDiscoverySnapshot): number {
  return snapshot.objects.reduce((n, o) => n + o.fields.length, 0);
}

export async function runCrmDiscoveryServer(args: {
  workspaceId: string;
  userId: string | null;
  id: string;
}): Promise<{ snapshot: CrmDiscoverySnapshot; summary: NonNullable<CrmConnectionSummary["discoverySummary"]> }> {
  assertNotWbahWorkspace(args.workspaceId);
  const row = await loadRow(args.workspaceId, args.id);
  const creds = decryptCredentials(row.credentials_encrypted ? { _enc: row.credentials_encrypted } : null);
  await assertSafeCredentialUrls(String(row.provider), creds);
  const connector = await buildConnector(String(row.provider), creds, { workspaceId: args.workspaceId });
  const snapshot = await connector.discover();
  snapshot.warnings = snapshot.warnings.map((w) => scrubSecretText(w, creds));

  const record = {
    connection_id: args.id,
    workspace_id: args.workspaceId,
    provider: String(row.provider),
    snapshot,
    object_count: snapshot.objects.length,
    field_count: countFields(snapshot),
    pipeline_count: snapshot.pipelines.length,
    owner_count: snapshot.owners.length,
    warnings: snapshot.warnings,
    discovered_at: snapshot.discoveredAt,
  };
  const { error } = await sb
    .from("systemmind_crm_discoveries")
    .upsert(record, { onConflict: "connection_id" });
  if (error) throw new Error(error.message);

  await writeSystemMindAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    actionType: "crm_discovery_run",
    targetType: "crm_connection",
    targetId: args.id,
    finalAfterState: {
      provider: row.provider,
      objectCount: record.object_count,
      fieldCount: record.field_count,
      pipelineCount: record.pipeline_count,
      ownerCount: record.owner_count,
    },
  }).catch(() => {});

  return {
    snapshot,
    summary: {
      objectCount: record.object_count,
      fieldCount: record.field_count,
      pipelineCount: record.pipeline_count,
      ownerCount: record.owner_count,
      discoveredAt: snapshot.discoveredAt,
    },
  };
}

export async function getCrmDiscoveryServer(args: {
  workspaceId: string;
  connectionId: string;
}): Promise<CrmDiscoverySnapshot | null> {
  assertNotWbahWorkspace(args.workspaceId);
  const { data, error } = await sb
    .from("systemmind_crm_discoveries")
    .select("snapshot")
    .eq("connection_id", args.connectionId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.snapshot as CrmDiscoverySnapshot) ?? null;
}

/**
 * Mapping-engine hook (Task #456 variable engine): latest discovered fields
 * for a workspace, optionally filtered by provider. Plain async fn — safe to
 * call from other server modules.
 */
export async function getDiscoveredCrmFieldsForWorkspace(args: {
  workspaceId: string;
  provider?: string | null;
}): Promise<Array<{ provider: string; object: string; field: string; label: string; type: string; custom: boolean }>> {
  assertNotWbahWorkspace(args.workspaceId);
  let q = sb
    .from("systemmind_crm_discoveries")
    .select("provider, snapshot, discovered_at")
    .eq("workspace_id", args.workspaceId)
    .order("discovered_at", { ascending: false });
  if (args.provider) q = q.eq("provider", args.provider);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const out: Array<{ provider: string; object: string; field: string; label: string; type: string; custom: boolean }> = [];
  const seenProviders = new Set<string>();
  for (const row of data ?? []) {
    if (seenProviders.has(String(row.provider))) continue;
    seenProviders.add(String(row.provider));
    const snap = row.snapshot as CrmDiscoverySnapshot;
    for (const obj of snap?.objects ?? []) {
      for (const f of obj.fields ?? []) {
        out.push({
          provider: String(row.provider),
          object: obj.key,
          field: f.key,
          label: f.label,
          type: f.type,
          custom: !!f.custom,
        });
      }
    }
  }
  return out;
}
