export interface CalendarSlot {
  start: string;
  end: string;
  available: boolean;
}

export interface CalendarBooking {
  eventTypeId?: string | number;
  name: string;
  email: string;
  phone?: string;
  start: string;
  timezone?: string;
  notes?: string;
}

export interface CalendarBookingResult {
  bookingId: string | number;
  uid?: string;
  status: string;
  meetUrl?: string;
}

export interface CalendarProvider {
  readonly name: string;
  getAvailability(eventTypeId: string | number, dateFrom: string, dateTo: string): Promise<CalendarSlot[]>;
  createBooking(booking: CalendarBooking): Promise<CalendarBookingResult>;
  cancelBooking(bookingId: string | number, reason?: string): Promise<void>;
}
