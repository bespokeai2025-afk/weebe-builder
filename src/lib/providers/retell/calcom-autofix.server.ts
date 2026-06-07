/**
 * Auto-fix Retell agents that use Cal.com booking so they never fire
 * `book_appointment_cal` with empty attendee fields.
 *
 * Runs on:
 *   - POST /api/public/agents/register (after the builder publishes)
 *   - the manual "Auto-fix booking tool" button in /my-agents
 *
 * What it patches (best-effort, never throws — Retell shapes vary):
 *   1. Conversation flow tools/general_tools — any tool whose type contains
 *      "cal" (e.g. `book_appointment_cal`) gets:
 *        - cal_api_key  ← workspace_settings.calcom_api_key
 *        - event_type_id ← workspace_settings.calcom_event_type_id
 *        - timezone      ← workspace_settings.timezone (fallback Europe/London)
 *        - description bumped to REQUIRE attendee_email + attendee_phone
 *   2. Agent `default_dynamic_variables` — sets
 *        attendee_phone = "{{from_number}}"
 *      so inbound calls always have a phone fallback for Cal.com.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
const sb = supabaseAdmin as any;
import { retellFetch, stripReadOnlyKeys } from "./client.server";

const ATTENDEE_RULES = [
  "CRITICAL: never invoke this tool without BOTH `attendee_email` and `attendee_phone`.",
  "Collect the caller's email and confirm it back letter-by-letter before booking.",
  "For inbound calls, default `attendee_phone` to the caller's number ({{from_number}}).",
  "If the caller refuses to share an email, do NOT call this tool — offer to take a message instead.",
].join(" ");

function isCalBookingTool(t: unknown): t is Record<string, unknown> {
  if (!t || typeof t !== "object") return false;
  const type = String((t as Record<string, unknown>).type ?? "").toLowerCase();
  return (
    type.includes("book_appointment_cal") || type === "book_appointment" || type.includes("calcom")
  );
}

function mergedDescription(prev: unknown): string {
  const base = typeof prev === "string" ? prev.trim() : "";
  if (base.includes("attendee_email") && base.includes("attendee_phone")) return base;
  return base ? `${base}\n\n${ATTENDEE_RULES}` : ATTENDEE_RULES;
}

function patchToolsArray(
  tools: unknown,
  apiKey: string | null,
  eventTypeId: string | null,
  timezone: string,
): { tools: unknown[]; patched: number } {
  if (!Array.isArray(tools)) return { tools: [], patched: 0 };
  let patched = 0;
  const next = tools.map((t) => {
    if (!isCalBookingTool(t)) return t;
    patched += 1;
    const cur = t as Record<string, unknown>;
    return {
      ...cur,
      ...(apiKey ? { cal_api_key: apiKey } : {}),
      ...(eventTypeId ? { event_type_id: eventTypeId } : {}),
      timezone: cur.timezone || timezone,
      description: mergedDescription(cur.description),
    };
  });
  return { tools: next, patched };
}

export interface CalcomAutofixResult {
  ok: boolean;
  message: string;
  toolsPatched: number;
  flowPatched: boolean;
  agentPatched: boolean;
  warnings: string[];
}

export async function autofixCalcomBooking(args: {
  workspaceId: string;
  retellAgentId: string;
  retellConversationFlowId?: string | null;
}): Promise<CalcomAutofixResult> {
  const warnings: string[] = [];

  // 1. Load workspace Cal.com config.
  const { data: settings } = await sb
    .from("workspace_settings")
    .select("calcom_api_key, calcom_event_type_id, timezone")
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  const apiKey = (settings?.calcom_api_key as string | null) ?? null;
  const eventTypeId = (settings?.calcom_event_type_id as string | null) ?? null;
  const timezone = (settings?.timezone as string | null) ?? "Europe/London";
  if (!apiKey)
    warnings.push(
      "Cal.com API token not set in Settings — tool description hardened, but cal_api_key not injected.",
    );
  if (!eventTypeId)
    warnings.push("Cal.com event type id not set in Settings — event_type_id not injected.");

  // 2. Resolve flow id (caller may not have it).
  let flowId = args.retellConversationFlowId ?? null;
  let agentPayload: Record<string, unknown> | null = null;
  try {
    agentPayload = await retellFetch<Record<string, unknown>>(
      `/get-agent/${encodeURIComponent(args.retellAgentId)}`,
      undefined,
      "GET",
    );
    if (!flowId) {
      const engine = agentPayload.response_engine as { conversation_flow_id?: string } | undefined;
      flowId = engine?.conversation_flow_id ?? null;
    }
  } catch (e) {
    warnings.push(`Could not load Retell agent: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Patch flow tools.
  let toolsPatched = 0;
  let flowPatched = false;
  if (flowId) {
    try {
      const flow = await retellFetch<Record<string, unknown>>(
        `/get-conversation-flow/${encodeURIComponent(flowId)}`,
        undefined,
        "GET",
      );
      const r1 = patchToolsArray(flow.tools, apiKey, eventTypeId, timezone);
      const r2 = patchToolsArray(flow.general_tools, apiKey, eventTypeId, timezone);
      toolsPatched = r1.patched + r2.patched;
      if (toolsPatched > 0) {
        const body: Record<string, unknown> = stripReadOnlyKeys({
          ...flow,
          ...(Array.isArray(flow.tools) ? { tools: r1.tools } : {}),
          ...(Array.isArray(flow.general_tools) ? { general_tools: r2.tools } : {}),
        });
        await retellFetch(`/update-conversation-flow/${encodeURIComponent(flowId)}`, body, "PATCH");
        flowPatched = true;
      } else {
        warnings.push("No Cal.com booking tool found on this flow — nothing to patch.");
      }
    } catch (e) {
      warnings.push(`Flow patch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    warnings.push("Agent has no conversation_flow_id — cannot patch booking tool.");
  }

  // 4. Patch agent default dynamic variables so attendee_phone has a fallback.
  let agentPatched = false;
  try {
    const current =
      (agentPayload?.default_dynamic_variables as Record<string, unknown> | undefined) ?? {};
    const next = {
      ...current,
      attendee_phone: current.attendee_phone || "{{from_number}}",
    };
    await retellFetch(
      `/update-agent/${encodeURIComponent(args.retellAgentId)}`,
      { default_dynamic_variables: next },
      "PATCH",
    );
    agentPatched = true;
  } catch (e) {
    warnings.push(`Agent variable patch failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const ok = flowPatched || agentPatched;
  const summary = ok
    ? `Patched ${toolsPatched} Cal.com tool(s)${agentPatched ? " + agent variables" : ""}.`
    : "No automatic changes applied — see warnings.";
  return { ok, message: summary, toolsPatched, flowPatched, agentPatched, warnings };
}
