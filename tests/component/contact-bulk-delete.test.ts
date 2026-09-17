/**
 * The set a bulk delete on the BuzzChat Contacts screen resolves to.
 *
 * Irreversible, so the rule is tested directly rather than through the UI: "Not sent" has to mean
 * exactly what the table's own "Not sent" chip means, and a scoped delete must never reach a
 * contact outside the batch on screen.
 */
import { describe, expect, it } from "vitest";
import {
  contactDeleteRefusal,
  contactUploadType,
  matchesContactDeleteFilter,
  type ContactDeleteFilter,
} from "@/lib/whatsapp/contact-bulk-delete.shared";

type Row = {
  phone: string;
  do_not_contact?: boolean | null;
  import_meta?: Record<string, unknown> | null;
  stats: { messaged: boolean; inbound_count: number };
};

const ROWS: Row[] = [
  // Imported as JVC, never messaged — the set the user wants gone.
  { phone: "1", import_meta: { upload_type: "JVC" }, stats: { messaged: false, inbound_count: 0 } },
  { phone: "2", import_meta: { upload_type: "JVC" }, stats: { messaged: false, inbound_count: 0 } },
  // Imported as JVC and already messaged.
  { phone: "3", import_meta: { upload_type: "JVC" }, stats: { messaged: true, inbound_count: 0 } },
  // Imported as JVC, messaged, and replied.
  { phone: "4", import_meta: { upload_type: "JVC" }, stats: { messaged: true, inbound_count: 2 } },
  // A different batch, never messaged.
  {
    phone: "5",
    import_meta: { upload_type: "Arabian Ranches" },
    stats: { messaged: false, inbound_count: 0 },
  },
  // Uncategorised, never messaged.
  { phone: "6", import_meta: null, stats: { messaged: false, inbound_count: 0 } },
  // On the do-not-contact list.
  {
    phone: "7",
    do_not_contact: true,
    import_meta: { upload_type: "JVC" },
    stats: { messaged: false, inbound_count: 0 },
  },
];

function select(filter: ContactDeleteFilter, uploadType?: string | null): string[] {
  return ROWS.filter((r) => matchesContactDeleteFilter(r, r.stats, filter, uploadType)).map(
    (r) => r.phone,
  );
}

describe("matchesContactDeleteFilter", () => {
  it("selects every contact that has not been messaged", () => {
    expect(select("not_messaged")).toEqual(["1", "2", "5", "6", "7"]);
  });

  it("never selects a contact that has been messaged or has replied", () => {
    const picked = select("not_messaged");
    expect(picked).not.toContain("3");
    expect(picked).not.toContain("4");
  });

  it("scopes 'not sent' to one upload without touching other batches", () => {
    expect(select("not_messaged", "JVC")).toEqual(["1", "2", "7"]);
  });

  it("leaves uncategorised contacts out of a scoped delete", () => {
    // The dangerous case: a contact with no upload_type is not part of the
    // batch on screen, so it must not be swept up with it.
    expect(select("not_messaged", "JVC")).not.toContain("6");
    expect(select("all", "Arabian Ranches")).toEqual(["5"]);
  });

  it("treats a blank upload type as no scoping at all", () => {
    expect(select("not_messaged", "   ")).toEqual(select("not_messaged"));
    expect(select("not_messaged", null)).toEqual(select("not_messaged"));
  });

  it("resolves the other chips the same way the table does", () => {
    expect(select("messaged")).toEqual(["3", "4"]);
    expect(select("replied")).toEqual(["4"]);
    expect(select("dnc")).toEqual(["7"]);
  });
});

describe("contactDeleteRefusal", () => {
  it("refuses an unscoped 'all', which would wipe the workspace", () => {
    expect(contactDeleteRefusal("all", null)).toMatch(/refusing/i);
    expect(contactDeleteRefusal("all", "  ")).toMatch(/refusing/i);
  });

  it("allows 'all' once it is scoped to one upload", () => {
    expect(contactDeleteRefusal("all", "JVC")).toBeNull();
  });

  it("allows every explicit filter", () => {
    for (const filter of ["messaged", "not_messaged", "replied", "dnc"] as const) {
      expect(contactDeleteRefusal(filter, null)).toBeNull();
    }
  });
});

describe("contactUploadType", () => {
  it("reads and trims the batch label, defaulting to empty", () => {
    expect(contactUploadType({ import_meta: { upload_type: "  JVC " } })).toBe("JVC");
    expect(contactUploadType({ import_meta: {} })).toBe("");
    expect(contactUploadType({ import_meta: null })).toBe("");
    expect(contactUploadType({})).toBe("");
  });
});
