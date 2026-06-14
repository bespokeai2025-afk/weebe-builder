import { trackProviderUsage } from "./usage.server";
import type { ProviderCategory } from "./types";

/**
 * Wraps a provider operation with automatic primary→fallback logic.
 * Calls `primaryFn()` first; on any thrown error it logs a warning and calls
 * `fallbackFn()` if one is provided (otherwise re-throws).
 *
 * Usage:
 *   return withProviderFallback(
 *     () => primary.createSession(params),
 *     fallback ? () => fallback.createSession(params) : null,
 *     { category: "voice", primaryName: "retell", fallbackName: "openai" },
 *   );
 */
export async function withProviderFallback<T>(
  primaryFn: () => Promise<T>,
  fallbackFn: (() => Promise<T>) | null,
  context: { category: string; primaryName: string; fallbackName?: string },
): Promise<T> {
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
