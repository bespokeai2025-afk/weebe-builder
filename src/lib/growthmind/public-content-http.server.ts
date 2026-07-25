/**
 * Shared HTTP plumbing for the public content API (§3, §12).
 * Rate limiting per IP, origin-allowlisted CORS, ETag/304 handling,
 * stable safe error schema. No wildcard CORS beyond simple public GETs to
 * the approved origins.
 */
import { checkRateLimit } from "@/lib/lead-gen/webforms.server";
import { createHash } from "node:crypto";
import { getSiteByKey } from "./public-content.server";

const RATE_LIMIT_PER_MIN = 60;

export function corsHeadersFor(site: any | null, requestOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
    Vary: "Origin",
  };
  const allowed: string[] = site?.allowed_origins ?? [];
  if (requestOrigin && allowed.includes(requestOrigin)) {
    headers["Access-Control-Allow-Origin"] = requestOrigin;
  }
  return headers;
}

export function etagOf(version: string): string {
  return `"${createHash("sha256").update(version).digest("hex").slice(0, 24)}"`;
}

/**
 * Wraps a public GET: rate-limits by IP, resolves the site, applies CORS,
 * handles If-None-Match, and formats safe errors.
 */
export async function handlePublicGet(
  request: Request,
  siteKey: string,
  fn: (site: any) => Promise<{ ok: boolean; status: number; body: any; version?: string; contentType?: string }>,
): Promise<Response> {
  const origin = request.headers.get("origin");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "global";

  if (!/^[a-z0-9\-]{1,60}$/.test(siteKey)) {
    return Response.json({ error: "site_not_found" }, { status: 404 });
  }
  const site = await getSiteByKey(siteKey);
  const cors = corsHeadersFor(site, origin);
  if (!site) return Response.json({ error: "site_not_found" }, { status: 404, headers: cors });

  const allowedRate = await checkRateLimit(`pubcontent:${siteKey}:${ip}`, RATE_LIMIT_PER_MIN);
  if (!allowedRate) {
    return Response.json({ error: "rate_limited" }, { status: 429, headers: { ...cors, "Retry-After": "60" } });
  }

  try {
    const result = await fn(site);
    const isXml = result.contentType?.includes("xml");
    const headers: Record<string, string> = {
      ...cors,
      "Cache-Control": result.ok ? "public, max-age=60, stale-while-revalidate=300" : "no-store",
      "X-Robots-Tag": "noindex", // the API responses themselves must never be indexed
      ...(isXml ? { "Content-Type": result.contentType! } : {}),
    };
    if (result.ok && result.version) {
      const etag = etagOf(result.version);
      headers.ETag = etag;
      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, { status: 304, headers });
      }
    }
    if (isXml) return new Response(String(result.body), { status: result.status, headers });
    return Response.json(result.body, { status: result.status, headers });
  } catch (e: any) {
    console.error(`[public-content-api] ${siteKey} error:`, e?.message ?? e);
    return Response.json({ error: "internal_error" }, { status: 500, headers: cors });
  }
}

export function optionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*", // preflight only; data responses use the allowlist
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
    },
  });
}
