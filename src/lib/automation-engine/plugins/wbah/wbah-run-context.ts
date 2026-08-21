/**
 * WBAH plugin — shared run context from automation node input (Retell webhook shape).
 */
import type { NodeContext } from "../../types/node.types";
import { resolveWbahRetellAgent, type WbahRetellAgentMapping } from "@/lib/wbah/post-call/wbah-retell-agents.shared";
import { formatWbahRetellCallData } from "@/lib/wbah/post-call/wbah-format-data.shared";

export type RetellCallShape = {
  call_id?: string;
  agent_id?: string;
  call_type?: string;
  call_status?: string;
  to_number?: string;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    custom_analysis_data?: Record<string, unknown>;
  };
  transcript?: string;
  retell_llm_dynamic_variables?: Record<string, unknown>;
};

export type WbahRunBag = {
  event: string;
  call: RetellCallShape;
  payload: Record<string, unknown>;
  agent: WbahRetellAgentMapping;
  dynVars: Record<string, unknown>;
  leadId: string | null;
  formatted?: ReturnType<typeof formatWbahRetellCallData>;
  calendlyBookingUrl?: string | null;
  custom?: Record<string, unknown>;
};

function extractDynVars(call: RetellCallShape, payload: Record<string, unknown>): Record<string, unknown> {
  const fromCall = call.retell_llm_dynamic_variables ?? {};
  const nested =
    (payload.call as RetellCallShape | undefined)?.retell_llm_dynamic_variables ?? {};
  return { ...(typeof nested === "object" ? nested : {}), ...fromCall };
}

export function parseWbahRunBag(raw: Record<string, unknown>): Partial<WbahRunBag> | null {
  const body = (raw.body ?? raw) as Record<string, unknown>;
  const event = String(body.event ?? raw.event ?? "");
  const call = (body.call ?? raw.call ?? {}) as RetellCallShape;
  const payload = body as Record<string, unknown>;
  const agentId = String(call.agent_id ?? raw.agent_id ?? "");
  const agent = resolveWbahRetellAgent(agentId);
  if (!agent) return null;

  const dynVars = extractDynVars(call, payload);
  const leadId = String(dynVars.lead_id ?? dynVars.leadId ?? "").trim() || null;
  const wbah = (raw._wbah ?? {}) as Partial<WbahRunBag>;

  return {
    event,
    call,
    payload,
    agent,
    dynVars,
    leadId,
    formatted: wbah.formatted,
    calendlyBookingUrl: wbah.calendlyBookingUrl ?? null,
    custom: call.call_analysis?.custom_analysis_data ?? {},
  };
}

export function buildWbahRunBag(ctx: NodeContext): WbahRunBag | null {
  const trigger = (ctx.input.trigger ?? {}) as Record<string, unknown>;
  const merged = { ...trigger, ...ctx.input.json };
  const parsed = parseWbahRunBag(merged);
  if (!parsed?.agent || !parsed.event) return null;
  return parsed as WbahRunBag;
}

export function mergeWbahOutput(
  ctx: NodeContext,
  bag: Partial<WbahRunBag>,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const existing = buildWbahRunBag(ctx);
  const nextBag: Partial<WbahRunBag> = {
    ...(existing ?? {}),
    ...bag,
  };
  return {
    ...ctx.input.json,
    ...extra,
    event: nextBag.event,
    call: nextBag.call,
    leadId: nextBag.leadId,
    _wbah: nextBag,
  };
}

export function isWebCall(call: RetellCallShape): boolean {
  return call.call_type === "web_call" || call.call_type === "webcall";
}
