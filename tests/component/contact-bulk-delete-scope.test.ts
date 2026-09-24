/**
 * Which contacts a bulk delete actually removes.
 *
 * Two different deletes sit on this screen and they behave very differently: "Clear" removes every
 * contact in the workspace and ignores the filters entirely, while the filtered delete removes only
 * what is on screen. The server rules below are what stop the second one widening into the first.
 */
import { describe, expect, it } from "vitest";
import {
  contactDeleteRefusal,
  matchesContactDeleteFilter,
  type ContactDeleteCandidate,
} from "@/lib/whatsapp/contact-bulk-delete.shared";

const contact = (over: Partial<ContactDeleteCandidate> = {}): ContactDeleteCandidate =>
  ({
    phone: "971501234567",
    do_not_contact: false,
    import_meta: { upload_type: "Bliss 2" },
    ...over,
  }) as ContactDeleteCandidate;

const never = { messaged: false, replied: false };
const sent = { messaged: true, replied: false };
const answered = { messaged: true, replied: true };

describe("contactDeleteRefusal", () => {
  it("refuses a bare delete-everything", () => {
    expect(contactDeleteRefusal("all", null)).toMatch(/refusing to delete every contact/i);
    expect(contactDeleteRefusal("all", "   ")).toBeTruthy();
  });

  it("allows delete-all once it is pinned to one upload", () => {
    expect(contactDeleteRefusal("all", "Bliss 2")).toBeNull();
  });

  it("allows a named filter without an upload type", () => {
    expect(contactDeleteRefusal("not_messaged", null)).toBeNull();
  });
});

describe("matchesContactDeleteFilter", () => {
  it("keeps the delete inside the selected upload", () => {
    expect(matchesContactDeleteFilter(contact(), never, "all", "Bliss 2")).toBe(true);
    // Same person, different import — must survive.
    expect(
      matchesContactDeleteFilter(
        contact({ import_meta: { upload_type: "Arabian Ranches" } }),
        never,
        "all",
        "Bliss 2",
      ),
    ).toBe(false);
  });

  it("does not delete a contact with no upload type when one is selected", () => {
    expect(
      matchesContactDeleteFilter(contact({ import_meta: {} }), never, "all", "Bliss 2"),
    ).toBe(false);
  });

  it("not_messaged spares anyone already messaged or replied", () => {
    expect(matchesContactDeleteFilter(contact(), never, "not_messaged", null)).toBe(true);
    expect(matchesContactDeleteFilter(contact(), sent, "not_messaged", null)).toBe(false);
    expect(matchesContactDeleteFilter(contact(), answered, "not_messaged", null)).toBe(false);
  });

  it("combines the filter and the upload type, never widening to either alone", () => {
    const other = contact({ import_meta: { upload_type: "Arabian Ranches" } });
    // Never messaged, but the wrong upload.
    expect(matchesContactDeleteFilter(other, never, "not_messaged", "Bliss 2")).toBe(false);
    // Right upload, but already messaged.
    expect(matchesContactDeleteFilter(contact(), sent, "not_messaged", "Bliss 2")).toBe(false);
    // Both conditions hold.
    expect(matchesContactDeleteFilter(contact(), never, "not_messaged", "Bliss 2")).toBe(true);
  });

  it("dnc matches only flagged contacts", () => {
    expect(matchesContactDeleteFilter(contact({ do_not_contact: true }), never, "dnc", null)).toBe(true);
    expect(matchesContactDeleteFilter(contact(), never, "dnc", null)).toBe(false);
  });
});
