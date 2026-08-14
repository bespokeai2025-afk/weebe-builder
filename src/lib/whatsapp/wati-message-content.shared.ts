/**
 * Human-readable text for WATI messages that carry no `text` field.
 *
 * A shared contact card, a location or a document has real content that WATI's own inbox renders —
 * a shared contact shows as its name and number. Falling back to a bare `[contacts]` throws that
 * content away, so the reader cannot tell who was shared without opening WATI.
 *
 * WATI exposes contact cards in WhatsApp's own snake_case shape on `contacts`:
 *   [{ name: { formatted_name, first_name, last_name }, phones: [{ phone, wa_id }] }]
 * The webhook documents a `messageContact` field instead, and other WhatsApp providers send a
 * vCard string, so all of those are accepted.
 */

const NON_TEXT_FALLBACK_BODY = "[Non-text message]";

const NON_TEXT_TYPES = [
  "image",
  "video",
  "audio",
  "voice",
  "document",
  "sticker",
  "location",
  "contacts",
  "reaction",
  "order",
  "catalog",
];

function str(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Contact cards arrive as a bare object, a list, or a `{ contacts: [...] }` wrapper. */
function collectContactEntries(payload: Record<string, unknown>): Record<string, unknown>[] {
  const sources = [
    payload.contacts,
    payload.messageContact,
    payload.message_contact,
    payload.contacts_array,
    payload.contact,
    asRecord(payload.data)?.contacts,
    asRecord(payload.data)?.messageContact,
  ];

  const entries: Record<string, unknown>[] = [];
  for (const source of sources) {
    if (Array.isArray(source)) {
      for (const item of source) {
        const record = asRecord(item);
        if (record) entries.push(record);
      }
      continue;
    }
    const record = asRecord(source);
    if (!record) continue;
    // A `{ contacts: [...] }` wrapper rather than the card itself.
    if (Array.isArray(record.contacts)) {
      for (const item of record.contacts) {
        const nested = asRecord(item);
        if (nested) entries.push(nested);
      }
      continue;
    }
    entries.push(record);
  }

  return entries;
}

/** `FN:` and the first `TEL` line of a vCard, which some providers send instead of fields. */
function parseVcard(vcard: string): { name: string | null; phone: string | null } {
  let name: string | null = null;
  let phone: string | null = null;

  for (const rawLine of vcard.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!name && /^FN[;:]/i.test(line)) {
      name = str(line.slice(line.indexOf(":") + 1));
    }
    if (!phone && /^(item\d+\.)?TEL[;:]/i.test(line)) {
      phone = str(line.slice(line.indexOf(":") + 1));
    }
  }

  return { name, phone };
}

function contactName(entry: Record<string, unknown>): string | null {
  const name = asRecord(entry.name);
  const first = str(name?.first_name ?? name?.firstName);
  const last = str(name?.last_name ?? name?.lastName);

  return (
    str(name?.formatted_name ?? name?.formattedName) ??
    str(entry.formatted_name ?? entry.formattedName) ??
    str(entry.displayName ?? entry.display_name) ??
    // WhatsApp repeats the full name in `last_name` when no separate surname was set.
    (first && last && last !== first ? `${first} ${last}` : (first ?? last)) ??
    str(asRecord(entry.org)?.company)
  );
}

function contactPhones(entry: Record<string, unknown>): string[] {
  const raw = Array.isArray(entry.phones) ? entry.phones : [];
  const phones: string[] = [];

  for (const item of raw) {
    const record = asRecord(item);
    const phone = record
      ? str(record.phone ?? record.number ?? record.wa_id ?? record.waId)
      : str(item);
    if (phone && !phones.includes(phone)) phones.push(phone);
  }

  const single = str(entry.phone ?? entry.wa_id ?? entry.waId);
  if (single && !phones.includes(single)) phones.push(single);

  return phones;
}

/** One shared contact rendered as `Name · +phone`, matching what WATI's inbox shows. */
function describeContactEntry(entry: Record<string, unknown>): string | null {
  const vcardText = str(entry.vcard ?? entry.vCard ?? entry.v_card);
  const vcard = vcardText ? parseVcard(vcardText) : { name: null, phone: null };

  const name = contactName(entry) ?? vcard.name;
  const phones = contactPhones(entry);
  if (phones.length === 0 && vcard.phone) phones.push(vcard.phone);

  if (name && phones.length > 0) return `${name} · ${phones.join(", ")}`;
  return name ?? phones[0] ?? null;
}

/**
 * Shared contact cards as readable text, or null when the payload carries none.
 *
 * Exported separately so the message parsers can treat a contact card as real content rather than
 * an unreadable attachment.
 */
export function extractWatiContactCardText(payload: Record<string, unknown>): string | null {
  const described = collectContactEntries(payload)
    .map(describeContactEntry)
    .filter((line): line is string => Boolean(line));

  if (described.length === 0) return null;
  if (described.length === 1) return `Contact: ${described[0]}`;
  return `Contacts (${described.length}):\n${described.join("\n")}`;
}

function attachmentFilename(payload: Record<string, unknown>): string | null {
  const data = asRecord(payload.data);
  return (
    str(data?.fileName ?? data?.file_name ?? data?.filename) ??
    str(payload.fileName ?? payload.file_name ?? payload.filename) ??
    str(data?.caption)
  );
}

function describeLocation(payload: Record<string, unknown>): string | null {
  const source = asRecord(payload.location) ?? asRecord(payload.data) ?? payload;
  const name = str(source.name);
  const address = str(source.address);
  const latitude = str(source.latitude ?? source.lat);
  const longitude = str(source.longitude ?? source.lng ?? source.long);

  const label = [name, address].filter(Boolean).join(", ");
  if (label) return `Location: ${label}`;
  if (latitude && longitude) return `Location: ${latitude}, ${longitude}`;
  return null;
}

/**
 * Best available description of a message with no text body.
 *
 * Prefers real content (a contact card, a location, a document's filename) and only falls back to
 * a bracketed type when the payload genuinely carries nothing readable.
 */
export function describeWatiNonTextBody(payload: Record<string, unknown>): string {
  const type = String(payload.type ?? "")
    .trim()
    .toLowerCase();

  const contacts = extractWatiContactCardText(payload);
  if (contacts) return contacts;

  if (type === "location") {
    const location = describeLocation(payload);
    if (location) return location;
  }

  if (type === "document") {
    const filename = attachmentFilename(payload);
    if (filename) return filename;
  }

  if (NON_TEXT_TYPES.includes(type)) return `[${type}]`;
  return NON_TEXT_FALLBACK_BODY;
}

/**
 * Whether a stored body is one of the placeholders above.
 *
 * A placeholder means an earlier parse could not read the message's content, so the same message
 * re-read from WATI will not compare equal by body. Duplicate detection needs to know that in order
 * to upgrade the row in place rather than storing the message twice.
 *
 * Deliberately excludes `[Template: …]` shorthand, which is resolved by its own enrichment pass.
 */
export function isWatiNonTextPlaceholderBody(body: unknown): boolean {
  const text = str(body);
  if (!text) return false;
  if (text === NON_TEXT_FALLBACK_BODY) return true;
  const match = /^\[([a-z_]+)\]$/.exec(text);
  return match ? NON_TEXT_TYPES.includes(match[1]!) : false;
}
