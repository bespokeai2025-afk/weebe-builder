// ── Central AI model registry — server side ──────────────────────────────────
// Resolves role → (provider, model, reasoning effort) with env-var overrides,
// and performs live availability checks against the configured credentials.
// All Mind code must resolve models through here — never hardcode model IDs.

import {
  DEFAULT_ROLE_ASSIGNMENTS,
  OPENAI_FALLBACK_CHAIN,
  type ModelRole,
  type RoleAssignment,
} from "./model-registry.shared";

/** Resolve the active assignment for a role, honouring env-var overrides. */
export function resolveModelForRole(role: ModelRole): RoleAssignment {
  const base = DEFAULT_ROLE_ASSIGNMENTS[role];
  const override = process.env[base.envVar]?.trim();
  if (override && override !== base.model) {
    return { ...base, model: override };
  }
  return base;
}

/**
 * Resolve the explicit OpenAI fallback chain for a starting model.
 * The chain is gpt-5.6-terra → gpt-5.5 → gpt-5.4 (env-overridable start via
 * HIVEMIND_FALLBACK_MODEL). It NEVER includes gpt-4o — fallbacks are explicit
 * and must be recorded in the ledger by the caller.
 */
export function resolveOpenAiFallbackChain(primaryModel: string): string[] {
  const envFallback = process.env.HIVEMIND_FALLBACK_MODEL?.trim();
  const chain: string[] = [primaryModel];
  const idx = OPENAI_FALLBACK_CHAIN.indexOf(primaryModel);
  const rest = idx >= 0 ? OPENAI_FALLBACK_CHAIN.slice(idx + 1) : OPENAI_FALLBACK_CHAIN.slice(1);
  if (envFallback && !chain.includes(envFallback)) chain.push(envFallback);
  for (const m of rest) if (!chain.includes(m)) chain.push(m);
  return chain;
}

// ── Availability checks ───────────────────────────────────────────────────────

export type ModelAvailability = {
  role: ModelRole;
  provider: string;
  model: string;
  available: boolean;
  checkedAt: string;
  error?: string;
};

let availabilityCache: { at: number; results: ModelAvailability[] } | null = null;
const AVAILABILITY_TTL_MS = 10 * 60 * 1000;

async function listOpenAiModels(apiKey: string): Promise<Set<string>> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenAI /v1/models ${res.status}`);
  const j = (await res.json()) as any;
  return new Set((j.data ?? []).map((m: any) => String(m.id)));
}

async function listGeminiModels(apiKey: string): Promise<Set<string>> {
  const out = new Set<string>();
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gemini models list ${res.status}`);
    const j = (await res.json()) as any;
    for (const m of j.models ?? []) out.add(String(m.name ?? "").replace(/^models\//, ""));
    pageToken = j.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return out;
}

/**
 * Check that every registry model actually exists on the configured
 * credentials. Cached for 10 minutes. Never throws — a provider outage
 * reports the affected roles as unavailable with the error message.
 */
export async function checkModelAvailability(force = false): Promise<ModelAvailability[]> {
  if (!force && availabilityCache && Date.now() - availabilityCache.at < AVAILABILITY_TTL_MS) {
    return availabilityCache.results;
  }

  const roles = Object.keys(DEFAULT_ROLE_ASSIGNMENTS) as ModelRole[];
  const assignments = roles.map(resolveModelForRole);
  const now = new Date().toISOString();

  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  let openaiModels: Set<string> | null = null;
  let openaiErr = "";
  let geminiModels: Set<string> | null = null;
  let geminiErr = "";

  const [oRes, gRes] = await Promise.allSettled([
    openaiKey ? listOpenAiModels(openaiKey) : Promise.reject(new Error("OPENAI_API_KEY not configured")),
    geminiKey ? listGeminiModels(geminiKey) : Promise.reject(new Error("GEMINI_API_KEY not configured")),
  ]);
  if (oRes.status === "fulfilled") openaiModels = oRes.value;
  else openaiErr = String((oRes as any).reason?.message ?? oRes.reason);
  if (gRes.status === "fulfilled") geminiModels = gRes.value;
  else geminiErr = String((gRes as any).reason?.message ?? gRes.reason);

  const results: ModelAvailability[] = assignments.map((a) => {
    if (a.provider === "openai") {
      if (!openaiModels) return { role: a.role, provider: a.provider, model: a.model, available: false, checkedAt: now, error: openaiErr };
      return { role: a.role, provider: a.provider, model: a.model, available: openaiModels.has(a.model), checkedAt: now };
    }
    if (a.provider === "gemini") {
      if (!geminiModels) return { role: a.role, provider: a.provider, model: a.model, available: false, checkedAt: now, error: geminiErr };
      return { role: a.role, provider: a.provider, model: a.model, available: geminiModels.has(a.model), checkedAt: now };
    }
    return { role: a.role, provider: a.provider, model: a.model, available: false, checkedAt: now, error: `No availability check for provider ${a.provider}` };
  });

  availabilityCache = { at: Date.now(), results };
  return results;
}
