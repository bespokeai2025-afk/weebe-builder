/**
 * GET /api/public/v1/sites/:siteKey/feed — RSS 2.0 feed of published articles.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handlePublicGet, optionsResponse } from "@/lib/growthmind/public-content-http.server";
import { getPublicFeed } from "@/lib/growthmind/public-content.server";

export const Route = createFileRoute("/api/public/v1/sites/$siteKey/feed")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request, params }: { request: Request; params: { siteKey: string } }) =>
        handlePublicGet(request, params.siteKey, async () => {
          const res = await getPublicFeed(params.siteKey);
          return { ...res, contentType: "application/rss+xml; charset=utf-8" };
        }),
    },
  },
});
