---
name: Website architecture audit (Phase 4)
description: Read-only DNS/hosting fingerprinting of the customer website; WEBEE has no website deployment integration.
---

**Rule:** The customer website's architecture is determined by live evidence, never assumption: DNS-over-HTTPS (dns.google) for NS/A/CNAME + a HEAD request for proxy headers. Fingerprints: Lovable Cloud custom-domain A record = `185.158.133.1`; Replit Deployments = `34.111.x`; GoDaddy DNS = `domaincontrol.com` nameservers; Cloudflare = `cf-ray` header. Implemented in `growthmind.website-arch.ts` (`auditWebsiteArchitecture`), surfaced as a read-only card on the SEO page.

**Why:** Master programme Phase 4 required an ownership audit without touching DNS. Finding (2026-07-25): `www.webespokeai.com` = GoDaddy nameservers + Lovable Cloud hosting behind Cloudflare. `dig`/`whois` are unavailable in this sandbox — use DoH via fetch.

**How to apply:** WEBEE has NO Lovable/GitHub deployment integration, so website capability is "content drafts only": any SEO/website change feature must produce approved change packages marked "Awaiting Website Deployment", never claim execution or use browser automation against production. Local `executeSql` tool hits the Replit DB, not Supabase — query Supabase via a node script with the service-role key.
