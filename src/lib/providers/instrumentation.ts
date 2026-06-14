import { trackProviderUsage } from "./usage.server";
import type { ProviderCategory } from "./types";

/**
 * Wraps a provider operation with automatic primary→fallback logic.
 *
 * Two fallback triggers (both honored):
 *  1. Pre-flight health check: if `context.primaryHealthCheck` is provided and
 *     returns false, the fallback is used immediately without attempting the
 *     primary call. This proactively avoids sending traffic to an unhealthy
 *     provider without waiting for a runtime error.
 *  2. Runtime error: if primaryFn() throws, the fallback is invoked.
 *
 * Usage:
 *   return withProviderFallback(
 *     () => primary.createSession(params),
 *     fallback ? () => fallback.createSession(params) : null,
 *     {
 *       category: "voice",
 *       primaryName: "retell",
 *       fallbackName: "openai",
 *       primaryHealthCheck: () => primary.healthCheck(),
 *     },
 *   );
 */
export async function withProviderFallback<T>(
  primaryFn: () => Promise<T>,
  fallbackFn: (() => Promise<T>) | null,
  context: {
    category: string;
    primaryName: string;
    fallbackName?: string;
    /** Optional: called before primaryFn. If returns false, skip primary and use fallback. */
    primaryHealthCheck?: () => Promise<boolean>;
  },
): Promise<T> {
  // Pre-flight health check — skip primary if known unhealthy
  if (context.primaryHealthCheck && fallbackFn) {
    let healthy = true;
    try { healthy = await context.primaryHealthCheck(); } catch { healthy = false; }
    if (!healthy) {
      console.warn(
        `[provider-fallback] ${context.category}:${context.primaryName} healthCheck=false — ` +
        `using ${context.fallbackName ?? "fallback"} proactively`,
      );
      return await fallbackFn();
    }
  }

  // Runtime fallback on thrown error
  try {
    return await primaryFn();
  } catch (primaryErr: any) {
    if (!fallbackFn) throw primaryErr;
    console.warn(
      `[provider-fallback] ${context.category}:${context.primaryName} failed — ` +
      `switching to ${context.fallbackName ?? "fallback"}: ${primaryErr?.message ?? primaryErr}`,
    );
    return await fallbackFn();
  }
}

export interface TrackParams<T = unknown> {
  workspaceId: string;
  category: ProviderCategory;
  providerName: string;
  /** Fixed cost to record. Ignored when costExtractor is provided. */
  costUsd?: number;
  /**
   * Optional function that extracts the actual cost from the call result.
   * Use this for LLM / token-priced providers where cost is known only after
   * the call (e.g. result.costUsd). Takes precedence over costUsd.
   */
  costExtractor?: (result: T) => number;
}

/**
 * Generic per-request instrumentation helper.
 * Wraps any provider call in usage tracking without coupling adapter logic to DB access.
 * Fails silently — never surfaces tracking errors to the caller.
 */
export async function withProviderTracking<T>(
  params: TrackParams<T>,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await fn();
    const costUsd = params.costExtractor
      ? params.costExtractor(result)
      : (params.costUsd ?? 0);
    trackProviderUsage({
      workspaceId: params.workspaceId,
      category: params.category,
      providerName: params.providerName,
      durationMs: Date.now() - t0,
      costUsd,
      isError: false,
    }).catch(() => {});
    return result;
  } catch (err) {
    trackProviderUsage({
      workspaceId: params.workspaceId,
      category: params.category,
      providerName: params.providerName,
      durationMs: Date.now() - t0,
      isError: true,
    }).catch(() => {});
    throw err;
  }
}
