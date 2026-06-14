import type { CalendarProvider, CalendarSlot, CalendarBooking, CalendarBookingResult } from "./interface";
import { CalComAdapter } from "./adapters/calcom.adapter";
import { GoogleCalendarAdapter } from "./adapters/google.adapter";
import { withProviderTracking } from "@/lib/providers/instrumentation";

export type CalendarProviderName = "calcom" | "google" | "outlook";

export type CalendarConfig =
  | { provider: "calcom"; apiKey: string }
  | { provider: "google"; accessToken: string }
  | { provider: "outlook"; accessToken: string };

/**
 * Create a CalendarProvider. When `workspaceId` is included in `config`,
 * every method call is automatically tracked in provider_usage.
 */
export function createCalendarProvider(
  config: CalendarConfig & { workspaceId?: string },
): CalendarProvider {
  let inner: CalendarProvider;
  switch (config.provider) {
    case "calcom":
      inner = new CalComAdapter(config.apiKey);
      break;
    case "google":
      inner = new GoogleCalendarAdapter({ accessToken: config.accessToken });
      break;
    case "outlook":
      throw new Error("Outlook Calendar provider not yet implemented.");
    default:
      throw new Error(`Unknown calendar provider: ${String((config as any).provider)}`);
  }

  if (!config.workspaceId) return inner;

  const { workspaceId, provider: providerName } = config;
  const track = <T>(fn: () => Promise<T>) =>
    withProviderTracking({ workspaceId, category: "calendar", providerName }, fn);

  return {
    name: inner.name,
    getAvailability: (eventTypeId: string | number, dateFrom: string, dateTo: string): Promise<CalendarSlot[]> =>
      track(() => inner.getAvailability(eventTypeId, dateFrom, dateTo)),
    createBooking: (booking: CalendarBooking): Promise<CalendarBookingResult> =>
      track(() => inner.createBooking(booking)),
    cancelBooking: (bookingId: string | number, reason?: string): Promise<void> =>
      track(() => inner.cancelBooking(bookingId, reason)),
  };
}

/** @deprecated Use createCalendarProvider({ ..., workspaceId }) instead. */
export const createInstrumentedCalendarProvider = (
  config: CalendarConfig & { workspaceId: string },
): CalendarProvider => createCalendarProvider(config);
