import type { CalendarProvider, CalendarSlot, CalendarBooking, CalendarBookingResult } from "../interface";

// TODO: implement — connect to Google Calendar API
// Docs: https://developers.google.com/calendar/api
export class GoogleCalendarAdapter implements CalendarProvider {
  readonly name = "google";

  constructor(private readonly _accessToken: string) {}

  async getAvailability(_eventTypeId: string | number, _dateFrom: string, _dateTo: string): Promise<CalendarSlot[]> {
    throw new Error("Google Calendar provider not yet implemented.");
  }

  async createBooking(_booking: CalendarBooking): Promise<CalendarBookingResult> {
    throw new Error("Google Calendar provider not yet implemented.");
  }

  async cancelBooking(_bookingId: string | number): Promise<void> {
    throw new Error("Google Calendar provider not yet implemented.");
  }
}
