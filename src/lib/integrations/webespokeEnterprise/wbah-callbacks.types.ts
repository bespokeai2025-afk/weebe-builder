export type CallbackStatus = "pending" | "due" | "upcoming" | "completed";

export interface CallbackSummary {
  pending: number;
  due: number;
  upcoming: number;
  completedRecent: number;
  missingPhone: number;
}

export interface CallbackRow {
  id: string;
  leadId: string;
  name: string;
  mobile: string;
  email: string | null;
  leadStatus: string | null;
  crmType: string;
  callbackDatetime: string | null;
  callbackType: string | null;
  callbackAgentId: string | null;
  callbackCallId: string | null;
  callStatus: string | null;
  callSummary: string | null;
  crmStatus: number | null;
  isCallbackPending: boolean;
  callbackCompleted: boolean;
  callbackCompletedAt: string | null;
  isOverdue: boolean;
  hasPhone: boolean;
  status: "due" | "upcoming" | "completed";
  minutesUntilDue: number | null;
  minutesOverdue: number | null;
}

export interface CallbackListPagination {
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

export const CALLBACK_SOURCE_LABELS: Record<string, string> = {
  call_now: "Call now (Dynamics)",
  dynamics_callback: "Dynamics",
};

export function sourceLabel(type: string | null): string {
  if (type === "call_now") return CALLBACK_SOURCE_LABELS.call_now;
  if (type === "dynamics_callback") return CALLBACK_SOURCE_LABELS.dynamics_callback;
  return "AI call";
}

export function formatCallbackTime(row: CallbackRow): string {
  if (!row.callbackDatetime) return "—";
  return new Date(row.callbackDatetime).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function pick<T>(raw: Record<string, unknown>, camel: string, snake: string): T | undefined {
  if (raw[camel] !== undefined && raw[camel] !== null) return raw[camel] as T;
  if (raw[snake] !== undefined && raw[snake] !== null) return raw[snake] as T;
  return undefined;
}

function pickStr(raw: Record<string, unknown>, camel: string, snake: string, fallback = ""): string {
  const v = pick<string | number>(raw, camel, snake);
  return v == null ? fallback : String(v);
}

function pickBool(raw: Record<string, unknown>, camel: string, snake: string, fallback = false): boolean {
  const v = pick<boolean>(raw, camel, snake);
  return typeof v === "boolean" ? v : fallback;
}

function pickNum(raw: Record<string, unknown>, camel: string, snake: string): number | null {
  const v = pick<number>(raw, camel, snake);
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

export function normalizeCallbackSummary(raw: unknown): CallbackSummary {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    pending: Number(pickNum(o, "pending", "pending") ?? 0),
    due: Number(pickNum(o, "due", "due") ?? 0),
    upcoming: Number(pickNum(o, "upcoming", "upcoming") ?? 0),
    completedRecent: Number(
      pickNum(o, "completedRecent", "completed_recent") ?? 0,
    ),
    missingPhone: Number(pickNum(o, "missingPhone", "missing_phone") ?? 0),
  };
}

export function normalizeCallbackRow(raw: unknown, idx = 0): CallbackRow {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const statusRaw = pick<string>(r, "status", "status");
  const status: CallbackRow["status"] =
    statusRaw === "due" || statusRaw === "upcoming" || statusRaw === "completed"
      ? statusRaw
      : "upcoming";

  return {
    id: pickStr(r, "id", "id", pickStr(r, "_id", "_id", String(idx))),
    leadId: pickStr(r, "leadId", "lead_id"),
    name: pickStr(r, "name", "name"),
    mobile: pickStr(r, "mobile", "mobile"),
    email: (pick<string>(r, "email", "email") ?? null) as string | null,
    leadStatus: (pick<string>(r, "leadStatus", "lead_status") ?? null) as string | null,
    crmType: pickStr(r, "crmType", "crm_type", "unknown"),
    callbackDatetime: (pick<string>(r, "callbackDatetime", "callback_datetime") ?? null) as
      | string
      | null,
    callbackType: (pick<string>(r, "callbackType", "callback_type") ?? null) as string | null,
    callbackAgentId: (pick<string>(r, "callbackAgentId", "callback_agent_id") ?? null) as
      | string
      | null,
    callbackCallId: (pick<string>(r, "callbackCallId", "callback_call_id") ?? null) as
      | string
      | null,
    callStatus: (pick<string>(r, "callStatus", "call_status") ?? null) as string | null,
    callSummary: (pick<string>(r, "callSummary", "call_summary") ?? null) as string | null,
    crmStatus: pickNum(r, "crmStatus", "crm_status"),
    isCallbackPending: pickBool(r, "isCallbackPending", "is_callback_pending"),
    callbackCompleted: pickBool(r, "callbackCompleted", "callback_completed"),
    callbackCompletedAt: (pick<string>(r, "callbackCompletedAt", "callback_completed_at") ??
      null) as string | null,
    isOverdue: pickBool(r, "isOverdue", "is_overdue"),
    hasPhone: pickBool(r, "hasPhone", "has_phone", true),
    status,
    minutesUntilDue: pickNum(r, "minutesUntilDue", "minutes_until_due"),
    minutesOverdue: pickNum(r, "minutesOverdue", "minutes_overdue"),
  };
}

export function unwrapWbahEnvelope<T>(raw: unknown): T {
  const o = raw as Record<string, unknown> | null;
  if (!o) return {} as T;
  if (o.data !== undefined) return o.data as T;
  return o as T;
}

export const CALLBACK_TABS: {
  key: CallbackStatus;
  label: string;
  countKey: keyof CallbackSummary;
}[] = [
  { key: "pending", label: "All pending", countKey: "pending" },
  { key: "due", label: "Due now", countKey: "due" },
  { key: "upcoming", label: "Upcoming", countKey: "upcoming" },
  { key: "completed", label: "Completed (7d)", countKey: "completedRecent" },
];
