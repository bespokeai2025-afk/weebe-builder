/**
 * n8n Public API — READ-ONLY server-side client.
 *
 * ‼️  READ-ONLY BY CONTRACT ‼️
 * This module NEVER creates, edits, renames, activates, or deactivates any n8n
 * workflow. Only HTTP GET requests are ever issued. There are deliberately no
 * POST / PUT / PATCH / DELETE helpers here. Do not add any.
 *
 * Auth: header `X-N8N-API-KEY` (n8n public API key, never returned to the client).
 * Base: `N8N_API_BASE_URL` env var, e.g. https://bespoke.app.n8n.cloud/api/v1
 */

const DEFAULT_BASE = "https://bespoke.app.n8n.cloud/api/v1";

// ── Config ──────────────────────────────────────────────────────────────────────

export function isN8nConfigured(): boolean {
  return !!(process.env.N8N_API_KEY && process.env.N8N_API_KEY.trim());
}

/** Public, key-free base URL for display in the UI. */
export function getN8nBaseUrl(): string {
  return normalizeBase(process.env.N8N_API_BASE_URL);
}

function normalizeBase(raw: string | undefined): string {
  let base = (raw && raw.trim()) || DEFAULT_BASE;
  base = base.replace(/\/+$/, "");
  // If the caller only gave the instance origin, append the API path.
  if (!/\/api\/v\d+$/.test(base) && !/\/api\//.test(base)) {
    base = `${base}/api/v1`;
  }
  return base;
}

function getConfig(): { apiKey: string; baseUrl: string } {
  const apiKey = (process.env.N8N_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error(
      "n8n is not connected. Add the N8N_API_KEY secret (and optionally N8N_API_BASE_URL) to enable workflow discovery.",
    );
  }
  return { apiKey, baseUrl: getN8nBaseUrl() };
}

// ── Low-level GET (the ONLY verb this module issues) ─────────────────────────────

async function n8nGet<T>(path: string): Promise<T> {
  const { apiKey, baseUrl } = getConfig();
  const url = path.startsWith("http") ? path : `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET", // read-only — never anything else
      headers: {
        "X-N8N-API-KEY": apiKey,
        Accept: "application/json",
      },
    });
  } catch (err: any) {
    throw new Error(`n8n request failed: ${err?.message ?? "network error"}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (res.status === 401 || res.status === 403) {
      throw new Error("n8n authentication failed — check the N8N_API_KEY secret.");
    }
    throw new Error(`n8n API error ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// ── Types (partial — only what we read) ──────────────────────────────────────────

export interface N8nWorkflowSummary {
  id: string;
  name?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
  tags?: Array<{ id?: string; name?: string }> | string[];
  nodes?: any[];
  connections?: Record<string, any>;
  settings?: Record<string, any>;
  homeProject?: { id?: string; name?: string };
  [k: string]: any;
}

interface N8nListResponse {
  data: N8nWorkflowSummary[];
  nextCursor?: string | null;
}

// ── High-level read helpers ──────────────────────────────────────────────────────

/**
 * List every workflow the API key can see. Paginates via cursor. n8n returns
 * full workflow objects (including nodes/connections) on the list endpoint, so
 * a per-workflow fetch is usually unnecessary — but see `n8nGetWorkflow`.
 * Hard-capped so a runaway instance can't hang the scan.
 */
export async function n8nListWorkflows(maxWorkflows = 1000): Promise<N8nWorkflowSummary[]> {
  const out: N8nWorkflowSummary[] = [];
  let cursor: string | null | undefined;
  let guard = 0;
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const page = await n8nGet<N8nListResponse>(`/workflows?${qs.toString()}`);
    const rows = Array.isArray(page?.data) ? page.data : [];
    out.push(...rows);
    cursor = page?.nextCursor ?? null;
    guard += 1;
  } while (cursor && out.length < maxWorkflows && guard < 50);
  return out.slice(0, maxWorkflows);
}

/** Fetch a single full workflow definition (read-only). */
export async function n8nGetWorkflow(id: string): Promise<N8nWorkflowSummary> {
  return n8nGet<N8nWorkflowSummary>(`/workflows/${encodeURIComponent(id)}`);
}
