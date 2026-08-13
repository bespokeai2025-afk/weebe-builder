import { describe, expect, it } from "vitest";
import {
  locationHoursForDate,
  parsePabauAppointment,
  serviceDisabledAtLocation,
  type PabauLocationRow,
} from "@/lib/pabau/pabau-location.shared";

const cheshireLocation: PabauLocationRow = {
  id: 3526,
  location_name: "Medispa Cheshire",
  working_hours: [
    { day_name: "Monday", opening_hours: "10:00", closing_hours: "20:00", closed: 0 },
    { day_name: "Saturday", opening_hours: "10:00", closing_hours: "19:00", closed: 0 },
    { day_name: "Sunday", opening_hours: "9:00", closing_hours: "17:00", closed: 1 },
  ],
};

describe("pabau-location", () => {
  it("parses appointment location and practitioner", () => {
    const parsed = parsePabauAppointment({
      details: {
        location: { id: 3526, name: "Medispa Cheshire" },
        practitioner: { practitioner_id: 151940, practitioner_name: "Therapist Kayleigh" },
      },
      dates: { start_date: "2026-08-15", start_time: "10:30:00" },
    });
    expect(parsed?.location_id).toBe(3526);
    expect(parsed?.practitioner_id).toBe(151940);
    expect(parsed?.slot_key).toBe("2026-08-15T10:30");
  });

  it("uses Pabau location working hours", () => {
    const mon = locationHoursForDate(cheshireLocation, "2026-08-17");
    expect(mon?.closed).toBe(false);
    expect(mon?.openMin).toBe(600);
    expect(mon?.closeMin).toBe(1200);

    const sun = locationHoursForDate(cheshireLocation, "2026-08-16");
    expect(sun?.closed).toBe(true);
  });

  it("detects disabled service at location", () => {
    expect(serviceDisabledAtLocation("3532,3535", 3526)).toBe(false);
    expect(serviceDisabledAtLocation("3526", 3526)).toBe(true);
  });
});
