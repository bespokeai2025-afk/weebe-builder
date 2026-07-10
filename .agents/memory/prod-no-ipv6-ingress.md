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
real IP empirically: republish with a temporary log of the observed `ip` in the handler,
make one live request, read deployment logs, then allowlist that **exact IPv4**. Don't
guess an IPv6 /64 (won't fire in prod) and avoid a broad IPv4 /24 (CGNAT is shared across
many unrelated customers).
