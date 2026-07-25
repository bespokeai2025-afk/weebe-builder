/**
 * GET /api/public/v1/sites/:siteKey/categories — categories + tags of published articles.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handlePublicGet, optionsResponse } from "@/lib/growthmind/public-content-http.server";
import { getPublicCategories } from "@/lib/growthmind/public-content.server";

export const Route = createFileRoute("/api/public/v1/sites/$siteKey/categories")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request, params }: { request: Request; params: { siteKey: string } }) =>
        handlePublicGet(request, params.siteKey, () => getPublicCategories(params.siteKey)),
    },
  },
});
