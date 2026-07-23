/**
 * WATI / Meta WhatsApp template status helpers (sync + webhooks).
 * Template creation stays in WATI — Webee mirrors lifecycle only.
 */

import { watiTemplateComponentsPayload } from "@/lib/whatsapp/wati-template-params.shared";

export type WatiTemplateStatusKey =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "deleted"
  | "disabled"
  | "paused"
  | "unknown";

/** WATI templateReviewed webhook status codes. */
const STATUS_CODE_MAP: Record<number, WatiTemplateStatusKey> = {
  0: "draft",
  1: "pending",
  2: "approved",
  3: "rejected",
  4: "deleted",
  5: "pending",
  6: "disabled",
  7: "paused",
};

const STATUS_TEXT_MAP: Record<string, WatiTemplateStatusKey> = {
  draft: "draft",
  pending: "pending",
  submitted: "pending",
  in_review: "pending",
  approved: "approved",
  rejected: "rejected",
  deleted: "deleted",
  disabled: "disabled",
  paused: "paused",
};

export function normalizeWatiTemplateStatus(
  raw: unknown,
  statusCode?: number | null,
): WatiTemplateStatusKey {
  if (statusCode != null && STATUS_CODE_MAP[statusCode]) {
    return STATUS_CODE_MAP[statusCode];
  }
  const text = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (STATUS_TEXT_MAP[text]) return STATUS_TEXT_MAP[text];
  if (text.includes("approv")) return "approved";
  if (text.includes("reject")) return "rejected";
  if (text.includes("pend") || text.includes("review")) return "pending";
  if (text.includes("draft")) return "draft";
  if (text.includes("pause")) return "paused";
  if (text.includes("disable")) return "disabled";
  return "unknown";
}

export function watiTemplateStatusLabel(key: WatiTemplateStatusKey): string {
  const labels: Record<WatiTemplateStatusKey, string> = {
    draft: "Draft",
    pending: "Pending review",
    approved: "Approved",
    rejected: "Rejected",
    deleted: "Deleted",
    disabled: "Disabled",
    paused: "Paused",
    unknown: "Unknown",
  };
  return labels[key];
}

export function watiTemplateCanSend(key: WatiTemplateStatusKey): boolean {
  return key === "approved";
}

export function watiTemplateStatusBadgeClass(key: WatiTemplateStatusKey): string {
  switch (key) {
    case "approved":
      return "border-green-500/40 text-green-600 dark:text-green-400";
    case "pending":
      return "border-amber-500/40 text-amber-600 dark:text-amber-400";
    case "rejected":
      return "border-red-500/40 text-red-600 dark:text-red-400";
    case "paused":
    case "disabled":
      return "border-orange-500/40 text-orange-600 dark:text-orange-400";
    default:
      return "border-muted-foreground/30 text-muted-foreground";
  }
}

export function resolveWatiTemplateStatusKey(row: {
  status?: string | null;
  status_code?: number | null;
}): WatiTemplateStatusKey {
  return normalizeWatiTemplateStatus(row.status, row.status_code);
}

export function watiTemplateLanguage(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    return String(o.value ?? o.key ?? o.text ?? "").trim() || null;
  }
  return String(raw);
}

export function watiTemplateQualityLabel(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    if (raw >= 2) return "HIGH";
    if (raw === 1) return "MEDIUM";
    return "LOW";
  }
  const s = String(raw).trim().toUpperCase();
  if (s.includes("GREEN") || s === "HIGH") return "HIGH";
  if (s.includes("YELLOW") || s === "MEDIUM") return "MEDIUM";
  if (s.includes("RED") || s === "LOW") return "LOW";
  return s.slice(0, 20);
}

