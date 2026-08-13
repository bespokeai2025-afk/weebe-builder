import { describe, expect, it, beforeEach } from "vitest";
import {
  applyDnrBookSession,
  clearDnrPabauSessions,
  getDnrPabauCallSession,
  saveDnrAvailabilitySession,
  saveDnrClientSession,
} from "@/lib/dnr/dnr-pabau-call-session.server";
import { parseDnrBookAppointment } from "@/lib/dnr/dnr-book-appointment.shared";

describe("dnr-pabau-call-session", () => {
  beforeEach(() => clearDnrPabauSessions());

  it("fills book_appointment from prior tool session", () => {
    const ws = "workspace-1";
    saveDnrClientSession({ workspaceId: ws, contact_id: 4242, phone: "+447700900123" });
    saveDnrAvailabilitySession({
      workspaceId: ws,
      service_name: "Ultherapy - Lower Face",
      slots: [{ start_date: "2026-08-15", start_time: "10:30" }],
    });

    const session = getDnrPabauCallSession(ws);
    const merged = applyDnrBookSession({}, session);
    const parsed = parseDnrBookAppointment(merged.args);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.contact_id).toBe(4242);
      expect(parsed.data.service_name).toBe("Ultherapy - Lower Face");
      expect(parsed.data.start_date).toBe("2026-08-15");
      expect(parsed.data.start_time).toBe("10:30");
    }
    expect(merged.filled_from_session).toContain("contact_id");
  });

  it("matches slot by index and ISO start datetime", () => {
    const ws = "workspace-1";
    saveDnrAvailabilitySession({
      workspaceId: ws,
      service_name: "Ultherapy - Lower Face",
      slots: [
        { start_date: "2026-08-15", start_time: "10:00" },
        { start_date: "2026-08-15", start_time: "10:30" },
      ],
    });

    const session = getDnrPabauCallSession(ws)!;
    const byIndex = applyDnrBookSession({ contact_id: 1, slot_index: 1 }, session);
    expect(byIndex.args.start_time).toBe("10:30");

    const byIso = applyDnrBookSession(
      { contact_id: 1, service_name: "Ultherapy - Lower Face", start: "2026-08-15T10:00:00" },
      session,
    );
    expect(byIso.args.start_date).toBe("2026-08-15");
    expect(byIso.args.start_time).toBe("10:00");
  });
});
