/** Builder — helpers shared by Retell deploy and clone: API keys, payload clean-up and redaction, booking tools. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildBookingTools } from "@/lib/calendar/booking-tools.server";
import { getRetailRetellApiKey } from "@/lib/deploy/config.server";
import { retellHybridPrompt } from "@/lib/voice/graph/speech-mode.shared";

/**
 * Look up whether the signed-in user has Cal.com configured at the workspace
 * level. Returns the tool definitions to attach (or null when not connected).
 */
export async function maybeBuildBookingToolsForWorkspace(workspaceId: string) {
  const { data } = await supabaseAdmin
    .from("workspace_settings")
    .select("calcom_api_key")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  // Attach booking tools whenever a Cal.com API key exists. The endpoints
  // auto-pick the first active synced event type when no default is set.
  if (!data?.calcom_api_key) return null;
  return buildBookingTools();
}

export function sanitizeRetellConversationFlow(cf: Record<string, unknown>): Record<string, unknown> {
  const nodes = Array.isArray(cf.nodes) ? cf.nodes : [];
  return {
    ...cf,
    nodes: nodes.map((node) => {
      if (!node || typeof node !== "object") return node;
      const rec = node as Record<string, unknown>;
      const instruction = rec.instruction;
      if (!instruction || typeof instruction !== "object") return rec;
      const instr = instruction as Record<string, unknown>;
      const type = String(instr.type ?? "");
      const prefix = String(instr.prefix ?? "").trim();
      const text = String(instr.text ?? "");
      if (type === "hybrid") {
        const { prefix: _drop, ...rest } = instr;
        return {
          ...rec,
          instruction: {
            ...rest,
            type: "prompt",
            text: retellHybridPrompt(prefix, text),
          },
          response_mode: "llm",
        };
      }
      if (type === "template") {
        return {
          ...rec,
          instruction: { ...instr, type: "static_text" },
          response_mode: rec.response_mode === "template" ? "static" : rec.response_mode,
        };
      }
      return rec;
    }),
  };
}

export function resolveProductionApiKey(explicitKey: string | undefined): string {
  const trimmed = explicitKey?.trim();
  if (trimmed) return trimmed;
  const retailKey = getRetailRetellApiKey();
  if (retailKey) return retailKey;
  throw new Error(
    "A production Retell API key is required. Provide one or set RETELL_RETAIL_API_KEY in .env.",
  );
}

export function readProductionRetellApiKey(settings: unknown) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const value = (settings as Record<string, unknown>).productionRetellApiKey;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Fields Retell rejects on create/PATCH (read-only / system-managed).
export const READONLY_KEYS = [
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
];

export function stripKeys(obj: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k)) continue;
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export function redactRetellPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRetellPayload);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/api[_-]?key|authorization|password|secret|token/i.test(key)) out[key] = "[REDACTED]";
    else out[key] = redactRetellPayload(child);
  }
  return out;
}

/**
 * Compare critical transfer fields between what we sent and what Retell
 * stored. Only flags fields we explicitly set — Retell adds defaults to many
 * optional fields (e.g. `ring_duration_ms`, `transfer_option.on_hold_music`)
 * so a naive deep-equal produces false positives that block valid deploys.
 *
 * Hard-fail fields (cause deploy error): `type`, `transfer_destination`.
 * Soft-warn fields (logged only): everything else we sent.
 */
export function transferSchemaMismatches(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  const HARD = ["type", "transfer_destination"] as const;
  const SOFT = [
    "transfer_option",
    "ignore_e164_validation",
    "custom_sip_headers",
    "extension_dial_string",
    "cold_transfer_mode",
    "show_transferee_as_caller",
    "transfer_ring_duration_ms",
  ] as const;
  const hard: string[] = [];
  const soft: string[] = [];
  for (const f of HARD) {
    if (expected[f] !== undefined && JSON.stringify(expected[f]) !== JSON.stringify(actual[f]))
      hard.push(f);
  }
  for (const f of SOFT) {
    if (expected[f] !== undefined && JSON.stringify(expected[f]) !== JSON.stringify(actual[f]))
      soft.push(f);
  }
  return { hard, soft };
}
