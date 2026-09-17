/**
 * Which contacts a bulk delete on the Contacts screen resolves to.
 *
 * Extracted from the server function so the rule can be tested directly: the operation is
 * irreversible, and "Not sent" has to mean exactly what the table's own "Not sent" chip means or
 * the confirmation dialog lies about what is about to go.
 *
 * `messaged` is derived from whatsapp_messages rather than stored on the contact row, so the
 * caller passes the resolved stats in.
 */

export type ContactDeleteFilter = "all" | "messaged" | "not_messaged" | "replied" | "dnc";

export type ContactDeleteCandidate = {
  do_not_contact?: boolean | null;
  import_meta?: Record<string, unknown> | null;
};

export type ContactDeleteStats = { messaged: boolean; inbound_count: number };

/** The upload batch a contact was imported in, or "" when it was never categorised. */
export function contactUploadType(contact: ContactDeleteCandidate): string {
  return String((contact.import_meta ?? {}).upload_type ?? "").trim();
}

export function matchesContactDeleteFilter(
  contact: ContactDeleteCandidate,
  stats: ContactDeleteStats,
  filter: ContactDeleteFilter,
  uploadType?: string | null,
): boolean {
  const wantUpload = (uploadType ?? "").trim();
  // An uncategorised contact must never fall into a scoped delete — it is not
  // part of the batch the user is looking at.
  if (wantUpload && contactUploadType(contact) !== wantUpload) return false;

  switch (filter) {
    case "all":
      return true;
    case "messaged":
      return stats.messaged;
    case "not_messaged":
      return !stats.messaged;
    case "replied":
      return stats.inbound_count > 0;
    case "dnc":
      return Boolean(contact.do_not_contact);
  }
}

/**
 * Why a bulk delete request must be refused, or null when it is safe to run.
 *
 * `all` with no upload type means "every contact in the workspace", which is what the separate
 * Clear all action is for — it must not be reachable by simply leaving a filter unset.
 */
export function contactDeleteRefusal(
  filter: ContactDeleteFilter,
  uploadType?: string | null,
): string | null {
  if (filter === "all" && !(uploadType ?? "").trim()) {
    return "Choose a filter or an upload type — refusing to delete every contact";
  }
  return null;
}
