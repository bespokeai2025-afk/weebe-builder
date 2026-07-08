---
name: WBAH aggregate cache & Leads perf
description: Why WBAH Leads was slow — Redis 5MB SET cap silently skipped the ~8MB calls aggregate; fixes and invariants for the in-process cache layer.
---

# WBAH calls aggregate — caching & performance

**The trap:** the Redis layer (`redis.server.ts`) hard-skips SETs >5MB (Upstash cap). The WBAH calls aggregate (~16k rows, `AGGREGATE_COLS`) serializes to ~8MB, so `cacheWrap` was silently a no-op — every Leads/Qualified/Calendar open paid a full rebuild. A cacheWrap around a big list is NOT proof it's cached; check the `[redis] SKIP oversized SET` log.

**Current design (wbah-leads.server.ts):**
- In-process memory cache `_aggMem` (per workspace, TTL = WBAH_AGGREGATE_TTL 180s) + single-flight `_aggInflight` so login-prefetch bursts share one rebuild. Redis cacheWrap still attempted (self-guards; keeps size logs — expect a recurring `SKIP oversized SET` error line, harmless).
- Rebuild is parallel: exact count head query, then all ~17 pages via Promise.all (+1 page headroom, id-dedupe across page borders). ~2s vs ~6s sequential.
- **Invalidation must go through `invalidateWbahAggregate(workspaceId)`** (clears memory + Redis). Raw `cacheDel` of the key leaves the memory copy stale.
- **Why:** prod is a single srvx process; single-process memory cache is coherent. Staleness hard-bounded at 180s.

**Invariants:**
- Never mutate aggregate rows or the shared `all` array in consumers — memory hits return the same object references (byPhone is rebuilt per call, so per-contact sorts are safe).
- The booked-contacts repair (`ensureWbahBookedContactsInDb`) is background-only: single-flight + 5-min throttle via `scheduleEnsureWbahBookedContacts`. Never await it in a read path — it can talk to WeeBespoke for tens of seconds.
- `countBookedCallsInDb` filters `.or(calendly_booking_url/appointment_date/booking_status not null)` — a strict superset of `isWbahRecordBooked`, so JS-side filtering keeps the count exact without scanning 16k rows.
- Don't unconditionally `cacheDel` the aggregate from read paths (the calendar used to — forced a rebuild on every open). Sync jobs bust it on real row changes; worst case 180s stale.
