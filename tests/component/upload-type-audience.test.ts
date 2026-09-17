import { describe, expect, it } from "vitest";

/**
 * The in-memory scoping the campaign audience loader performs. Kept as a pure
 * test of the rule because the real query needs a live database, and the rule
 * is the part that decides whether "send to the JVC list" actually sends to
 * JVC only.
 */
type Contact = { phone: string; import_meta?: Record<string, unknown> | null };

function scopeToUpload(contacts: Contact[], uploadType: string): Contact[] {
  const want = uploadType.trim();
  if (!want) return contacts;
  return contacts.filter((c) => String(c.import_meta?.upload_type ?? "").trim() === want);
}

const CONTACTS: Contact[] = [
  { phone: "+971500000001", import_meta: { upload_type: "JVC" } },
  { phone: "+971500000002", import_meta: { upload_type: "JVC" } },
  { phone: "+971500000003", import_meta: { upload_type: "Arabian Ranches" } },
  { phone: "+971500000004", import_meta: {} },
  { phone: "+971500000005", import_meta: null },
];

describe("campaign audience scoped to one upload", () => {
  it("returns only the chosen batch", () => {
    expect(scopeToUpload(CONTACTS, "JVC").map((c) => c.phone)).toEqual([
      "+971500000001",
      "+971500000002",
    ]);
  });

  it("keeps batches separate", () => {
    expect(scopeToUpload(CONTACTS, "Arabian Ranches")).toHaveLength(1);
  });

  it("never leaks uncategorised contacts into a scoped send", () => {
    // The contacts with no upload_type are the dangerous ones — they would be
    // an unintended audience.
    const scoped = scopeToUpload(CONTACTS, "JVC");
    expect(scoped.every((c) => c.import_meta?.upload_type === "JVC")).toBe(true);
  });

  it("falls back to everyone when no upload is chosen", () => {
    expect(scopeToUpload(CONTACTS, "")).toHaveLength(CONTACTS.length);
    expect(scopeToUpload(CONTACTS, "   ")).toHaveLength(CONTACTS.length);
  });

  it("is exact, not fuzzy — a near-name selects nothing", () => {
    expect(scopeToUpload(CONTACTS, "jvc")).toHaveLength(0);
    expect(scopeToUpload(CONTACTS, "Arabian")).toHaveLength(0);
  });

  it("tolerates padding on the stored value", () => {
    const padded: Contact[] = [{ phone: "+9715", import_meta: { upload_type: "  JVC " } }];
    expect(scopeToUpload(padded, "JVC")).toHaveLength(1);
  });
});
