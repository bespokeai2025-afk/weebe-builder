# Lovable Blog Integration Contract — WEBEE Public Content API

Status: **API Published — Awaiting Lovable Frontend.**
WEBEE's publishing backbone is live. The Lovable site (www.webespokeai.com) must implement the
frontend described here. Until it does: no article renders on the website, `sitemap.xml` is
**Missing — awaiting Lovable implementation**, and WEBEE never claims any article is "Live".

## 1. Base URL and site key

- Base: `https://webeereceptionist.com/api/public/v1/sites/{siteKey}`
- Site key for the Lovable site: **`webespokeai`** (canonical host `www.webespokeai.com`)

All endpoints are **read-only GET**, public (no auth), rate-limited to **60 requests/minute per IP**,
support **ETag / If-None-Match (304)**, and send `X-Robots-Tag: noindex` (the API itself must not be
indexed — only the rendered pages on www.webespokeai.com should be).

CORS: `https://www.webespokeai.com` and `https://webespokeai.com` are in the site's allowed origins.
Server-side fetching from Lovable (recommended) needs no CORS.

## 2. Endpoints

### `GET /posts`
Query params: `page` (default 1), `pageSize` (1–50, default 10), `category`, `tag`, `order`
(`published` default | `updated`).

```json
{
  "items": [ { "slug": "...", "title": "...", "excerpt": "...", "category": "...",
    "tags": ["..."], "author_name": "...", "featured_image_url": "...",
    "featured_image_alt": "...", "published_at": "ISO", "updated_at": "ISO" } ],
  "page": 1, "pageSize": 10, "total": 0, "totalPages": 1
}
```

### `GET /posts/{slug}`
404 `{"error":"not_found"}` for drafts, withdrawn articles, unknown slugs.
200 body: `{ "item": { ...list fields, plus: "body_format", "article_body", "meta_title",
"meta_description", "canonical_url", "og_title", "og_description", "og_image_url",
"structured_data", "internal_links", "cta", "noindex" } }`

Rendering requirements per article page:
- `<title>` = `meta_title`; `<meta name="description">` = `meta_description`
- `<link rel="canonical" href="{canonical_url}">` — always the canonical host form
- OpenGraph tags from `og_*`
- If `structured_data` is non-null, emit it verbatim as `<script type="application/ld+json">`
- If `noindex` is true, emit `<meta name="robots" content="noindex">`; otherwise emit nothing
- `article_body` is trusted, WEBEE-sanitised HTML (`body_format: "html"`); render as-is

### `GET /categories`
`{ "categories": [{ "name", "count" }], "tags": [{ "name", "count" }] }`

### `GET /feed`
RSS 2.0 XML (`application/rss+xml`). Optionally proxy at `https://www.webespokeai.com/blog/feed.xml`.

### `GET /sitemap-data`
```json
{ "canonical_host": "www.webespokeai.com",
  "urls": [ { "loc": "https://www.webespokeai.com/...", "lastmod": "YYYY-MM-DD|null",
              "changefreq": "daily", "priority": 1.0 } ] }
```
**Lovable must implement `https://www.webespokeai.com/sitemap.xml`** by fetching this endpoint
(server-side, cache ≤ 1 hour) and emitting standard `<urlset>` XML from `urls`. Include only what
the API returns — never invent URLs. `noindex` articles are already excluded.

### `GET /preview/{itemId}?token=...`
Human review of unpublished drafts. Tokens are single-article, 1-hour, revocable; invalid/expired
tokens → 404. Preview responses are always `noindex`. Lovable may optionally render a preview route
that passes the token through; not required for launch.

## 3. Behaviour guarantees (WEBEE side)

- Only published articles appear (statuses behind the API: api_published / awaiting refresh / live).
  Drafts, blocked, withdrawn: never.
- While an article is being updated, the **previously published version keeps serving** — in-progress
  edits are never exposed.
- Withdrawal removes the article from all endpoints (list, single, feed, sitemap-data) immediately.
- Rollback re-serves an earlier published version under the same slug.
- Slugs are lowercase `[a-z0-9-]`, unique per site, never reused for different articles, and reserved
  paths (api, admin, blog, sitemap.xml, robots.txt, …) are rejected at creation.

## 4. Frontend routes Lovable must implement

1. `/blog` — paginated listing from `GET /posts` (server-side fetch recommended)
2. `/blog/{slug}` — article page from `GET /posts/{slug}` with the metadata rules above; unknown
   slug → HTTP 404 page
3. `/sitemap.xml` — generated from `GET /sitemap-data` (see above)
4. Keep `robots.txt` allowing crawl and referencing `Sitemap: https://www.webespokeai.com/sitemap.xml`

## 5. Verification handshake

After Lovable ships, WEBEE's live-verification step fetches
`https://www.webespokeai.com/blog/{slug}` for each published article and only then marks it **Live**
(checks: HTTP 200, canonical tag, no unexpected noindex). SystemMind's health check reports
`Lovable Blog Frontend: Connected` once `/blog` responds with rendered blog content.
