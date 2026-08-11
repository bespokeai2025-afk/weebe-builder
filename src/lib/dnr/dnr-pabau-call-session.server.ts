/**
 * Short-lived in-call memory for DNR Pabau tools.
 * Retell often omits contact_id / slot fields on book_appointment even after prior tools succeeded.
 */
const TTL_MS = 30 * 60 * 1000;

export type DnrPabauSlot = { start_date: string; start_time: string };

export type DnrPabauCallSession = {
  contact_id?: string | number;
  phone?: string;
  service_name?: string;
  slots?: DnrPabauSlot[];
  updated_at: number;
};

const byCall = new Map<string, DnrPabauCallSession>();
const latestByWorkspace = new Map<string, DnrPabauCallSession>();

function sessionKey(workspaceId: string, retellCallId?: string): string | null {
  if (retellCallId?.trim()) return `${workspaceId}:${retellCallId.trim()}`;
  return null;
}

function prune(session: DnrPabauCallSession): DnrPabauCallSession | null {
  if (Date.now() - session.updated_at > TTL_MS) return null;
  return session;
}

export function getDnrPabauCallSession(
  workspaceId: string,
  retellCallId?: string,
): DnrPabauCallSession | null {
  const key = sessionKey(workspaceId, retellCallId);
  if (key) {
    const hit = byCall.get(key);
    if (hit) {
      const fresh = prune(hit);
      if (fresh) return fresh;
      byCall.delete(key);
    }
  }
  const latest = latestByWorkspace.get(workspaceId);
  if (!latest) return null;
  const fresh = prune(latest);
  if (!fresh) {
    latestByWorkspace.delete(workspaceId);
    return null;
  }
  return fresh;
}

function writeSession(
  workspaceId: string,
  retellCallId: string | undefined,
  patch: Partial<DnrPabauCallSession>,
): DnrPabauCallSession {
  const existing = getDnrPabauCallSession(workspaceId, retellCallId) ?? { updated_at: Date.now() };
  const next: DnrPabauCallSession = { ...existing, ...patch, updated_at: Date.now() };
  latestByWorkspace.set(workspaceId, next);
  const key = sessionKey(workspaceId, retellCallId);
  if (key) byCall.set(key, next);
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
  slots: DnrPabauSlot[];
}): void {
  writeSession(input.workspaceId, input.retellCallId, {
    service_name: input.service_name,
    slots: input.slots,
  });
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

  const slot = session.slots?.[0];
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

/** @internal test helper */
export function clearDnrPabauSessions(): void {
  byCall.clear();
  latestByWorkspace.clear();
}
