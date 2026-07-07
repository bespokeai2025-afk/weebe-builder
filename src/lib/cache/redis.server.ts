/**
 * Redis caching layer — Upstash Redis over HTTP (no persistent TCP connection).
 *
 * All helpers degrade gracefully when Redis is not configured:
 *   - cacheGet  → returns null (cache miss)
 *   - cacheSet  → no-op
 *   - cacheDel  → no-op
 *   - cacheWrap → executes the factory and returns its result directly
 *
 * Key conventions:
 *   webee:<module>:<workspaceId>:<resource>
 *
 * Usage:
 *   import { cacheWrap, cacheDel } from "@/lib/cache/redis.server";
 *   const data = await cacheWrap(`webee:hivemind:${wid}:platform`, 300, () => buildData());
 */

let _redis: any = null;
let _initialized = false;
let _initPromise: Promise<any | null> | null = null;

// Lazy async initializer. This file runs in an ESM runtime where CommonJS
// `require` is undefined, so the Upstash client MUST be loaded via a dynamic
// `import()` (a string-literal specifier so the prod Rollup build resolves it).
// The init promise is memoized so concurrent callers share one initialization.
async function getRedis(): Promise<any | null> {
  if (_initialized) return _redis;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const url   = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

    if (!url || !token) {
      _initialized = true;
      return null;
    }

    try {
      const mod: any = await import("@upstash/redis");
      const Redis = mod.Redis ?? mod.default?.Redis;
      // Disable auto-pipelining: with it enabled, command errors (e.g. a value
      // exceeding Upstash's max request size) reject asynchronously OUTSIDE the
      // try/catch in cacheSet, which would surface as an unhandled failure and
      // break the calling server function instead of degrading gracefully.
      _redis = new Redis({ url, token, enableAutoPipelining: false, latencyLogging: false });
    } catch (e) {
      console.warn("[cache] Failed to initialize Upstash Redis:", e);
      _redis = null;
    }
    _initialized = true;
    return _redis;
  })();

  return _initPromise;
}

/**
 * Read a value from Redis. Returns null on miss or when Redis is unavailable.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const val = await redis.get(key);
    if (val === null || val === undefined) return null;
    return val as T;
  } catch (e) {
    console.warn("[cache] cacheGet error:", key, e);
    return null;
  }
}

/**
 * Write a value to Redis with a TTL in seconds.
 */
// Upstash's REST API rejects oversized request bodies (~1MB on the free tier,
// higher on paid). Large derived payloads (e.g. the full WBAH calls list with
// transcripts) exceed that, so we skip caching them rather than let the write
// fail. ~900KB keeps a safety margin below the 1MB limit.
const MAX_CACHE_VALUE_BYTES = 900_000;

export async function cacheSet(key: string, ttlSeconds: number, value: unknown): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    // Guard against oversized values (avoids an Upstash request-too-large error).
    let size = 0;
    try { size = JSON.stringify(value)?.length ?? 0; } catch { size = 0; }
    if (size > MAX_CACHE_VALUE_BYTES) {
      console.warn(`[cache] skipping oversized value for ${key} (${size} bytes)`);
      return;
    }
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (e) {
    console.warn("[cache] cacheSet error:", key, e);
  }
}

/**
 * Delete one or more keys from Redis.
 * Supports glob-style patterns via KEYS + DEL when key ends with *.
 */
export async function cacheDel(...keys: string[]): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    for (const key of keys) {
      if (key.endsWith("*")) {
        const matched: string[] = await redis.keys(key);
        if (matched.length > 0) {
          await redis.del(...matched);
        }
      } else {
        await redis.del(key);
      }
    }
  } catch (e) {
    console.warn("[cache] cacheDel error:", keys, e);
  }
}

/**
 * Cache-aside helper. Reads from cache; on miss calls factory, stores result, and returns it.
 *
 * Pass bust=true to skip the cache read (still writes on compute). Useful in dev.
 */
