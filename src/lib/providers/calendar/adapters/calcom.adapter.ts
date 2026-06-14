import type { CalendarProvider, CalendarSlot, CalendarBooking, CalendarBookingResult } from "../interface";

const CALCOM_BASE = "https://api.cal.com/v1";

/**
 * Delegates directly to the Cal.com REST API v1.
 * Mirrors the same calls used in booking-tools.server.ts so the provider
 * framework can route calendar operations without duplicating auth middleware.
 */
export class CalComAdapter implements CalendarProvider {
  readonly name = "calcom";

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("Cal.com API key is required for CalComAdapter");
  }

  async getAvailability(
    eventTypeId: string | number,
    dateFrom: string,
    dateTo: string,
  ): Promise<CalendarSlot[]> {
    const params = new URLSearchParams({
      apiKey: this.apiKey,
      eventTypeId: String(eventTypeId),
      dateFrom,
      dateTo,
    });

    const resp = await fetch(`${CALCOM_BASE}/availability?${params.toString()}`);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Cal.com availability error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    const slots: CalendarSlot[] = [];

    if (data.slots) {
      for (const daySlots of Object.values(data.slots) as any[][]) {
        for (const s of daySlots) {
          slots.push({ start: s.time, end: s.time, available: true });
        }
      }
    }

    return slots;
  }

  async createBooking(booking: CalendarBooking): Promise<CalendarBookingResult> {
    const resp = await fetch(`${CALCOM_BASE}/bookings?apiKey=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventTypeId: booking.eventTypeId,
        start: booking.start,
        timeZone: booking.timezone ?? "UTC",
        responses: {
          name:  booking.name,
          email: booking.email,
          phone: booking.phone ?? "",
        },
        metadata: {},
        notes:  booking.notes,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Cal.com booking error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return {
      bookingId: data.id,
      uid:       data.uid,
      status:    data.status ?? "ACCEPTED",
      meetUrl:   data.videoCallData?.url,
    };
  }

  async cancelBooking(bookingId: string | number, reason?: string): Promise<void> {
    const resp = await fetch(
      `${CALCOM_BASE}/bookings/${bookingId}/cancel?apiKey=${this.apiKey}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: reason ? JSON.stringify({ reason }) : undefined,
      },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Cal.com cancellation error ${resp.status}: ${text}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${CALCOM_BASE}/event-types?apiKey=${this.apiKey}&take=1`);
      return resp.ok;
    } catch {
      return false;
    }
  }
}
