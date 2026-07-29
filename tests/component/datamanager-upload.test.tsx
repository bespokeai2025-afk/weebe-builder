/**
 * Data Manager offline-conversion uploader — pure-logic contract tests.
 * Covers identifier normalisation + hashing and IngestEventsRequest payload
 * shape (no network, no DB writes).
 */
import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import {
  normalizeEmail,
  normalizePhoneE164,
  sha256Hex,
  buildHashedIdentifiers,
  buildIngestEventsBody,
} from "@/lib/tracking/datamanager-upload.server";

const hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
  });
  it("removes dots in gmail local part only", () => {
    expect(normalizeEmail("Jane.Doe@Gmail.com")).toBe("janedoe@gmail.com");
    expect(normalizeEmail("j.d@googlemail.com")).toBe("jd@googlemail.com");
    expect(normalizeEmail("jane.doe@company.com")).toBe("jane.doe@company.com");
  });
  it("rejects invalid emails", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });
});

describe("normalizePhoneE164", () => {
  it("keeps valid E.164 as-is (strips separators)", () => {
    expect(normalizePhoneE164("+44 7911 123456")).toBe("+447911123456");
    expect(normalizePhoneE164("(+1) 800-555-0200")).toBe("+18005550200");
  });
  it("converts 00-prefix international", () => {
    expect(normalizePhoneE164("0044 7911 123456")).toBe("+447911123456");
  });
  it("converts UK national 0-prefix to +44", () => {
    expect(normalizePhoneE164("07911 123456")).toBe("+447911123456");
    expect(normalizePhoneE164("020 7946 0000")).toBe("+442079460000");
  });
  it("returns null for ambiguous or invalid input (never guesses)", () => {
    expect(normalizePhoneE164("12345")).toBeNull();
    expect(normalizePhoneE164("")).toBeNull();
    expect(normalizePhoneE164("hello")).toBeNull();
  });
});

describe("hashing", () => {
  it("sha256Hex matches node crypto", () => {
    expect(sha256Hex("janedoe@gmail.com")).toBe(hex("janedoe@gmail.com"));
  });
  it("buildHashedIdentifiers normalises before hashing and nulls invalid", () => {
    const out = buildHashedIdentifiers(" Jane.Doe@GMAIL.com ", "07911123456");
    expect(out.hashedEmail).toBe(hex("janedoe@gmail.com"));
    expect(out.hashedPhone).toBe(hex("+447911123456"));
    const bad = buildHashedIdentifiers("nope", "123");
    expect(bad.hashedEmail).toBeNull();
    expect(bad.hashedPhone).toBeNull();
  });
});

describe("buildIngestEventsBody", () => {
  const target = {
    operatingAccountId: "3550820264",
    loginAccountId: null,
    productDestinationId: "7699121648",
  };

  it("builds a gclid event with consent, HEX encoding and transactionId", () => {
    const body = buildIngestEventsBody(target, {
      eventId: "evt-1",
      conversionName: "webee_qualified_lead",
      source: "webform",
      createdAt: "2026-07-27T10:00:00.000Z",
      gclid: "TEST_GCLID",
      gbraid: null,
      wbraid: null,
    }, false) as any;

    expect(body.encoding).toBe("HEX");
    expect(body.validateOnly).toBe(false);
    expect(body.destinations).toHaveLength(1);
    expect(body.destinations[0].operatingAccount).toEqual({ accountType: "GOOGLE_ADS", accountId: "3550820264" });
    expect(body.destinations[0].productDestinationId).toBe("7699121648");
    expect(body.destinations[0].loginAccount).toBeUndefined();
    const ev = body.events[0];
    expect(ev.transactionId).toBe("evt-1");
    expect(ev.eventTimestamp).toBe("2026-07-27T10:00:00Z");
    expect(ev.eventSource).toBe("WEB");
    expect(ev.adIdentifiers).toEqual({ gclid: "TEST_GCLID" });
    expect(ev.consent).toEqual({ adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" });
    expect(ev.userData).toBeUndefined();
  });

  it("uses only one click id (gclid > gbraid > wbraid) and hashed identifiers", () => {
    const body = buildIngestEventsBody(target, {
      eventId: "evt-2",
      conversionName: "webee_qualified_lead",
      source: "call",
      createdAt: "2026-07-27T10:00:00Z",
      gclid: null,
      gbraid: "GB",
      wbraid: "WB",
      hashedEmail: hex("janedoe@gmail.com"),
      hashedPhone: hex("+447911123456"),
    }, true) as any;

    expect(body.validateOnly).toBe(true);
    const ev = body.events[0];
    expect(ev.adIdentifiers).toEqual({ gbraid: "GB" });
    expect(ev.userData.userIdentifiers).toEqual([
      { emailAddress: hex("janedoe@gmail.com") },
      { phoneNumber: hex("+447911123456") },
    ]);
  });

  it("includes loginAccount only when it differs from the operating account", () => {
    const withLogin = buildIngestEventsBody(
      { ...target, loginAccountId: "1112223334" },
      { eventId: "e", conversionName: "c", source: "s", createdAt: "2026-07-27T10:00:00Z", gclid: "g", gbraid: null, wbraid: null },
      false,
    ) as any;
    expect(withLogin.destinations[0].loginAccount).toEqual({ accountType: "GOOGLE_ADS", accountId: "1112223334" });

    const sameLogin = buildIngestEventsBody(
      { ...target, loginAccountId: "3550820264" },
      { eventId: "e", conversionName: "c", source: "s", createdAt: "2026-07-27T10:00:00Z", gclid: "g", gbraid: null, wbraid: null },
      false,
    ) as any;
    expect(sameLogin.destinations[0].loginAccount).toBeUndefined();
  });

  it("omits adIdentifiers entirely when no click id (identifier-only upload)", () => {
    const body = buildIngestEventsBody(target, {
      eventId: "e3", conversionName: "c", source: "s", createdAt: "2026-07-27T10:00:00Z",
      gclid: null, gbraid: null, wbraid: null, hashedEmail: hex("a@b.co"),
    }, false) as any;
    expect(body.events[0].adIdentifiers).toBeUndefined();
    expect(body.events[0].userData.userIdentifiers).toHaveLength(1);
  });
});

describe("tenant isolation contract (source enforcement)", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../src/lib/tracking/datamanager-upload.server.ts"),
    "utf8",
  );

  it("lead identifier lookup is scoped to the event's workspace", () => {
    // The PII source query must carry BOTH the lead id and the workspace
    // predicate — a lead from another workspace must yield no identifiers.
    const leadLookup = src.match(/from\("leads"\)[\s\S]{0,300}?maybeSingle\(\)/);
    expect(leadLookup, "leads lookup present").toBeTruthy();
    expect(leadLookup![0]).toContain('.eq("id", ev.lead_id)');
    expect(leadLookup![0]).toContain('.eq("workspace_id", ev.workspace_id)');
  });

  it("upload claim is CAS-guarded on delivery_status", () => {
    expect(src).toContain('"upload_attempted"');
    expect(src).toMatch(/\.in\("delivery_status", UPLOADABLE_STATUSES/);
  });
});
