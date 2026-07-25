// ── Outbound URL guard for user-supplied CRM endpoints (Task #457) ────────────
// generic_rest baseUrl and webhook webhookUrl are attacker-controllable input
// to server-side fetches — block private/internal targets (SSRF). Tests may
// opt out via CRM_CONNECTIONS_ALLOW_PRIVATE_URLS=1 (never set in prod).

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    return v6 === "::1" || v6 === "::" || v6.startsWith("fe80:") || v6.startsWith("fc") ||
           v6.startsWith("fd") || v6.startsWith("::ffff:");
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  return (
    p[0] === 0 || p[0] === 10 || p[0] === 127 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 192 && p[1] === 0 && p[2] === 0) ||
    (p[0] === 198 && (p[1] === 18 || p[1] === 19)) ||
    p[0] >= 224
  );
}

/** Throws when the URL targets a private/internal host. DNS-resolves the hostname. */
export async function assertSafeOutboundUrl(raw: string, what: string): Promise<void> {
  if (process.env.CRM_CONNECTIONS_ALLOW_PRIVATE_URLS === "1") return;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${what} is not a valid URL.`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`${what} must be an http(s) URL.`);
  }
  if (u.username || u.password) throw new Error(`${what} must not embed credentials.`);
  const host = u.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || isPrivateIp(host)) {
    throw new Error(`${what} must point to a public host — private/internal addresses are not allowed.`);
  }
  try {
    const { lookup } = await import("node:dns/promises");
    const addrs = await lookup(host, { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
      throw new Error(`${what} resolves to a private/internal address — not allowed.`);
    }
  } catch (e) {
    if (e instanceof Error && /private|internal|not allowed/.test(e.message)) throw e;
    throw new Error(`${what} hostname could not be resolved.`);
  }
}

/** Validates any URL-bearing credential fields for a provider. */
export async function assertSafeCredentialUrls(provider: string, creds: Record<string, string>): Promise<void> {
  const checks: Array<[string, string]> = [];
  if (provider === "generic_rest" && creds.baseUrl) checks.push([creds.baseUrl, "Base URL"]);
  if (provider === "webhook") {
    const u = creds.webhookUrl ?? creds.webhook_url ?? creds.url;
    if (u) checks.push([u, "Webhook URL"]);
  }
  for (const [url, what] of checks) await assertSafeOutboundUrl(url, what);
}
