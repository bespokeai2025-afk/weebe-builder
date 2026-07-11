---
name: Prod has no IPv6 ingress (AAAA-less domains)
description: webeereceptionist.com / webespokeai.com resolve A-only, so the backend sees clients' IPv4 in x-forwarded-for even for IPv6 users.
---

Both production domains (webeereceptionist.com and www.webespokeai.com) have **no AAAA
record** — they resolve to the Replit/GCLB IPv4 front end only. So every browser reaches
the backend over IPv4, and the first `x-forwarded-for` entry the app observes is the
client's **IPv4** (or CGNAT) address, even when the user's own connection has a public IPv6.

**Why:** matters for anything keyed on the caller IP (rate limiting, allowlists, geo). A
user reporting "my IP is 2a02:...::/64" from a what-is-my-ip check is NOT what the server
sees — the server sees their IPv4.

**How to apply:** when allowlisting a developer for prod testing of the public endpoints
(`RATE_LIMIT_ALLOWLIST_IPS`, consumed by `isRateLimitExempt` in webforms.server.ts for the
Ava-call / webform limiter — it now supports CIDR ranges + exact IPv4/IPv6), capture the
real IP empirically. Don't guess an IPv6 /64 (won't fire in prod) and avoid a broad IPv4
/24 (CGNAT is shared across many unrelated customers).

**Fastest capture — mine stored rows, no republish loop needed:** the tester's real IPv4 is
already persisted from their earlier (throttled) attempts. Query Supabase
`ava_call_requests.ip_address` (or `webform_submissions.ip_address`) for the most recent
rows — the app stores the same first-`x-forwarded-for` hop it rate-limits on, so the exact
IPv4 to allowlist is right there. Only fall back to the republish-with-temp-log approach if
no stored rows exist. Query Supabase via its REST API with `SUPABASE_SERVICE_ROLE_KEY` +
`VITE_SUPABASE_URL` (secrets are in the bash env, NOT the code_execution sandbox's
process.env; run a `node -e` script from bash). Then set the exact IPv4 into the
**production** `RATE_LIMIT_ALLOWLIST_IPS` (keep the /64 too, it's harmless). A production
env-var change only takes effect after the next publish, so the app must be republished for
it to fire.
