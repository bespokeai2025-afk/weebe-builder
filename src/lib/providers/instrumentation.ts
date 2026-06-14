import { trackProviderUsage } from "./usage.server";
import type { ProviderCategory } from "./types";

export interface TrackParams {
  workspaceId: string;
  category: ProviderCategory;
  providerName: string;
  costUsd?: number;
}

/**
 * Generic per-request instrumentation helper.
 * Wraps any provider call in usage tracking without coupling adapter logic to DB access.
 * Fails silently — never surfaces tracking errors to the caller.
 */
export async function withProviderTracking<T>(
  params: TrackParams,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await fn();
    trackProviderUsage({
      workspaceId: params.workspaceId,
      category: params.category,
      providerName: params.providerName,
      durationMs: Date.now() - t0,
      costUsd: params.costUsd ?? 0,
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
