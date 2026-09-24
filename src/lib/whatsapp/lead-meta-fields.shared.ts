/**
 * Discovering the property/CSV columns a workspace's leads actually carry.
 *
 * The template field picker used to offer one hardcoded list of column spellings taken from a
 * different dataset. A workspace whose spreadsheet imported as "UNIT NUMBER" had no matching
 * option, so the nearest-looking one was chosen, silently resolved to nothing, and the send
 * substituted a generic sample — customers received "your villa at Customer".
 *
 * One workspace can legitimately hold several spellings of the same concept from different
 * imports (this one has both "UNIT NUMBER" and "UnitNumber"), so keys are reported exactly as
 * stored and ranked by how many leads actually have a value.
 */

/** Keys that are our own bookkeeping, not columns the customer imported. */
export const INTERNAL_LEAD_META_KEYS = new Set([
  "upload_type",
  "listing_stage",
  "listing_outcome",
  "import_batch",
  "import_source",
  "source_file",
  "row_index",
]);

export type LeadMetaFieldOption = {
  /** Mapping value the template picker stores, e.g. "meta.UNIT NUMBER". */
  value: string;
  /** The column name as imported. */
  label: string;
  /** Leads in the sample holding a non-empty value. */
  filled: number;
  /** filled as a percentage of the sample. */
  coverage: number;
  /** First non-empty value seen, so the column is recognisable. */
  sample: string;
};

export function discoverLeadMetaFields(
  leads: Array<{ meta?: Record<string, unknown> | null; extra?: Record<string, string> | null }>,
): LeadMetaFieldOption[] {
  const stats = new Map<string, { filled: number; sample: string }>();

  for (const lead of leads) {
    // `extra` carries columns an older import stashed in `notes`; the send path
    // reads those too, so they belong in the picker.
    const merged: Record<string, unknown> = { ...(lead.meta ?? {}) };
    for (const [k, v] of Object.entries(lead.extra ?? {})) {
      if (!(k in merged)) merged[k] = v;
    }

    for (const [key, value] of Object.entries(merged)) {
      if (INTERNAL_LEAD_META_KEYS.has(key)) continue;
      const text = value == null ? "" : String(value).trim();
      if (!text) continue;
      const cur = stats.get(key);
      if (cur) cur.filled += 1;
      else stats.set(key, { filled: 1, sample: text });
    }
  }

  return [...stats.entries()]
    .map(([key, v]) => ({
      value: `meta.${key}`,
      label: key,
      filled: v.filled,
      coverage: leads.length > 0 ? Math.round((v.filled / leads.length) * 100) : 0,
      sample: v.sample.slice(0, 60),
    }))
    .sort((a, b) => b.filled - a.filled || a.label.localeCompare(b.label));
}

/**
 * Coverage below which a column is treated as noise rather than a real option.
 *
 * An import leaves stray keys behind — Bliss 2 carries 25 distinct meta keys, but only three are
 * present on more than a couple of its 223 leads. Offering all 25 buries the three that matter.
 *
 * Set at one in ten deliberately: mapping a template variable to a column only 7% of the audience
 * has means 93% of recipients receive a generic sample instead of their own data, which is exactly
 * the failure that put "your villa at Customer" in front of customers. Anything below this is
 * still reachable behind "show more", just not offered by default.
 */
export const RELEVANT_FIELD_COVERAGE_PCT = 10;

export function isRelevantFieldOption(option: { coverage: number }): boolean {
  return option.coverage >= RELEVANT_FIELD_COVERAGE_PCT;
}

/** The standard lead columns a template can map to, in the order they are offered. */
export const LEAD_COLUMN_FIELDS: Array<{ value: string; label: string }> = [
  { value: "full_name", label: "Owner / Full Name" },
  { value: "phone", label: "Phone (primary)" },
  { value: "email", label: "Email" },
  { value: "company_name", label: "Company" },
  { value: "source", label: "Source" },
  { value: "call_summary", label: "Call Summary" },
  { value: "next_action", label: "Next Action" },
  { value: "notes", label: "Notes (all fields text)" },
];

/**
 * Lead columns that are our own bookkeeping rather than the customer's data.
 *
 * Coverage cannot filter these out, because the importer writes them on every lead of every
 * upload and they therefore sit at 100% forever. `source` is the literal constant "import" —
 * dropping it into a message sends the same word to every recipient. `notes` is the serialised
 * dump of all the context columns, so it renders the whole spreadsheet row into one variable.
 * `call_summary` and `next_action` are written by the dialler after the fact, not by the import.
 *
 * None of them are removed — they stay reachable behind "show more" for the rare template that
 * genuinely wants one. They are just never what the picker offers first.
 */
export const BOOKKEEPING_LEAD_COLUMNS = new Set([
  "source",
  "notes",
  "call_summary",
  "next_action",
]);

/**
 * Whether a field is worth offering for this audience.
 *
 * Two independent tests, because they catch different failures: coverage catches a column this
 * upload happens not to carry, and the bookkeeping list catches a column that is always populated
 * but never means anything to a recipient.
 */
export function isOfferableFieldOption(option: { value: string; coverage: number }): boolean {
  if (BOOKKEEPING_LEAD_COLUMNS.has(option.value)) return false;
  return isRelevantFieldOption(option);
}

/**
 * Coverage for the standard lead columns over the same sample as the meta columns, so the picker
 * can rank and hide them on the same "does this actually hold data" rule.
 */
export function discoverLeadColumnFields(
  leads: Array<Record<string, unknown>>,
): LeadMetaFieldOption[] {
  return LEAD_COLUMN_FIELDS.map(({ value, label }) => {
    let filled = 0;
    let sample = "";
    for (const lead of leads) {
      const text = lead[value] == null ? "" : String(lead[value]).trim();
      if (!text) continue;
      filled += 1;
      if (!sample) sample = text;
    }
    return {
      value,
      label,
      filled,
      coverage: leads.length > 0 ? Math.round((filled / leads.length) * 100) : 0,
      sample: sample.slice(0, 60),
    };
  });
}

/**
 * One list of fields to map a template variable to.
 *
 * The picker used to show "Columns in Bliss 2" and "Lead fields" as separate groups, which is an
 * implementation detail — one is the raw CSV column, the other the column it was imported into.
 * The reader only sees "Email 100%" twice and has no way to tell which to pick.
 *
 * Merged and de-duplicated by label. Where the same label exists in both, the better-covered one
 * wins; on a tie the lead column wins, because that is the normalised value the send path reads.
 */
export function mergeFieldOptions(
  leadColumns: LeadMetaFieldOption[],
  importedColumns: LeadMetaFieldOption[],
): LeadMetaFieldOption[] {
  const key = (label: string) => label.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const best = new Map<string, LeadMetaFieldOption>();

  for (const option of [...leadColumns, ...importedColumns]) {
    const k = key(option.label);
    const current = best.get(k);
    if (!current) {
      best.set(k, option);
      continue;
    }
    if (option.coverage > current.coverage) best.set(k, option);
    // Equal coverage: keep whichever is the lead column rather than the raw import.
    else if (option.coverage === current.coverage && !option.value.startsWith("meta.")) {
      best.set(k, option);
    }
  }

  return [...best.values()].sort(
    (a, b) => b.coverage - a.coverage || a.label.localeCompare(b.label),
  );
}
