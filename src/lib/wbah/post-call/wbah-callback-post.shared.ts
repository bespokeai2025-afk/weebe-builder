/**
 * Callback-only POST body for bespoke_ai_backend `callback_request` table.
 * Must NOT include `raw_data` — send as a separate request from post-call results.
 */
import type { WbahFormattedCallData } from "./wbah-format-data.shared";
import { WBAH_TIMEZONE } from "@/lib/dashboard/wbah-timezone";

export type WbahCallbackRequestBody = {
  is_callback_request: true;
  lead_id: string;
  callback_datetime: string;
  callback_type: string;
  call_id: string;
  agent_id: string;
  call_status: string;
  call_summary: string;
  crm_status: number;
};

type RetellCallLike = {
  call_id?: string;
  agent_id?: string;
  call_status?: string;
  call_analysis?: { call_summary?: string };
};

/** Normalize naive UK datetime to `YYYY-MM-DD HH:mm:ss` (Europe/London wall clock). */
export function formatCallbackDatetimeForBackend(raw: string | null | undefined): string {
  const cb = String(raw ?? "").trim();
  if (!cb || cb === "NA") return "";

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cb)) return cb;

  const bareDateTime = cb.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/);
  if (bareDateTime) {
    const sec = bareDateTime[3] ?? "00";
    return `${bareDateTime[1]} ${bareDateTime[2]}:${sec}`;
  }

  if (/[+-]\d{2}:?\d{2}$/.test(cb)) return cb;

  if (/Z$/i.test(cb) || cb.includes("T")) {
    const london = utcIsoToLondonBareString(cb);
    if (london) return london;
  }

  return cb;
}

function utcIsoToLondonBareString(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: WBAH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:${get("second")}`;
}

export function buildWbahCallbackRequestBody(input: {
  leadId: string;
  call: RetellCallLike;
  formatted: WbahFormattedCallData;
}): WbahCallbackRequestBody | null {
  const callId = input.call.call_id?.trim();
  const leadId = input.leadId.trim();
  const agentId = String(input.call.agent_id ?? "").trim();

  if (!callId || !leadId) return null;

  return {
    is_callback_request: true,
    lead_id: leadId,
    callback_datetime: formatCallbackDatetimeForBackend(input.formatted.callbackDatetime),
    callback_type: input.formatted.callbackType?.trim() || "callback_request",
    call_id: callId,
    agent_id: agentId,
    call_status: String(input.call.call_status ?? "ended").trim() || "ended",
    call_summary:
      input.formatted.callSummary?.trim() ||
      input.call.call_analysis?.call_summary?.trim() ||
      "",
    crm_status: 1,
  };
}

/** Whether a callback POST should be attempted (backend no-ops on blank datetime). */
export function shouldPostWbahCallbackRequest(body: WbahCallbackRequestBody | null): body is WbahCallbackRequestBody {
  return body != null && Boolean(body.call_id && body.lead_id);
}
