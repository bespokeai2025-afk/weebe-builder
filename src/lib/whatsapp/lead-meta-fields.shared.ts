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
