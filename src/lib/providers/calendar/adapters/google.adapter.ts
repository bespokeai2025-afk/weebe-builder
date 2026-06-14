import type { CalendarProvider, CalendarSlot, CalendarBooking, CalendarBookingResult } from "../interface";

const GCAL_BASE = "https://www.googleapis.com/calendar/v3";

/**
 * Google Calendar REST API adapter.
 * Requires an OAuth access token stored in provider credentials.
 * Full OAuth flow is handled separately via the integrations OAuth task.
 * Docs: https://developers.google.com/calendar/api
 */
export class GoogleCalendarAdapter implements CalendarProvider {
  readonly name = "google";

  constructor(private readonly config: { accessToken?: string; calendarId?: string }) {}

  private get calId(): string {
    return this.config.calendarId ?? "primary";
  }

  async getAvailability(_eventTypeId: string | number, dateFrom: string, dateTo: string): Promise<CalendarSlot[]> {
    const { accessToken } = this.config;
    if (!accessToken) throw new Error("Google Calendar requires an OAuth access token");

    const resp = await fetch(`${GCAL_BASE}/freeBusy`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: new Date(dateFrom).toISOString(),
        timeMax: new Date(dateTo).toISOString(),
        items: [{ id: this.calId }],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Google Calendar freeBusy error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    const busy: Array<{ start: string; end: string }> = data.calendars?.[this.calId]?.busy ?? [];

    const result: CalendarSlot[] = [];
    const from = new Date(dateFrom);
    const to   = new Date(dateTo);
    const cursor = new Date(from);

    while (cursor < to) {
      const slotStart = new Date(cursor);
      const slotEnd   = new Date(cursor.getTime() + 30 * 60 * 1000);
      const isBusy = busy.some(b =>
        new Date(b.start) < slotEnd && new Date(b.end) > slotStart,
      );
      if (!isBusy) {
        result.push({ start: slotStart.toISOString(), end: slotEnd.toISOString(), available: true });
      }
      cursor.setMinutes(cursor.getMinutes() + 30);
    }

    return result;
  }

  async createBooking(booking: CalendarBooking): Promise<CalendarBookingResult> {
    const { accessToken } = this.config;
    if (!accessToken) throw new Error("Google Calendar requires an OAuth access token");

    const end = new Date(new Date(booking.start).getTime() + 30 * 60 * 1000).toISOString();

    const resp = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(this.calId)}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: booking.notes ?? `Meeting with ${booking.name}`,
        start:   { dateTime: booking.start, timeZone: booking.timezone ?? "UTC" },
        end:     { dateTime: end,           timeZone: booking.timezone ?? "UTC" },
        attendees: [{ email: booking.email, displayName: booking.name }],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Google Calendar createEvent error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return {
      bookingId: data.id,
      uid:       data.id,
      status:    "ACCEPTED",
      meetUrl:   data.hangoutLink,
    };
  }

  async cancelBooking(bookingId: string | number): Promise<void> {
    const { accessToken } = this.config;
    if (!accessToken) throw new Error("Google Calendar requires an OAuth access token");

    const resp = await fetch(
      `${GCAL_BASE}/calendars/${encodeURIComponent(this.calId)}/events/${bookingId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!resp.ok && resp.status !== 410) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Google Calendar deleteEvent error ${resp.status}: ${text}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    const { accessToken } = this.config;
    if (!accessToken) return false;
    try {
      const resp = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(this.calId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
