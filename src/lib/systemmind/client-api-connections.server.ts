/**
 * SystemMind Clients — API Connection management server functions.
 *
 * Credentials are stored AES-256-CBC encrypted in `client_api_connections.encrypted_credentials`.
 * They are NEVER returned to the browser. Only `hasCredentials: boolean` is surfaced after save.
 *
 * Internal decrypt helpers are NOT createServerFn — they never travel to the client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuthType =
  | "bearer_token"
  | "api_key_header"
  | "basic_auth"
  | "oauth_placeholder"
  | "otp"
  | "custom_headers";

export interface ConnectionRow {
  id: string;
  client_id: string | null;
  workspace_id: string | null;
  name: string;
  base_url: string;
  auth_type: AuthType;
  hasCredentials: boolean;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── AES-256-CBC encryption (server-only, never exported as server fn) ─────────

function deriveKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for credential encryption");
  return createHash("sha256").update(secret).digest();
}

/** Encrypt a credentials object → opaque JSON blob `{ _enc: "iv:cipherHex" }` */
export function encryptCredentials(creds: Record<string, string>): Record<string, string> {
  if (Object.keys(creds).length === 0) return {};
  const key = deriveKey();
  const iv  = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  let enc = cipher.update(JSON.stringify(creds), "utf8", "hex");
  enc += cipher.final("hex");
  return { _enc: `${iv.toString("hex")}:${enc}` };
}

/** Decrypt the blob produced by encryptCredentials — server-side only, never a server fn */
export function decryptCredentials(blob: Record<string, string> | null): Record<string, string> {
  if (!blob || !blob._enc) return {};
  try {
    const [ivHex, enc] = blob._enc.split(":");
    if (!ivHex || !enc) return {};
    const key      = deriveKey();
    const iv       = Buffer.from(ivHex, "hex");
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    let decrypted  = decipher.update(enc, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
  } catch {
    return {};
  }
}

// ── Public row (never includes credentials) ───────────────────────────────────

function toPublicRow(row: any): ConnectionRow {
  return {
    id:             row.id,
    client_id:      row.client_id,
    workspace_id:   row.workspace_id,
    name:           row.name,
    base_url:       row.base_url,
    auth_type:      row.auth_type as AuthType,
    hasCredentials: !!(row.encrypted_credentials && Object.keys(row.encrypted_credentials ?? {}).length > 0),
    status:         row.status,
    notes:          row.notes,
    created_at:     row.created_at,
    updated_at:     row.updated_at,
  };
}

// ── Server functions ──────────────────────────────────────────────────────────

export const listClientApiConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const sb = supabaseAdmin as any;
    const { data, error } = await sb
      .from("client_api_connections")
      .select("id, client_id, workspace_id, name, base_url, auth_type, encrypted_credentials, status, notes, created_at, updated_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toPublicRow) as ConnectionRow[];
  });

export const saveClientApiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: {
    id?: string;
    name: string;
    baseUrl: string;
    authType: AuthType;
    credentials?: Record<string, string>;
    clientId?: string;
    workspaceId?: string;
    notes?: string;
  }) =>
    z.object({
      id:          z.string().optional(),
      name:        z.string().min(1),
      baseUrl:     z.string().url(),
      authType:    z.string(),
      credentials: z.record(z.string()).optional(),
      clientId:    z.string().optional(),
      workspaceId: z.string().optional(),
      notes:       z.string().optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;

    let encryptedCreds: Record<string, string> | null = null;
    if (data.credentials && Object.keys(data.credentials).filter(k => data.credentials![k]).length > 0) {
      encryptedCreds = encryptCredentials(
        Object.fromEntries(Object.entries(data.credentials).filter(([, v]) => v))
      );
    }

    if (data.id) {
      const update: any = {
        name:         data.name,
        base_url:     data.baseUrl,
        auth_type:    data.authType,
        client_id:    data.clientId ?? null,
        workspace_id: data.workspaceId ?? null,
        notes:        data.notes ?? null,
        updated_at:   new Date().toISOString(),
      };
      if (encryptedCreds !== null) update.encrypted_credentials = encryptedCreds;

      const { data: row, error } = await sb
        .from("client_api_connections")
        .update(update)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return toPublicRow(row);
    }

    const { data: row, error } = await sb
      .from("client_api_connections")
      .insert({
        name:                  data.name,
        base_url:              data.baseUrl,
        auth_type:             data.authType,
        encrypted_credentials: encryptedCreds ?? {},
        client_id:             data.clientId ?? null,
        workspace_id:          data.workspaceId ?? null,
        notes:                 data.notes ?? null,
        status:                "untested",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toPublicRow(row);
  });

export const deleteClientApiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { id: string }) => z.object({ id: z.string() }).parse(i))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const { error } = await sb.from("client_api_connections").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getClientApiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { id: string }) => z.object({ id: z.string() }).parse(i))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const { data: row, error } = await sb
      .from("client_api_connections")
      .select("id, client_id, workspace_id, name, base_url, auth_type, encrypted_credentials, status, notes, created_at, updated_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    return toPublicRow(row);
  });

