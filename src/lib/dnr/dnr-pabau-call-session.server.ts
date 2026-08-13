/**
 * Short-lived in-call memory for DNR Pabau tools.
 * Retell often omits contact_id / slot fields on book_appointment even after prior tools succeeded.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  dnrCoerceDate,
  dnrCoerceTime,
  dnrSplitIsoDatetime,
} from "@/lib/dnr/dnr-book-appointment.shared";

const TTL_MS = 30 * 60 * 1000;
const WORKSPACE_FALLBACK_CALL_ID = "";

export type DnrPabauSlot = { start_date: string; start_time: string };

export type DnrPabauCallSession = {
  contact_id?: string | number;
  phone?: string;
  service_name?: string;
  location_id?: number;
  practitioner_id?: number;
  slots?: DnrPabauSlot[];
  updated_at: number;
};

const byCall = new Map<string, DnrPabauCallSession>();
const latestByWorkspace = new Map<string, DnrPabauCallSession>();

function sessionKey(workspaceId: string, retellCallId?: string): string | null {
  if (retellCallId?.trim()) return `${workspaceId}:${retellCallId.trim()}`;
  return null;
}

function dbCallId(retellCallId?: string): string {
  return retellCallId?.trim() || WORKSPACE_FALLBACK_CALL_ID;
}

function prune(session: DnrPabauCallSession): DnrPabauCallSession | null {
  if (Date.now() - session.updated_at > TTL_MS) return null;
  return session;
}

function mergeSessions(
  a: DnrPabauCallSession | null,
  b: DnrPabauCallSession | null,
): DnrPabauCallSession | null {
  if (!a && !b) return null;
  const merged: DnrPabauCallSession = {
    ...(a ?? {}),
    ...(b ?? {}),
    updated_at: Math.max(a?.updated_at ?? 0, b?.updated_at ?? 0, Date.now()),
  };
  if (a?.slots?.length && !b?.slots?.length) merged.slots = a.slots;
  if (b?.slots?.length && !a?.slots?.length) merged.slots = b.slots;
  if (a?.contact_id != null && b?.contact_id == null) merged.contact_id = a.contact_id;
  if (b?.contact_id != null && a?.contact_id == null) merged.contact_id = b.contact_id;
  if (a?.service_name && !b?.service_name) merged.service_name = a.service_name;
  if (b?.service_name && !a?.service_name) merged.service_name = b.service_name;
  return prune(merged);
}

export function getDnrPabauCallSession(
  workspaceId: string,
  retellCallId?: string,
): DnrPabauCallSession | null {
  const key = sessionKey(workspaceId, retellCallId);
  let hit: DnrPabauCallSession | null = null;
  if (key) {
    const stored = byCall.get(key);
    if (stored) {
      hit = prune(stored);
      if (!hit) byCall.delete(key);
    }
  }
  const latest = latestByWorkspace.get(workspaceId);
  const latestFresh = latest ? prune(latest) : null;
  if (!latestFresh && latest) latestByWorkspace.delete(workspaceId);
  return mergeSessions(hit, latestFresh);
}

/** Load persisted session from Supabase when in-memory cache is incomplete. */
export async function hydrateDnrPabauCallSession(
  workspaceId: string,
  retellCallId?: string,
): Promise<DnrPabauCallSession | null> {
  const memory = getDnrPabauCallSession(workspaceId, retellCallId);
  const needsDb =
    !memory?.contact_id ||
    !memory?.service_name ||
    !memory?.slots?.length;

  if (!needsDb) return memory;

  try {
    const callId = dbCallId(retellCallId);
    const { data, error } = await supabaseAdmin
      .from("dnr_pabau_call_sessions" as never)
      .select("session, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("retell_call_id", callId)
      .maybeSingle();

    if (error || !data) {
      if (callId !== WORKSPACE_FALLBACK_CALL_ID) {
        const { data: fallback } = await supabaseAdmin
          .from("dnr_pabau_call_sessions" as never)
          .select("session, updated_at")
          .eq("workspace_id", workspaceId)
          .eq("retell_call_id", WORKSPACE_FALLBACK_CALL_ID)
          .maybeSingle();
        if (fallback?.session) {
          const dbSession = parseDbSession(fallback.session, fallback.updated_at);
          return mergeSessions(memory, dbSession);
        }
      }
      return memory;
    }

    const dbSession = parseDbSession(data.session, data.updated_at);
    const merged = mergeSessions(memory, dbSession);
    if (merged) writeSessionMemory(workspaceId, retellCallId, merged);
    return merged;
  } catch (e) {
    console.warn("[dnr-pabau] session hydrate failed (non-fatal)", e);
    return memory;
  }
}

function parseDbSession(raw: unknown, updatedAt?: string | null): DnrPabauCallSession | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const updatedMs = updatedAt ? Date.parse(updatedAt) : Date.now();
  const session: DnrPabauCallSession = {
    updated_at: Number.isNaN(updatedMs) ? Date.now() : updatedMs,
  };
  if (o.contact_id != null && o.contact_id !== "") session.contact_id = o.contact_id as string | number;
  if (typeof o.phone === "string") session.phone = o.phone;
  if (typeof o.service_name === "string") session.service_name = o.service_name;
  if (o.location_id != null) session.location_id = Number(o.location_id);
  if (o.practitioner_id != null) session.practitioner_id = Number(o.practitioner_id);
  if (Array.isArray(o.slots)) {
    session.slots = o.slots
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({
        start_date: String(s.start_date ?? ""),
        start_time: String(s.start_time ?? "").slice(0, 5),
      }))
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.start_date) && /^\d{2}:\d{2}$/.test(s.start_time));
  }
  return prune(session);
}

