/**
 * GET /api/public/v1/sites/:siteKey/preview/:itemId?token=… — protected draft
 * preview (§4). Token: random 256-bit, article-scoped, 1h TTL, revocable.
 * Always noindex; marked as draft preview; no draft listing exists.
 */
import { createFileRoute } from "@tanstack/react-router";
import { checkRateLimit } from "@/lib/lead-gen/webforms.server";
import { getSiteByKey, resolvePreview, toPublicPost } from "@/lib/growthmind/public-content.server";
import { corsHeadersFor, optionsResponse } from "@/lib/growthmind/public-content-http.server";

export const Route = createFileRoute("/api/public/v1/sites/$siteKey/preview/$itemId")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request, params }: { request: Request; params: { siteKey: string; itemId: string } }) => {
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "global";
        if (!(await checkRateLimit(`pubpreview:${ip}`, 30))) {
          return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
        }
        const site = await getSiteByKey(params.siteKey);
        const cors = corsHeadersFor(site, request.headers.get("origin"));
        const headers = { ...cors, "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };
        if (!/^[0-9a-f\-]{36}$/i.test(params.itemId)) {
          return Response.json({ error: "not_found" }, { status: 404, headers });
        }
        const token = new URL(request.url).searchParams.get("token") ?? "";
        const item = await resolvePreview(params.siteKey, params.itemId, token);
        if (!item) return Response.json({ error: "preview_invalid_or_expired" }, { status: 404, headers });
        return Response.json(
          { item: toPublicPost(item, site, { full: true, preview: true }) },
          { headers },
        );
      },
    },
  },
});