export function watiTemplateBodyPreview(t: Record<string, unknown>): string | null {
  const body = t.body ?? t.bodyOriginal;
  if (typeof body === "string" && body.trim()) return body.trim();
  const comps = t.components as Record<string, unknown> | null | undefined;
  const fromComps = comps?.body ?? comps?.bodyOriginal;
  if (typeof fromComps === "string" && fromComps.trim()) return fromComps.trim();
  return null;
}

export function watiTemplateRejectionReason(t: Record<string, unknown>): string | null {
  const reason =
    t.rejectedReason ??
    t.rejectionReason ??
    t.reason ??
    t.rejection_reason ??
    t.failedReason ??
    t.errorMessage;
  if (reason == null || reason === "") return null;
  return String(reason).trim().slice(0, 500);
}

/** Build DB upsert patch from a WATI getMessageTemplates row. */
export function watiTemplateRowFromApi(
  workspaceId: string,
  t: Record<string, unknown>,
): Record<string, unknown> {
  const statusRaw = t.status;
  const statusCode =
    typeof t.statusCode === "number"
      ? t.statusCode
      : typeof t.templateStatus === "number"
        ? t.templateStatus
        : null;
  const modifiedAt = t.lastModified ?? t.last_modified ?? t.updatedAt ?? null;
  const now = new Date().toISOString();

  return {
    workspace_id: workspaceId,
    wati_template_id: String(t.id ?? t.elementName ?? t.name),
    name: String(t.elementName ?? t.name ?? "Untitled"),
    status: statusRaw != null ? String(statusRaw) : null,
    status_code: statusCode,
    language: watiTemplateLanguage(t.language),
    category: t.category != null ? String(t.category) : null,
    components: watiTemplateComponentsPayload(t),
    body_preview: watiTemplateBodyPreview(t),
    rejection_reason: watiTemplateRejectionReason(t),
    quality: watiTemplateQualityLabel(t.quality ?? t.qualityScore),
    last_status_at: modifiedAt ? String(modifiedAt) : now,
    wati_modified_at: modifiedAt ? String(modifiedAt) : null,
    synced_at: now,
  };
}

export function isWatiTemplateLifecycleEvent(payload: Record<string, unknown>): boolean {
  const t = String(payload.eventType ?? payload.type ?? payload.event ?? "").toLowerCase();
  return t === "templatereviewed" || t === "templatequalityupdated";
}

/** Patch for wati_templates from templateReviewed / templateQualityUpdated webhook. */
export function watiTemplatePatchFromWebhook(
  payload: Record<string, unknown>,
): {
  templateName: string | null;
  watiTemplateId: string | null;
  patch: Record<string, unknown>;
} {
  const templateName = String(
    payload.templateName ?? payload.elementName ?? payload.name ?? "",
  ).trim();
  const watiTemplateId = String(
    payload.watiTemplateId ?? payload.templateId ?? payload.id ?? "",
  ).trim();

  const eventType = String(payload.eventType ?? payload.type ?? "").toLowerCase();
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { last_status_at: now, synced_at: now };

  if (eventType === "templatereviewed") {
    const newCode =
      typeof payload.newTemplateStatus === "number"
        ? payload.newTemplateStatus
        : typeof payload.templateStatus === "number"
          ? payload.templateStatus
          : null;
    const statusKey = normalizeWatiTemplateStatus(payload.newTemplateStatus ?? payload.status, newCode);
    patch.status_code = newCode;
    patch.status = statusKey === "unknown" ? payload.status ?? null : statusKey.toUpperCase();
    const reason = payload.rejectionReason ?? payload.rejectedReason ?? payload.reason;
    if (reason) patch.rejection_reason = String(reason).slice(0, 500);
    if (statusKey === "approved") patch.rejection_reason = null;
  }

  if (eventType === "templatequalityupdated") {
    patch.quality = watiTemplateQualityLabel(
      payload.quality ?? payload.newQuality ?? payload.qualityScore,
    );
  }

  return {
    templateName: templateName || null,
    watiTemplateId: watiTemplateId || null,
    patch,
  };
}
