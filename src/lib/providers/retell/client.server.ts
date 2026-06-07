const RETELL_BASE = "https://api.retellai.com";

export class RetellApiError extends Error {
  constructor(
    public path: string,
    public status: number,
    public providerMessage: string,
  ) {
    super(`Retell ${path} ${status}: ${providerMessage}`);
    this.name = "RetellApiError";
  }
}

export async function retellFetch<T = Record<string, unknown>>(
  path: string,
  body: unknown,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "POST",
  overrideApiKey?: string,
): Promise<T> {
  const apiKey = overrideApiKey?.trim() || process.env.RETELL_API_KEY;
  if (!apiKey) {
    throw new Error("RETELL_API_KEY is not configured. Add it under project secrets.");
  }

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
    /* keep raw text */
  }

  if (!res.ok) {
    const fallback = text || res.statusText;
    const message =
      parsed && typeof parsed === "object"
        ? String(
            (parsed as { message?: unknown }).message ??
              (parsed as { error_message?: unknown }).error_message ??
              fallback,
          )
        : fallback;
    throw new RetellApiError(path, res.status, message);
  }

  return parsed as T;
}

const READONLY_KEYS = new Set([
  "conversation_flow_id",
  "agent_id",
  "version",
  "version_title",
  "is_published",
  "last_modification_timestamp",
  "base_version",
  "published_version",
  "channel",
  "llm_id",
  "response_engine_id",
]);

export function stripReadOnlyKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (READONLY_KEYS.has(k)) continue;
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}
