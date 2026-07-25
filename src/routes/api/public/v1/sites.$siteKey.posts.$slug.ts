/**
 * GET /api/public/v1/sites/:siteKey/posts/:slug — single published article (full body).
 */
import { createFileRoute } from "@tanstack/react-router";
import { handlePublicGet, optionsResponse } from "@/lib/growthmind/public-content-http.server";
import { getPublicPost } from "@/lib/growthmind/public-content.server";

export const Route = createFileRoute("/api/public/v1/sites/$siteKey/posts/$slug")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request, params }: { request: Request; params: { siteKey: string; slug: string } }) =>
        handlePublicGet(request, params.siteKey, () => getPublicPost(params.siteKey, params.slug)),
    },
  },
});
