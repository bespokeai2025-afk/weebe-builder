import type { TelephonyProvider, TelephonyConfig } from "@/lib/telephony/types";
import { createTelephonyProvider as _createTelephonyProvider } from "@/lib/telephony/provider-factory";
import { withProviderTracking } from "@/lib/providers/instrumentation";

export { type TelephonyProvider, type TelephonyConfig };

/**
 * Create a TelephonyProvider. When `workspaceId` is included in `config`,
 * every method call is automatically tracked in provider_usage.
 */
export function createTelephonyProvider(
  config: TelephonyConfig & { workspaceId?: string },
): TelephonyProvider {
  const inner = _createTelephonyProvider(config);
  if (!config.workspaceId) return inner;

  const { workspaceId } = config;
  const providerName = (config as any).provider ?? "unknown";
  const track = <T>(fn: () => Promise<T>) =>
    withProviderTracking({ workspaceId, category: "telephony", providerName }, fn);

  // Proxy every method on the telephony provider through the tracker
  return new Proxy(inner, {
    get(target, prop) {
      const value = (target as any)[prop];
      if (typeof value === "function") {
        return (...args: unknown[]) => track(() => (value as Function).apply(target, args));
      }
      return value;
    },
  }) as TelephonyProvider;
}

/** @deprecated Use createTelephonyProvider({ ..., workspaceId }) instead. */
export async function withTelephonyTracking<T>(
  workspaceId: string,
  providerName: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withProviderTracking({ workspaceId, category: "telephony", providerName }, fn);
}
