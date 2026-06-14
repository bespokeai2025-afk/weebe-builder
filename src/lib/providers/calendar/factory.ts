import type { CalendarProvider, CalendarSlot, CalendarBooking, CalendarBookingResult } from "./interface";
import { CalComAdapter } from "./adapters/calcom.adapter";
import { GoogleCalendarAdapter } from "./adapters/google.adapter";
import { withProviderTracking, withProviderFallback } from "@/lib/providers/instrumentation";

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
    withProviderTracking({ workspaceId, category: "calendar", providerName, unitsConsumed: 1, unitType: "api_call" }, fn);

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

/**
 * Creates a CalendarProvider that automatically falls back to `fallbackConfig`
 * if any primary operation throws. Both are independently tracked.
 */
export function createCalendarProviderWithFallback(
  primaryConfig: CalendarConfig & { workspaceId: string },
  fallbackConfig: CalendarConfig | null,
): CalendarProvider {
  const primary  = createCalendarProvider(primaryConfig);
  const fallback = fallbackConfig
    ? createCalendarProvider({ ...fallbackConfig, workspaceId: primaryConfig.workspaceId })
    : null;
  const ctx = { category: "calendar", primaryName: primaryConfig.provider, fallbackName: fallbackConfig?.provider };

  return {
    name: primary.name,
    getAvailability: (eventTypeId, dateFrom, dateTo) =>
      withProviderFallback(
        () => primary.getAvailability(eventTypeId, dateFrom, dateTo),
        fallback ? () => fallback.getAvailability(eventTypeId, dateFrom, dateTo) : null,
        ctx,
      ),
    createBooking: (booking) =>
      withProviderFallback(
        () => primary.createBooking(booking),
        fallback ? () => fallback.createBooking(booking) : null,
        ctx,
      ),
    cancelBooking: (bookingId, reason) =>
      withProviderFallback(
        () => primary.cancelBooking(bookingId, reason),
        fallback ? () => fallback.cancelBooking(bookingId, reason) : null,
        ctx,
      ),
  };
}
