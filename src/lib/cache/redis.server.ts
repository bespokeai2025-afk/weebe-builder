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

function getRedis(): any | null {
  if (_initialized) return _redis;
  _initialized = true;

  const url   = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) {
    return null;
  }

  try {
    const { Redis } = require("@upstash/redis");
    _redis = new Redis({ url, token });
  } catch (e) {
    console.warn("[cache] Failed to initialize Upstash Redis:", e);
    _redis = null;
  }

  return _redis;
}

/**
 * Read a value from Redis. Returns null on miss or when Redis is unavailable.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
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
export async function cacheSet(key: string, ttlSeconds: number, value: unknown): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
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
  const redis = getRedis();
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
): Promise<T> {
  if (!bust) {
    const cached = await cacheGet<T>(key);
    if (cached !== null) return cached;
  }

  const result = await factory();
  await cacheSet(key, ttlSeconds, result);
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
  const redis = getRedis();

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

  const redis = getRedis();
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
