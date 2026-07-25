/**
 * GET /api/public/v1/sites/:siteKey/posts — published articles only.
 * Pagination, category/tag filters, published/updated ordering, ETag.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handlePublicGet, optionsResponse } from "@/lib/growthmind/public-content-http.server";
import { listPublicPosts } from "@/lib/growthmind/public-content.server";

export const Route = createFileRoute("/api/public/v1/sites/$siteKey/posts")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request, params }: { request: Request; params: { siteKey: string } }) => {
        const url = new URL(request.url);
        return handlePublicGet(request, params.siteKey, () =>
          listPublicPosts(params.siteKey, {
            page: Number(url.searchParams.get("page") ?? "1") || 1,
            pageSize: Number(url.searchParams.get("pageSize") ?? "10") || 10,
            category: url.searchParams.get("category"),
            tag: url.searchParams.get("tag"),
            order: url.searchParams.get("order") === "updated" ? "updated" : "published",
          }),
        );
      },
    },
  },
});