function writeSessionMemory(
  workspaceId: string,
  retellCallId: string | undefined,
  session: DnrPabauCallSession,
): DnrPabauCallSession {
  latestByWorkspace.set(workspaceId, session);
  const key = sessionKey(workspaceId, retellCallId);
  if (key) byCall.set(key, session);
  return session;
}

function persistDnrPabauCallSession(
  workspaceId: string,
  retellCallId: string | undefined,
  session: DnrPabauCallSession,
): void {
  const payload = {
    contact_id: session.contact_id ?? null,
    phone: session.phone ?? null,
    service_name: session.service_name ?? null,
    location_id: session.location_id ?? null,
    practitioner_id: session.practitioner_id ?? null,
    slots: session.slots ?? [],
  };
  void supabaseAdmin
    .from("dnr_pabau_call_sessions" as never)
    .upsert(
      {
        workspace_id: workspaceId,
        retell_call_id: dbCallId(retellCallId),
        session: payload,
        updated_at: new Date(session.updated_at).toISOString(),
      } as never,
      { onConflict: "workspace_id,retell_call_id" },
    )
    .then(({ error }) => {
      if (error) console.warn("[dnr-pabau] session persist failed (non-fatal)", error.message);
    });
}

function writeSession(
  workspaceId: string,
  retellCallId: string | undefined,
  patch: Partial<DnrPabauCallSession>,
): DnrPabauCallSession {
  const existing = getDnrPabauCallSession(workspaceId, retellCallId) ?? { updated_at: Date.now() };
  const next: DnrPabauCallSession = { ...existing, ...patch, updated_at: Date.now() };
  writeSessionMemory(workspaceId, retellCallId, next);
  persistDnrPabauCallSession(workspaceId, retellCallId, next);
  return next;
}

export function saveDnrClientSession(input: {
  workspaceId: string;
  retellCallId?: string;
  contact_id: string | number;
  phone?: string;
}): void {
  writeSession(input.workspaceId, input.retellCallId, {
    contact_id: input.contact_id,
    phone: input.phone,
  });
}