export const updateConnectionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { id: string; status: string }) =>
    z.object({ id: z.string(), status: z.string() }).parse(i),
  )
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    await sb
      .from("client_api_connections")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    return { ok: true };
  });

export const saveEncryptedToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { id: string; tokenKey: string; tokenValue: string }) =>
    z.object({ id: z.string(), tokenKey: z.string(), tokenValue: z.string() }).parse(i),
  )
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const { data: row } = await sb
      .from("client_api_connections")
      .select("encrypted_credentials")
      .eq("id", data.id)
      .maybeSingle();
    const existing = decryptCredentials(row?.encrypted_credentials ?? null);
    existing[data.tokenKey] = data.tokenValue;
    const encrypted = encryptCredentials(existing);
    await sb
      .from("client_api_connections")
      .update({ encrypted_credentials: encrypted, status: "connected", updated_at: new Date().toISOString() })
      .eq("id", data.id);
    return { ok: true };
  });

/**
 * seedWebuyanyhouse — auto-seeds the WBAH connection if it doesn't exist yet.
 * Reads the access_token from enterprise_integrations (if present) and stores it
 * AES-encrypted in client_api_connections so the probe engine can use it.
 */
export const seedWebuyanyhouse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const sb = supabaseAdmin as any;

    const { data: existing } = await sb
      .from("client_api_connections")
      .select("id")
      .eq("name", "Webuyanyhouse")
      .maybeSingle();
    if (existing) return { seeded: false, id: existing.id };

    // Read live token from enterprise_integrations (if connected)
    const { data: eiRow } = await sb
      .from("enterprise_integrations")
      .select("access_token, refresh_token, status")
      .eq("integration_key", "webespoke_enterprise")
      .eq("client_name", "Webuyanyhouse")
      .maybeSingle();

    // enterprise_integrations has no base_url column — use the well-known WBAH endpoint
    const baseUrl = "https://uat-api.webespokeai.com";

    // Store a source reference only — probe engine fetches live tokens from
    // enterprise_integrations at probe time, so credentials stay in one place.
    const encryptedCreds = encryptCredentials({
      _source:          "enterprise_integrations",
      _integration_key: "webespoke_enterprise",
      _client_name:     "Webuyanyhouse",
    });

    const initialStatus = eiRow?.status === "connected" && eiRow?.access_token
      ? "connected"
      : "untested";

    const { data: row, error } = await sb
      .from("client_api_connections")
      .insert({
        name:                  "Webuyanyhouse",
        base_url:              baseUrl,
        auth_type:             "otp",
        client_id:             "webuyanyhouse",
        notes:                 "Seeded from enterprise_integrations. Credentials synced from the existing WBAH integration.",
        status:                initialStatus,
        encrypted_credentials: encryptedCreds,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const WBAH_ENDPOINTS = [
      { path: "/call-output-data/get-userCall-lead", method: "GET",  module_key: "leads",    pagination_strategy: "currentPage", detected_array_path: "data" },
      { path: "/call-output-data/get-user-history",  method: "POST", module_key: "calls",    pagination_strategy: "currentPage", detected_array_path: "data" },
      { path: "/call-output-data/get-all-calldata",  method: "GET",  module_key: "contacts", pagination_strategy: "currentPage", detected_array_path: "data" },
      { path: "/crm-data/get-crm-data",              method: "GET",  module_key: "contacts", pagination_strategy: "none",        detected_array_path: null   },
      { path: "/dashboard/total-call-minutes",        method: "POST", module_key: "analytics",pagination_strategy: "none",        detected_array_path: null   },
      { path: "/dashboard/number-of-calls",           method: "POST", module_key: "analytics",pagination_strategy: "none",        detected_array_path: null   },
      { path: "/campaigns",                           method: "GET",  module_key: "campaigns",pagination_strategy: "none",        detected_array_path: null   },
    ];

    const mappingRows = WBAH_ENDPOINTS.map((e) => ({
      client_api_connection_id: row.id,
      module_key:               e.module_key,
      endpoint_path:            e.path,
      method:                   e.method,
      pagination_strategy:      e.pagination_strategy,
      detected_array_path:      e.detected_array_path,
    }));
    await sb.from("client_api_endpoint_mappings").insert(mappingRows);

    return { seeded: true, id: row.id };
  });
