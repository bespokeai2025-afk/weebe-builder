import { describe, expect, it } from "vitest";
import {
  isDnrNewClientInput,
  normalizeDateOfBirth,
  normalizeDnrFindOrCreateArgs,
  normalizeEmail,
  parseDnrFindOrCreateClient,
} from "@/lib/dnr/dnr-new-client-intake.shared";

describe("dnr-new-client-intake", () => {
  it("accepts existing client lookup with phone only", () => {
    const r = parseDnrFindOrCreateClient({
      first_name: "Jane",
      last_name: "Doe",
      phone: "+447700900123",
      is_new_client: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(isDnrNewClientInput(r.data)).toBe(false);
  });

  it("requires email gender dob for new clients", () => {
    const r = parseDnrFindOrCreateClient({
      first_name: "Jane",
      last_name: "Doe",
      phone: "+447700900123",
      is_new_client: true,
    });
    expect(r.ok).toBe(false);
  });

  it("accepts full new client payload", () => {
    const r = parseDnrFindOrCreateClient({
      first_name: "Jane",
      last_name: "Doe",
      phone: "+447700900123",
      email: "jane@example.com",
      gender: "Female",
      date_of_birth: "1990-05-15",
      is_new_client: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(isDnrNewClientInput(r.data)).toBe(true);
      expect(r.data.preferred_language).toBe("English");
    }
  });

  it("normalizes mobile alias and spoken email/dob", () => {
    const r = parseDnrFindOrCreateClient(
      normalizeDnrFindOrCreateArgs({
        first_name: "Test",
        last_name: "Example",
        mobile: "+447561005010",
        email: "test at example dot com",
        gender: "male",
        date_of_birth: "28/07/1999",
        is_new_client: "true",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && isDnrNewClientInput(r.data)) {
      expect(r.data.phone).toBe("+447561005010");
      expect(r.data.email).toBe("test@example.com");
      expect(r.data.gender).toBe("Male");
      expect(r.data.date_of_birth).toBe("1999-07-28");
    }
  });

  it("normalizes flexible date and email formats", () => {
    expect(normalizeDateOfBirth("28 july 1999")).toBe("1999-07-28");
    expect(normalizeDateOfBirth("28/12/2001")).toBe("2001-12-28");
    expect(normalizeEmail("test at gmail dot com")).toBe("test@gmail.com");
  });
});