export function saveDnrAvailabilitySession(input: {
  workspaceId: string;
  retellCallId?: string;
  service_name: string;
  location_id?: number;
  practitioner_id?: number;
  slots: DnrPabauSlot[];
}): void {
  writeSession(input.workspaceId, input.retellCallId, {
    service_name: input.service_name,
    location_id: input.location_id,
    practitioner_id: input.practitioner_id,
    slots: input.slots,
  });
}

function pickString(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickSlotFromSession(
  session: DnrPabauCallSession,
  args: Record<string, unknown>,
): DnrPabauSlot | undefined {
  const slots = session.slots ?? [];
  if (!slots.length) return undefined;

  const idxRaw = args.slot_index ?? args.slotIndex ?? args.selected_slot_index;
  if (typeof idxRaw === "number" && slots[idxRaw]) return slots[idxRaw];
  if (typeof idxRaw === "string" && /^\d+$/.test(idxRaw)) {
    const idx = Number(idxRaw);
    if (slots[idx]) return slots[idx];
  }

  let dateHint = pickString(args, "start_date", "appointment_date", "date", "booking_date");
  let timeHint = pickString(args, "start_time", "appointment_time", "time", "booking_time");

  for (const isoKey of ["start", "datetime", "appointment_start", "start_datetime"]) {
    const iso = pickString(args, isoKey);
    if (!iso) continue;
    const split = dnrSplitIsoDatetime(iso);
    if (split.date && !dateHint) dateHint = split.date;
    if (split.time && !timeHint) timeHint = split.time;
  }

  const normDate = dateHint ? dnrCoerceDate(dateHint) : null;
  const normTime = timeHint ? dnrCoerceTime(timeHint) : null;

  if (normDate || normTime) {
    const match = slots.find(
      (s) =>
        (!normDate || s.start_date === normDate) &&
        (!normTime || s.start_time === normTime),
    );
    if (match) return match;
  }

  return slots[0];
}

export function applyDnrBookSession(
  args: Record<string, unknown>,
  session: DnrPabauCallSession | null,
): { args: Record<string, unknown>; filled_from_session: string[] } {
  if (!session) return { args, filled_from_session: [] };
  const out = { ...args };
  const filled: string[] = [];

  if (
    (out.contact_id == null || out.contact_id === "") &&
    session.contact_id != null &&
    session.contact_id !== ""
  ) {
    out.contact_id = session.contact_id;
    filled.push("contact_id");
  }

  if (!out.service_name && session.service_name) {
    out.service_name = session.service_name;
    filled.push("service_name");
  }

  if (out.location_id == null && session.location_id != null) {
    out.location_id = session.location_id;
    filled.push("location_id");
  }

  if (out.practitioner_id == null && session.practitioner_id != null) {
    out.practitioner_id = session.practitioner_id;
    filled.push("practitioner_id");
  }

  const slot = pickSlotFromSession(session, out);
  if (slot) {
    if (!out.start_date && slot.start_date) {
      out.start_date = slot.start_date;
      filled.push("start_date");
    }
    if (!out.start_time && slot.start_time) {
      out.start_time = slot.start_time;
      filled.push("start_time");
    }
  }

  return { args: out, filled_from_session: filled };
}

export function describeDnrBookSession(session: DnrPabauCallSession | null): {
  has_contact_id: boolean;
  has_service_name: boolean;
  has_location_id: boolean;
  has_practitioner_id: boolean;
  slot_count: number;
} {
  return {
    has_contact_id: session?.contact_id != null && session.contact_id !== "",
    has_service_name: Boolean(session?.service_name),
    has_location_id: session?.location_id != null,
    has_practitioner_id: session?.practitioner_id != null,
    slot_count: session?.slots?.length ?? 0,
  };
}

/** @internal test helper */
export function clearDnrPabauSessions(): void {
  byCall.clear();
  latestByWorkspace.clear();
}
