/**
 * Rota parsing and slot assignment.
 *
 * Availability was generated from the clinic's opening hours while Pabau validates a booking
 * against the assigned employee's shift, so the agent offered times nobody was working and the
 * caller only found out after choosing one ("There is no shift for this timeslot"). These cover
 * the two details that make the rota usable: Pabau returns DD/MM/YYYY here and nowhere else, and
 * a shift carries two different id fields of which only `user_id` is a /users.id.
 */
import { describe, expect, it } from "vitest";
import {
  pabauShiftDateToYmd,
  parsePabauShift,
  pickShiftForSlot,
  shiftsForDateAtLocation,
  type PabauShift,
} from "@/lib/dnr/dnr-pabau-rota.server";

/** Verbatim shape from Pabau /schedules. */
const raw = {
  id: "4449640",
  employee_id: "48469",
  user_id: "53128",
  user_name: "Nurse Julie",
  shift_date: "24/09/2026",
  start_time: "10:00",
  end_time: "20:00",
  location: "3526",
  is_holiday: 0,
  all_services: 1,
  service_ids: [],
};

const shift = (over: Partial<PabauShift>): PabauShift => ({
  userId: 1,
  userName: "Someone",
  date: "2026-09-24",
  startMin: 600,
  endMin: 1200,
  locationId: 3526,
  serviceIds: [],
  allServices: true,
  ...over,
});

describe("pabauShiftDateToYmd", () => {
  it("reads Pabau's DD/MM/YYYY", () => {
    expect(pabauShiftDateToYmd("24/09/2026")).toBe("2026-09-24");
  });
  it("accepts an ISO date too", () => {
    expect(pabauShiftDateToYmd("2026-09-24")).toBe("2026-09-24");
  });
  it("rejects nonsense", () => {
    expect(pabauShiftDateToYmd("next tuesday")).toBeNull();
  });
});

describe("parsePabauShift", () => {
  it("uses user_id, not employee_id — only user_id is a /users.id", () => {
    const s = parsePabauShift(raw)!;
    expect(s.userId).toBe(53128);
    expect(s.userName).toBe("Nurse Julie");
    expect(s.date).toBe("2026-09-24");
    expect(s.startMin).toBe(600);
    expect(s.endMin).toBe(1200);
    expect(s.locationId).toBe(3526);
  });

  it("treats location 0 as unpinned rather than location zero", () => {
    expect(parsePabauShift({ ...raw, location: "0" })!.locationId).toBeNull();
  });

  it("drops a holiday — an absence is not a shift", () => {
    expect(parsePabauShift({ ...raw, is_holiday: 1 })).toBeNull();
  });

  it("drops a row with no usable times", () => {
    expect(parsePabauShift({ ...raw, start_time: "", end_time: "" })).toBeNull();
    expect(parsePabauShift({ ...raw, start_time: "18:00", end_time: "10:00" })).toBeNull();
  });
});

describe("shiftsForDateAtLocation", () => {
  const all = [
    shift({ userId: 1, date: "2026-09-24", locationId: 3526 }),
    shift({ userId: 2, date: "2026-09-24", locationId: 3532 }),
    shift({ userId: 3, date: "2026-09-24", locationId: null }),
    shift({ userId: 4, date: "2026-09-25", locationId: 3526 }),
  ];

  it("keeps this location and unpinned shifts, drops other clinics and other days", () => {
    expect(shiftsForDateAtLocation(all, "2026-09-24", 3526).map((s) => s.userId)).toEqual([1, 3]);
  });

  it("filters by service when the shift is limited to specific ones", () => {
    const limited = [
      shift({ userId: 5, serviceIds: [999], allServices: false }),
      shift({ userId: 6, serviceIds: [111], allServices: false }),
    ];
    expect(shiftsForDateAtLocation(limited, "2026-09-24", 3526, 111).map((s) => s.userId)).toEqual([6]);
  });
});

describe("pickShiftForSlot", () => {
  it("only picks someone whose shift covers the whole appointment", () => {
    const candidates = [shift({ userId: 7, startMin: 600, endMin: 660 })];
    expect(pickShiftForSlot(candidates, 600, 30, undefined)?.userId).toBe(7);
    // 10:45 + 30min runs past an 11:00 finish.
    expect(pickShiftForSlot(candidates, 645, 30, undefined)).toBeNull();
  });

  it("prefers the generic column over a named clinician", () => {
    const candidates = [
      shift({ userId: 8, userName: "Therapist Ellie" }),
      shift({ userId: 9, userName: "X Column Cheshire" }),
    ];
    expect(pickShiftForSlot(candidates, 600, 30, undefined)?.userId).toBe(9);
  });

  it("honours a requested practitioner above the generic column", () => {
    const candidates = [
      shift({ userId: 8, userName: "Therapist Ellie" }),
      shift({ userId: 9, userName: "X Column Cheshire" }),
    ];
    expect(pickShiftForSlot(candidates, 600, 30, 8)?.userId).toBe(8);
  });

  it("returns null when nobody is rostered", () => {
    expect(pickShiftForSlot([], 600, 30, undefined)).toBeNull();
  });
});

describe("pabauListShifts", () => {
  /**
   * `/schedules?date=` is a single-day filter — `page`/`per_page` only paginate through more
   * staff rostered on *that same day*. Treating it as an open-ended range meant every page of a
   * multi-day search still queried `fromDate`, so a caller asking for "next week" only ever saw
   * today's rota, and every later day looked entirely unstaffed and was skipped. Fixed by
   * querying every day in the range individually.
   */
  const dayOf = (url: string) => new URL(url).searchParams.get("date");

  function mockFetchOneShiftPerDay() {
    const requestedDates: string[] = [];
    global.fetch = (async (url: string) => {
      const date = dayOf(url)!;
      requestedDates.push(date);
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            schedules: [
              {
                id: "1",
                employee_id: "1",
                user_id: "53128",
                user_name: "Nurse Julie",
                shift_date: date.split("-").reverse().join("/"), // Pabau's DD/MM/YYYY
                start_time: "10:00",
                end_time: "20:00",
                location: "3526",
                is_holiday: 0,
                all_services: 1,
                service_ids: [],
              },
            ],
          }),
      } as Response;
    }) as typeof fetch;
    return requestedDates;
  }

  it("queries every day in the range, not just the first", async () => {
    const { pabauListShifts } = await import("@/lib/dnr/dnr-pabau-rota.server");
    const requestedDates = mockFetchOneShiftPerDay();

    const shifts = await pabauListShifts(
      { apiKey: "test-key" },
      { fromDate: "2026-09-24", toDate: "2026-09-27" },
    );

    expect(requestedDates.sort()).toEqual(["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
    expect(shifts.map((s) => s.date).sort()).toEqual([
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
    ]);
  });

  it("makes one request for a single-day lookup, same as before", async () => {
    const { pabauListShifts } = await import("@/lib/dnr/dnr-pabau-rota.server");
    const requestedDates = mockFetchOneShiftPerDay();

    await pabauListShifts({ apiKey: "test-key" }, { fromDate: "2026-09-24" });

    expect(requestedDates).toEqual(["2026-09-24"]);
  });

  it("still returns whatever it found before a day's request fails, rather than throwing", async () => {
    global.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const { pabauListShifts } = await import("@/lib/dnr/dnr-pabau-rota.server");

    const shifts = await pabauListShifts(
      { apiKey: "test-key" },
      { fromDate: "2026-09-24", toDate: "2026-09-25" },
    );
    expect(shifts).toEqual([]);
  });
});
