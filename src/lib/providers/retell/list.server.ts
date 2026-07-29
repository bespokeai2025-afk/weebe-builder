/**
 * Retell "list" endpoint helpers — post-deprecation API surface (July 2026).
 *
 * Migrations implemented here (old → new):
 *   GET  /list-agents        → POST /v2/list-agents   (items[], pagination_key while has_more)
 *   GET  /list-chat-agents   → POST /v2/list-agents
 *   POST /v2/list-calls      → POST /v3/list-calls    (items[], pagination_key while has_more)
 *   GET  /list-phone-numbers → GET  /v2/list-phone-numbers (items[], pagination_key while has_more)
 *
 * Rules (per Retell deprecation notice):
 * - Read records from `response.items` (defensively also accept a bare array
 *   or legacy field names so a transitional API shape cannot zero out data).
 * - Keep requesting pages with `pagination_key` while `has_more` is true.
 * - Never send `pagination_key_version`.
 * - A failed page fails the WHOLE listing (throw) — callers must not treat a
 *   partial result as a successful sync.
 * - 429 / transient 5xx / network errors are retried with backoff before failing.
 */

const RETELL_BASE = "https://api.retellai.com";

export class RetellListError extends Error {
  constructor(
    public path: string,
    public status: number,
    public providerMessage: string,
  ) {
    super(`Retell ${path} ${status}: ${providerMessage}`);
    this.name = "RetellListError";
  }
}

const MAX_ATTEMPTS = 4;
const MAX_PAGES = 200; // hard safety net; throw loudly rather than loop forever

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function retellRequest(
  path: string,
  method: "GET" | "POST",
  body: Record<string, unknown> | undefined,
  apiKey: string,
): Promise<any> {
  let lastErr: any;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${RETELL_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: method === "POST" && body ? JSON.stringify(body) : undefined,
      });
    } catch (e: any) {
      // network-level failure — transient, retry
      lastErr = e;
      if (attempt < MAX_ATTEMPTS) await sleep(500 * attempt);
      continue;
    }
    if (res.ok) {
      const text = await res.text();
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        throw new RetellListError(path, res.status, "invalid JSON response");
      }
    }
    const text = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    lastErr = new RetellListError(path, res.status, text || res.statusText);
    if (!retryable || attempt >= MAX_ATTEMPTS) throw lastErr;
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800 * attempt);
  }
  throw lastErr;
}

function resolveKey(overrideApiKey?: string): string {
  const key = overrideApiKey?.trim() || process.env.RETELL_API_KEY;
  if (!key) throw new Error("RETELL_API_KEY is not configured. Add it under project secrets.");
  return key;
}

/** Extract records from a new-style paginated response (defensive). */
function pageItems(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.agents)) return res.agents;
  if (Array.isArray(res?.calls)) return res.calls;
  if (Array.isArray(res?.phone_numbers)) return res.phone_numbers;
  return [];
}

function pageCursor(res: any): string | undefined {
  const k = res?.pagination_key ?? res?.next_pagination_key;
  return typeof k === "string" && k.length > 0 ? k : undefined;
}

function pageHasMore(res: any, items: any[], cursor: string | undefined): boolean {
  if (typeof res?.has_more === "boolean") return res.has_more && !!cursor;
  // Legacy bare-array shape: no has_more field — stop (single page).
  return false;
}

async function listPaged(
  path: string,
  method: "GET" | "POST",
  baseBody: Record<string, unknown> | undefined,
  apiKey: string,
): Promise<any[]> {
  const out: any[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let res: any;
    if (method === "POST") {
      const body: Record<string, unknown> = { ...(baseBody ?? {}) };
      if (cursor) body.pagination_key = cursor;
      res = await retellRequest(path, "POST", body, apiKey);
    } else {
      const qs = cursor ? `${path.includes("?") ? "&" : "?"}pagination_key=${encodeURIComponent(cursor)}` : "";
      res = await retellRequest(`${path}${qs}`, "GET", undefined, apiKey);
    }
    const items = pageItems(res);
    // The live API has been observed returning has_more=true with recycling
    // cursors past the last real page — count NEW records per page and stop
    // when a page contributes nothing new (dedupe by natural record id).
    let added = 0;
    for (const it of items) {
      // call_id MUST come first: call records also carry agent_id, and keying
      // on agent_id collapses every call after the first per agent.
      const id = String(it?.call_id ?? it?.agent_id ?? it?.phone_number ?? "");
      if (id) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      out.push(it);
      added++;
    }
    cursor = pageCursor(res);
    if (!pageHasMore(res, items, cursor)) return out;
    if (items.length === 0 || added === 0) return out; // defensive: repeating pages
    if (cursor && seenCursors.has(cursor)) return out; // cursor loop
    if (cursor) seenCursors.add(cursor);
  }
  throw new RetellListError(path, 0, `pagination exceeded ${MAX_PAGES} pages — refusing to continue`);
}