export async function cacheWrap<T>(
  key: string,
  ttlSeconds: number,
  factory: () => Promise<T>,
  bust = false,
  shouldCache?: (result: T) => boolean,
): Promise<T> {
  if (!bust) {
    const cached = await cacheGet<T>(key);
    if (cached !== null) return cached;
  }

  const result = await factory();
  // Only persist results the caller considers cacheable. This prevents an
  // error/empty-due-to-error result from being pinned in the cache for the full
  // TTL (which would make a transient upstream failure "stick" as zero data).
  // Caching is best-effort — a cache write must never break the caller.
  try {
    if (!shouldCache || shouldCache(result)) {
      await cacheSet(key, ttlSeconds, result);
    }
  } catch (e) {
    console.warn("[cache] cacheWrap set failed (ignored):", key, e);
  }
  return result;
}

/**
 * Health check for the Redis connection.
 * Returns connected status, latency, and key count.
 * Safe to call from admin UI — never throws.
 */
export async function cacheHealthCheck(): Promise<{
  configured: boolean;
  connected: boolean;
  latencyMs: number | null;
  keyCount: number | null;
  error: string | null;
}> {
  const redis = await getRedis();

  if (!redis) {
    return { configured: false, connected: false, latencyMs: null, keyCount: null, error: null };
  }

  const start = Date.now();
  try {
    const pong = await redis.ping();
    const latencyMs = Date.now() - start;
    if (pong !== "PONG") {
      return { configured: true, connected: false, latencyMs, keyCount: null, error: "Unexpected ping response" };
    }
    let keyCount: number | null = null;
    try {
      keyCount = await redis.dbsize();
    } catch {
      // dbsize is optional — don't fail the health check
    }
    return { configured: true, connected: true, latencyMs, keyCount, error: null };
  } catch (e: any) {
    return {
      configured: true,
      connected: false,
      latencyMs: Date.now() - start,
      keyCount: null,
      error: e?.message ?? "Unknown error",
    };
  }
}

/**
 * Flush all workspace-scoped cache keys.
 * Keys in this codebase follow the pattern webee:<module>:<workspaceId>:<resource>,
 * so the scan pattern is `webee:*:<workspaceId>:*`.
 * Returns the number of keys deleted.
 * Throws on Redis errors so callers can surface a meaningful failure message.
 * Returns 0 (no-op) when Redis is not configured.
 */
export async function cacheFlushWorkspace(workspaceId: string): Promise<number> {
  const redis = await getRedis();
  if (!redis) return 0;
  const pattern = `webee:*:${workspaceId}:*`;
  const matched: string[] = await redis.keys(pattern);
  if (matched.length === 0) return 0;
  await redis.del(...matched);
  return matched.length;
}

/**
 * Invalidate the shared HiveMind / GrowthMind / dashboard overview caches
 * for a given workspace. Call this after any mutation that affects call,
 * booking, or lead counts aggregated by those modules.
 *
 * The delete is fire-and-forget (errors are swallowed) so it never blocks
 * or crashes the mutation path when Redis is unavailable.
 */
export function invalidateDashboardCache(workspaceId: string): void {
  cacheDel(
    `webee:dashboard:${workspaceId}:overview`,
    `webee:hivemind:${workspaceId}:platform`,
    `webee:growthmind:${workspaceId}:platform`,
  ).catch(() => {});
}

/**
 * Redis-backed atomic rate limiter.
 * Returns { count, allowed, windowExpireAt, redisUsed }.
 *
 * Uses INCR + EXPIREAT (atomic via pipelining) keyed by minute window so the
 * counter expires at the top of the next minute.
 *
 * When Redis is unavailable, returns redisUsed=false so callers can fall back
 * to an alternative enforcement strategy rather than silently allowing requests.
 */
export async function redisRateLimit(
  key: string,
  limit: number,
): Promise<{ count: number; allowed: boolean; windowExpireAt: number; redisUsed: boolean }> {
  const windowStart = new Date();
  windowStart.setSeconds(0, 0);
  const windowExpireAt = Math.ceil(windowStart.getTime() / 1000) + 60;

  const redis = await getRedis();
  if (!redis) {
    return { count: 0, allowed: false, windowExpireAt, redisUsed: false };
  }

  try {
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.expireat(key, windowExpireAt);
    const [count] = await pipeline.exec() as [number, ...unknown[]];
    return { count, allowed: count <= limit, windowExpireAt, redisUsed: true };
  } catch (e) {
    console.warn("[cache] redisRateLimit error:", key, e);
    return { count: 0, allowed: false, windowExpireAt, redisUsed: false };
  }
}
