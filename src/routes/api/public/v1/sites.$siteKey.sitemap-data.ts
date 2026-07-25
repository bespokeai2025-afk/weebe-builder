/**
 * GET /api/public/v1/sites/:siteKey/sitemap-data — canonical URL list for the
 * Lovable site's sitemap.xml (§9). Live/published pages only; never drafts,
 * previews, withdrawn articles, noindex pages or internal routes.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handlePublicGet, optionsResponse } from "@/lib/growthmind/public-content-http.server";
import { getSitemapData } from "@/lib/growthmind/public-content.server";

export const Route = createFileRoute("/api/public/v1/sites/$siteKey/sitemap-data")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request, params }: { request: Request; params: { siteKey: string } }) =>
        handlePublicGet(request, params.siteKey, () => getSitemapData(params.siteKey)),
    },
  },
});