/**
 * List agents via POST /v2/list-agents.
 * Pass { channel: "voice" } when loading CALLING agents (the default) —
 * pass { channel: null } to list every channel.
 */
export async function listRetellAgents(
  overrideApiKey?: string,
  opts?: { channel?: "voice" | "chat" | null; limit?: number },
): Promise<any[]> {
  const apiKey = resolveKey(overrideApiKey);
  const channel = opts?.channel === undefined ? "voice" : opts.channel;
  const body: Record<string, unknown> = { limit: opts?.limit ?? 1000 };
  // Verified against the live API (July 2026): channel filter must be a
  // structured predicate object, not an array.
  if (channel) body.filter_criteria = { channel: { type: "string", op: "eq", value: channel } };
  return listPaged("/v2/list-agents", "POST", body, apiKey);
}

/** List phone numbers via GET /v2/list-phone-numbers (paginated). */
export async function listRetellPhoneNumbers(overrideApiKey?: string): Promise<any[]> {
  const apiKey = resolveKey(overrideApiKey);
  return listPaged("/v2/list-phone-numbers", "GET", undefined, apiKey);
}

/**
 * Translate the legacy /v2/list-calls filter_criteria shape into the /v3
 * structured-predicate grammar (verified against the live API, July 2026):
 *   - string arrays  → { type: "enum",   op: "in", value: [...] }  (call_status)
 *                    → { type: "string", op: "in", value: [...] }  (ids)
 *   - { lower_threshold, upper_threshold } →
 *       both bounds → { type: "range",  op: "bt", value: [lo, hi] }
 *       lower only  → { type: "number", op: "ge", value: lo }
 *       upper only  → { type: "number", op: "le", value: hi }
 * Already-structured predicates (objects with `op`) pass through untouched.
 */
const ENUM_FILTER_FIELDS = new Set(["call_status", "call_type", "direction", "disconnection_reason", "call_successful", "in_voicemail", "user_sentiment"]);

export function toV3FilterCriteria(
  legacy: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!legacy) return undefined;
  const out: Record<string, unknown> = {};
  for (const [field, v] of Object.entries(legacy)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      out[field] = {
        type: ENUM_FILTER_FIELDS.has(field) ? "enum" : "string",
        op: "in",
        value: v,
      };
    } else if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.op === "string") {
        out[field] = o; // already structured
      } else if (o.lower_threshold != null || o.upper_threshold != null) {
        const lo = o.lower_threshold as number | undefined;
        const hi = o.upper_threshold as number | undefined;
        out[field] =
          lo != null && hi != null
            ? { type: "range", op: "bt", value: [lo, hi] }
            : lo != null
              ? { type: "number", op: "ge", value: lo }
              : { type: "number", op: "le", value: hi };
      } else {
        out[field] = o;
      }
    } else {
      out[field] = {
        type: ENUM_FILTER_FIELDS.has(field) ? "enum" : typeof v === "number" ? "number" : "string",
        op: "eq",
        value: v,
      };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * List calls via POST /v3/list-calls, traversing EVERY page (throws if any
 * page fails after retries). `filterCriteria`/`sortOrder`/`limit` mirror the
 * old /v2 body fields. Results are deduplicated by call_id.
 */
export async function listRetellCalls(
  body: {
    filter_criteria?: Record<string, unknown>;
    sort_order?: "ascending" | "descending";
    limit?: number;
  },
  overrideApiKey?: string,
): Promise<any[]> {
  const apiKey = resolveKey(overrideApiKey);
  const rows = await listPaged(
    "/v3/list-calls",
    "POST",
    { limit: 1000, ...body, filter_criteria: toV3FilterCriteria(body.filter_criteria) },
    apiKey,
  );
  const seen = new Set<string>();
  const out: any[] = [];
  for (const c of rows) {
    const id = String(c?.call_id ?? "");
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(c);
  }
  return out;
}

/**
 * Single-page /v3/list-calls request for callers that manage their own
 * paging/caps (e.g. incremental syncs). Returns items + cursor + has_more.
 */
export async function listRetellCallsPage(
  body: {
    filter_criteria?: Record<string, unknown>;
    sort_order?: "ascending" | "descending";
    limit?: number;
    pagination_key?: string;
  },
  overrideApiKey?: string,
): Promise<{ items: any[]; paginationKey: string | undefined; hasMore: boolean }> {
  const apiKey = resolveKey(overrideApiKey);
  const res = await retellRequest(
    "/v3/list-calls",
    "POST",
    { limit: 1000, ...body, filter_criteria: toV3FilterCriteria(body.filter_criteria) },
    apiKey,
  );
  const items = pageItems(res);
  const cursor = pageCursor(res);
  return { items, paginationKey: cursor, hasMore: pageHasMore(res, items, cursor) };
}
