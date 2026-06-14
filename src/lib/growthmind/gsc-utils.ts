/**
 * Build the percent-encoded site identifier used in GSC REST API paths.
 *
 * The Webmasters v3 API accepts two property URL formats:
 *   • https:// — e.g. "https://example.com/"
 *   • sc-domain: — e.g. "sc-domain:example.com"
 *
 * Both must be passed as a URL-encoded path segment.  `encodeURIComponent`
 * correctly encodes `:` → `%3A` and `/` → `%2F` for both formats, so the
 * sc-domain: prefix is preserved exactly as stored in workspace_settings.
 */
export function buildGscEncodedSiteUrl(propertyUrl: string): string {
  return encodeURIComponent(propertyUrl.trim());
}
