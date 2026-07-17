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

// Secrets are sometimes pasted with variable names, quotes, or even the whole
// multi-line .env block included (verified in this project: the TOKEN secret
// contained `UPSTASH_REDIS_REST_URL="..." UPSTASH_REDIS_REST_TOKEN="..."`).
// Extract the value anchored to the requested name if present; otherwise
// strip surrounding quotes.
function cleanEnvValue(name: string): string | undefined {
  let v = process.env[name]?.trim();
  if (!v) return undefined;
  const anchored = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|(\\S+))`).exec(v);
  if (anchored) v = (anchored[2] ?? anchored[3] ?? anchored[4] ?? "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v || undefined;
}

// Lazy async initializer. This file runs in an ESM runtime where CommonJS
// `require` is undefined, so the Upstash client MUST be loaded via a dynamic
// `import()` (a string-literal specifier so the prod Rollup build resolves it).
// The init promise is memoized so concurrent callers share one initialization.
async function getRedis(): Promise<any | null> {
  if (_initialized) return _redis;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const url   = cleanEnvValue("UPSTASH_REDIS_REST_URL");
    const token = cleanEnvValue("UPSTASH_REDIS_REST_TOKEN");

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
// If Upstash rejects our credentials (WRONGPASS / unauthorized), every cache
// call is a guaranteed-failing HTTP round trip that only adds latency. Disable
// the client for the rest of the process lifetime and log once.
let _authFailureLogged = false;
function disableOnAuthError(e: any): boolean {
  const msg = String(e?.message ?? e ?? "");
  if (/WRONGPASS|unauthorized|invalid or missing auth token/i.test(msg)) {
    _redis = null;
    if (!_authFailureLogged) {
      _authFailureLogged = true;
      console.error(
        "[cache] Upstash rejected the credentials (WRONGPASS). Caching DISABLED for this process. " +
        "Fix: re-enter UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in deployment secrets " +
        "(values only — no variable name, no quotes) from the same Upstash database, then republish.",
      );
    }
    return true;
  }
  return false;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const val = await redis.get(key);
    if (val === null || val === undefined) return null;
    return val as T;
  } catch (e) {
    if (!disableOnAuthError(e)) console.warn("[cache] cacheGet error:", key, e);
    return null;
  }
}

// ── Redis value-size policy ───────────────────────────────────────────────────
// Upstash's REST API enforces a max request size (10MB on pay-as-you-go, 1MB on
// the free tier). Redis is only meant to cache SMALL, short-lived data (counts,
// summaries, paginated slices, sync status, locks). Full lists (e.g. the WBAH
// calls list ~20MB, or full lead lists) must NOT be cached here — Supabase is the
// source of truth for those. These thresholds enforce that:
//   • WARN above 500KB  — a value this large usually means an unpaginated list;
//     it should be paginated or served from Supabase instead.
//   • SKIP above 5MB    — never write it (well below Upstash's 10MB hard limit,
//     with margin). The caller still gets its freshly-computed result.
const REDIS_WARN_BYTES = 512_000;    // 500 KB
const REDIS_MAX_BYTES  = 5_000_000;  // 5 MB hard skip (Upstash limit is 10 MB)

function mb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(2);
}

/** Structured log for every Redis write so payload sizes are always observable. */
function logRedisWrite(op: string, key: string, bytes: number, extra?: Record<string, unknown>) {
  const wsMatch = /:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(key);
  const workspaceId = wsMatch?.[1] ?? "n/a";
  console.log(
    `[redis] op=${op} provider=redis key=${key} workspace_id=${workspaceId} ` +
    `bytes=${bytes} sizeMB=${mb(bytes)}` +
    (extra ? " " + Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(" ") : ""),
  );
}

/**
 * Write a value to Redis with a TTL in seconds. Never throws; logs size + errors.
 */
export async function cacheSet(key: string, ttlSeconds: number, value: unknown): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  let size = 0;
  try { size = JSON.stringify(value)?.length ?? 0; } catch { size = 0; }

  logRedisWrite("SET", key, size, { ttl: ttlSeconds });

  if (size > REDIS_MAX_BYTES) {
    console.error(
      `[redis] SKIP oversized SET key=${key} sizeMB=${mb(size)} exceeds cap ${mb(REDIS_MAX_BYTES)}MB ` +
      `(Upstash request limit is 10MB). This should be paginated or read from Supabase, not cached whole.`,
    );
    return;
  }
  if (size > REDIS_WARN_BYTES) {
    console.warn(
      `[redis] LARGE SET key=${key} sizeMB=${mb(size)} (>500KB). ` +
      `Prefer caching counts/summaries/paginated slices; keep full lists in Supabase.`,
    );
  }

  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (e: any) {
    if (disableOnAuthError(e)) return;
    console.error(`[redis] SET FAILED key=${key} bytes=${size} sizeMB=${mb(size)} msg=${e?.message}`);
    if (e?.stack) console.error(e.stack);
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
    if (!disableOnAuthError(e)) console.warn("[cache] cacheDel error:", keys, e);
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
