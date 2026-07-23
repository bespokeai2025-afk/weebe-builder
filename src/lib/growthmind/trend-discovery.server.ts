// ── Trend Scout Discovery Engine ──────────────────────────────────────────────
// SERVER ONLY. Pulls trend/content items from multiple compliant sources for
// every workspace with Trend Scout enabled + at least one active monitored
// source. Each fetcher fails independently and its outcome (incl. cost
// estimate) is logged to growthmind_discovery_runs. Cheap-first: discovery
// never calls AI models — scoring is a separate, gated stage.
//
// Uses createClient directly (no @/ alias) so it is safe to import from
// vite.config.ts at config-load time — same pattern as growthmind.ads-sync-tick.ts.

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { decryptMetaToken } from "./meta-token.server";

const supabaseUrl        = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function getTrendAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const META_API_BASE = "https://graph.facebook.com/v19.0";
const FETCH_TIMEOUT_MS = 15_000;

// ── Types ──────────────────────────────────────────────────────────────────────

export type DiscoverySource =
  | "internal" | "owned_meta" | "ig_business_discovery" | "meta_ad_library"
  | "google_trends" | "youtube" | "reddit" | "news";

export type DiscoveredItem = {
  platform:     string;         // instagram | facebook | youtube | google_trends | news | reddit | internal | meta_ad_library
  externalId?:  string | null;
  url?:         string | null;
  title?:       string | null;
  caption?:     string | null;
  mediaType?:   string | null;
  authorHandle?: string | null;
  authorName?:  string | null;
  publishedAt?: string | null;
  metrics:      Record<string, unknown>;
  sourceId?:    string | null;  // growthmind_monitored_sources.id
  raw?:         Record<string, unknown>;
};

export type SourceRunResult = {
  source:     DiscoverySource;
  status:     "success" | "error" | "skipped";
  itemsFound: number;
  itemsNew:   number;
  error?:     string;
  skipReason?: string;
  durationMs: number;
};

export type DiscoverySummary = {
  workspaceId: string;
  ran:         boolean;
  skipReason?: string;
  runs:        SourceRunResult[];
  totalNew:    number;
};

type MonitoredRow = {
  id: string; source_kind: string; platform: string | null;
  value: string; label: string | null; priority: number; status: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

export function trendContentHash(platform: string, key: string): string {
  return createHash("sha256").update(`${platform}:${key.toLowerCase().trim()}`).digest("hex");
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Minimal RSS/Atom item extraction — titles, links, pubDates. No deps.
function parseRssItems(xml: string, max = 25): Array<{ title: string; link: string | null; pubDate: string | null; extra: Record<string, string> }> {
  const items: Array<{ title: string; link: string | null; pubDate: string | null; extra: Record<string, string> }> = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/\1>/g) ?? [];
  for (const block of blocks.slice(0, max)) {
    const pick = (tag: string): string | null => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      if (!m) return null;
      return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();
    };
    const linkAttr = block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? null;
    const title = pick("title");
    if (!title) continue;
    const extra: Record<string, string> = {};
    const traffic = pick("ht:approx_traffic");
    if (traffic) extra.approxTraffic = traffic;
    const views = block.match(/<media:statistics[^>]*views="(\d+)"/i)?.[1];
    if (views) extra.views = views;
    items.push({
      title,
      link: pick("link") || linkAttr,
      pubDate: pick("pubDate") || pick("published") || pick("updated"),
      extra,
    });
  }
  return items;
}

function isExcluded(item: DiscoveredItem, excludedAccounts: string[], excludedTopics: string[]): boolean {
  const handle = (item.authorHandle ?? item.authorName ?? "").toLowerCase();
  if (handle && excludedAccounts.some(a => handle.includes(a))) return true;
  const text = `${item.title ?? ""} ${item.caption ?? ""}`.toLowerCase();
  if (excludedTopics.some(t => t && text.includes(t))) return true;
  return false;
}

// ── Persistence: dedupe + insert ───────────────────────────────────────────────

async function insertItems(
  admin: any,
  workspaceId: string,
  items: DiscoveredItem[],
  excludedAccounts: string[],
  excludedTopics: string[],
): Promise<number> {
  if (items.length === 0) return 0;
  const kept = items.filter(i => !isExcluded(i, excludedAccounts, excludedTopics));
  if (kept.length === 0) return 0;

  const seen = new Set<string>();
  const rows = kept.map(i => {
    const key = i.externalId || i.url || `${i.title ?? ""}:${i.authorHandle ?? ""}`;
    const hash = trendContentHash(i.platform, key);
    if (seen.has(hash)) return null;
    seen.add(hash);
    return {
      workspace_id:  workspaceId,
      source_id:     i.sourceId ?? null,
      platform:      i.platform,
      external_id:   i.externalId ?? null,
      url:           i.url ?? null,
      title:         i.title?.slice(0, 500) ?? null,
      caption:       i.caption?.slice(0, 2000) ?? null,
      media_type:    i.mediaType ?? null,
      author_handle: i.authorHandle ?? null,
      author_name:   i.authorName ?? null,
      published_at:  i.publishedAt ?? null,
      metrics:       i.metrics ?? {},
      content_hash:  hash,
      status:        "discovered",
      raw:           i.raw ?? {},
    };
  }).filter(Boolean) as any[];

  if (rows.length === 0) return 0;

  // Dedupe against existing hashes first (the unique index on
  // (workspace_id, content_hash) is partial, so ON CONFLICT inference can't
  // target it via PostgREST — check-then-insert instead).
  const hashes = rows.map(r => r.content_hash);
  const { data: existing, error: exErr } = await admin
    .from("growthmind_trend_items")
    .select("content_hash")
    .eq("workspace_id", workspaceId)
    .in("content_hash", hashes)
    .limit(hashes.length);
  if (exErr) throw new Error(`Dedupe check failed: ${exErr.message}`);
  const existingSet = new Set((existing ?? []).map((r: any) => r.content_hash));
  const fresh = rows.filter(r => !existingSet.has(r.content_hash));
  if (fresh.length === 0) return 0;

  const { data, error } = await admin
    .from("growthmind_trend_items")
    .insert(fresh)
    .select("id");
  if (!error) return (data ?? []).length;

  // 23505 = a concurrent run inserted one of these hashes between our check
  // and this insert. Postgres rejects the whole batch, so retry row-by-row and
  // skip only the actual duplicates — never drop the other fresh rows.
  if (error.code !== "23505") throw new Error(`Insert trend items failed: ${error.message}`);
  let inserted = 0;
  for (const row of fresh) {
    const { error: rowErr } = await admin.from("growthmind_trend_items").insert(row);
    if (!rowErr) { inserted++; continue; }
    if (rowErr.code === "23505") continue;
    throw new Error(`Insert trend item failed: ${rowErr.message}`);
  }
  return inserted;
}

// ── Fetchers (each independently failable) ─────────────────────────────────────

// 1. Internal WEBEE signals — call outcomes, lead sources, campaign momentum.
async function fetchInternalSignals(admin: any, workspaceId: string): Promise<DiscoveredItem[]> {
  const { detectTrendSignals } = await import("./trend-signals.server");
  const signals = await detectTrendSignals(admin, workspaceId);
  const notable = signals.filter(s => s.classification === "Emerging" || s.classification === "Growing" || s.classification === "Declining");
  const day = new Date().toISOString().slice(0, 10);
  return notable.map(s => ({
    platform:   "internal",
    externalId: `${s.signalType}:${day}`,
    title:      `${s.label}: ${s.classification}`,
    caption:    `${s.insight} ${s.actionHint}`,
    mediaType:  "text",
    publishedAt: s.computedAt,
    metrics: {
      currentValue:  s.currentValue,
      previousValue: s.previousValue,
      changePercent: s.changePercent,
      classification: s.classification,
    },
    raw: { signalType: s.signalType },
  }));
}

// 2. Owned Meta content — recent media + engagement from connected IG/FB accounts.
async function fetchOwnedMeta(admin: any, workspaceId: string): Promise<DiscoveredItem[]> {
  const { data: conns, error } = await admin
    .from("growthmind_social_connections")
    .select("id, account_type, external_account_id, username, access_token_encrypted, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .in("account_type", ["instagram_professional", "facebook_page"]);
  if (error) throw new Error(`Load social connections failed: ${error.message}`);
  if (!conns?.length) return [];

  const items: DiscoveredItem[] = [];
  for (const conn of conns) {
    if (!conn.access_token_encrypted) continue;
    let token: string;
    try { token = decryptMetaToken(conn.access_token_encrypted); } catch { continue; }

    if (conn.account_type === "instagram_professional") {
      const url = `${META_API_BASE}/${conn.external_account_id}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count&limit=25&access_token=${encodeURIComponent(token)}`;
      const res = await fetchWithTimeout(url);
      const json = await res.json() as any;
      if (json.error) throw new Error(`IG media: ${json.error.message}`);
      for (const m of json.data ?? []) {
        items.push({
          platform:     "instagram",
          externalId:   m.id,
          url:          m.permalink ?? null,
          caption:      m.caption ?? null,
          mediaType:    (m.media_product_type === "REELS" ? "reel" : (m.media_type ?? "").toLowerCase()) || null,
          authorHandle: conn.username ?? null,
          publishedAt:  m.timestamp ?? null,
          metrics:      { likes: m.like_count ?? 0, comments: m.comments_count ?? 0, owned: true },
          raw:          { connectionId: conn.id, owned: true },
        });
      }
    } else {
      const url = `${META_API_BASE}/${conn.external_account_id}/posts?fields=id,message,permalink_url,created_time,shares,reactions.summary(true),comments.summary(true)&limit=25&access_token=${encodeURIComponent(token)}`;
      const res = await fetchWithTimeout(url);
      const json = await res.json() as any;
      if (json.error) throw new Error(`FB posts: ${json.error.message}`);
      for (const p of json.data ?? []) {
        items.push({
          platform:     "facebook",
          externalId:   p.id,
          url:          p.permalink_url ?? null,
          caption:      p.message ?? null,
          mediaType:    "text",
          authorHandle: conn.username ?? null,
          publishedAt:  p.created_time ?? null,
          metrics: {
            reactions: p.reactions?.summary?.total_count ?? 0,
            comments:  p.comments?.summary?.total_count ?? 0,
            shares:    p.shares?.count ?? 0,
            owned:     true,
          },
          raw: { connectionId: conn.id, owned: true },
        });
      }
    }
  }
  return items;
}

// 3. Competitor/creator IG accounts via Business Discovery (compliant Graph API,
//    requires an owned IG professional account token).
async function fetchIgBusinessDiscovery(admin: any, workspaceId: string, accountSources: MonitoredRow[]): Promise<DiscoveredItem[]> {
  const igHandles = accountSources.filter(s =>
    (s.platform === "instagram" || s.platform === "any" || !s.platform),
  );
  if (igHandles.length === 0) return [];

  const { data: conn, error } = await admin
    .from("growthmind_social_connections")
    .select("external_account_id, access_token_encrypted")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .eq("account_type", "instagram_professional")
    .not("access_token_encrypted", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Load IG connection failed: ${error.message}`);
  if (!conn) throw new Error("No connected Instagram professional account — connect one under Social Accounts to monitor competitor Instagram content.");

  const token = decryptMetaToken(conn.access_token_encrypted);
  const items: DiscoveredItem[] = [];
  // Highest priority first, cap at 10 lookups per run to stay within rate limits.
  const targets = [...igHandles].sort((a, b) => b.priority - a.priority).slice(0, 10);

  for (const src of targets) {
    const handle = src.value.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "").trim();
    if (!handle) continue;
    const fields = `business_discovery.username(${handle}){username,name,followers_count,media_count,media.limit(12){id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count}}`;
    const url = `${META_API_BASE}/${conn.external_account_id}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
    const res = await fetchWithTimeout(url);
    const json = await res.json() as any;
    if (json.error) {
      // Individual handle failures (private/renamed) shouldn't kill the batch.
      console.warn(`[trend-scout] business_discovery @${handle}: ${json.error.message}`);
      continue;
    }
    const bd = json.business_discovery;
    if (!bd) continue;
    for (const m of bd.media?.data ?? []) {
      items.push({
        platform:     "instagram",
        externalId:   m.id,
        url:          m.permalink ?? null,
        caption:      m.caption ?? null,
        mediaType:    (m.media_product_type === "REELS" ? "reel" : (m.media_type ?? "").toLowerCase()) || null,
        authorHandle: bd.username ?? handle,
        authorName:   bd.name ?? null,
        publishedAt:  m.timestamp ?? null,
        sourceId:     src.id,
        metrics: {
          likes:          m.like_count ?? 0,
          comments:       m.comments_count ?? 0,
          followerCount:  bd.followers_count ?? null,
          engagementRate: bd.followers_count > 0 ? +(((m.like_count ?? 0) + (m.comments_count ?? 0)) / bd.followers_count * 100).toFixed(3) : null,
        },
        raw: { sourceKind: src.source_kind },
      });
    }
  }
  return items;
}

// 4. Meta Ad Library — competitor active ads (public, compliant API).
async function fetchMetaAdLibrary(admin: any, workspaceId: string, accountSources: MonitoredRow[]): Promise<DiscoveredItem[]> {
  const competitors = accountSources.filter(s =>
    s.source_kind === "competitor_direct" || s.source_kind === "competitor_indirect",
  );
  if (competitors.length === 0) return [];

  const { data: conn, error } = await admin
    .from("growthmind_social_connections")
    .select("access_token_encrypted")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .not("access_token_encrypted", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Load connection failed: ${error.message}`);
  if (!conn) throw new Error("No connected Meta account — the Ad Library API needs a Meta access token.");

  const token = decryptMetaToken(conn.access_token_encrypted);
  const items: DiscoveredItem[] = [];
  const targets = [...competitors].sort((a, b) => b.priority - a.priority).slice(0, 5);

  for (const src of targets) {
    const term = (src.label || src.value).replace(/^@/, "").trim();
    if (!term) continue;
    const url = `${META_API_BASE}/ads_archive?search_terms=${encodeURIComponent(term)}&ad_type=ALL&ad_active_status=ACTIVE&ad_reached_countries=${encodeURIComponent('["GB","US"]')}&fields=id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_snapshot_url,publisher_platforms&limit=10&access_token=${encodeURIComponent(token)}`;
    const res = await fetchWithTimeout(url);
    const json = await res.json() as any;
    if (json.error) {
      console.warn(`[trend-scout] ad_library "${term}": ${json.error.message}`);
      continue;
    }
    for (const ad of json.data ?? []) {
      items.push({
        platform:     "meta_ad_library",
        externalId:   ad.id,
        url:          ad.ad_snapshot_url ?? null,
        title:        ad.ad_creative_link_titles?.[0] ?? null,
        caption:      ad.ad_creative_bodies?.[0] ?? null,
        mediaType:    "ad",
        authorName:   ad.page_name ?? term,
        publishedAt:  ad.ad_delivery_start_time ?? null,
        sourceId:     src.id,
        metrics:      { platforms: ad.publisher_platforms ?? [], active: true },
        raw:          { sourceKind: src.source_kind },
      });
    }
  }
  return items;
}

// 5. Google Trends daily trending searches (public RSS).
async function fetchGoogleTrends(topicSources: MonitoredRow[]): Promise<DiscoveredItem[]> {
  const res = await fetchWithTimeout("https://trends.google.com/trending/rss?geo=GB");
  if (!res.ok) throw new Error(`Google Trends RSS HTTP ${res.status}`);
  const xml = await res.text();
  const parsed = parseRssItems(xml, 20);
  const topics = topicSources.map(s => s.value.toLowerCase());
  return parsed.map(p => ({
    platform:    "google_trends",
    externalId:  null,
    url:         p.link,
    title:       p.title,
    mediaType:   "text",
    publishedAt: p.pubDate ? new Date(p.pubDate).toISOString() : null,
    metrics: {
      approxTraffic: p.extra.approxTraffic ?? null,
      matchesWatchedTopic: topics.some(t => p.title.toLowerCase().includes(t)),
    },
  }));
}

// 6. YouTube channel RSS for monitored accounts with a channel id/URL (public, compliant).
async function fetchYouTube(accountSources: MonitoredRow[]): Promise<DiscoveredItem[]> {
  const ytSources = accountSources.filter(s => {
    if (s.platform && s.platform !== "youtube" && s.platform !== "any") return false;
    return /(^UC[\w-]{20,})|youtube\.com/.test(s.value);
  });
  if (ytSources.length === 0) return [];

  const items: DiscoveredItem[] = [];
  for (const src of ytSources.slice(0, 10)) {
    const idMatch = src.value.match(/UC[\w-]{20,}/);
    if (!idMatch) continue; // handle-only URLs need the Data API — skip quietly
    const res = await fetchWithTimeout(`https://www.youtube.com/feeds/videos.xml?channel_id=${idMatch[0]}`);
    if (!res.ok) continue;
    const xml = await res.text();
    const authorName = xml.match(/<author>\s*<name>([^<]+)<\/name>/)?.[1] ?? src.label ?? null;
    for (const p of parseRssItems(xml, 10)) {
      items.push({
        platform:    "youtube",
        externalId:  p.link?.match(/v=([\w-]+)/)?.[1] ?? null,
        url:         p.link,
        title:       p.title,
        mediaType:   "video",
        authorName,
        publishedAt: p.pubDate ? new Date(p.pubDate).toISOString() : null,
        sourceId:    src.id,
        metrics:     { views: p.extra.views ? Number(p.extra.views) : null },
        raw:         { sourceKind: src.source_kind },
      });
    }
  }
  return items;
}

// 7. Reddit top posts for target topics (public JSON API).
async function fetchReddit(topicSources: MonitoredRow[]): Promise<DiscoveredItem[]> {
  const topics = topicSources.filter(s => s.source_kind === "target_topic" || s.source_kind === "keyword").slice(0, 5);
  if (topics.length === 0) return [];
  const items: DiscoveredItem[] = [];
  for (const src of topics) {
    const q = encodeURIComponent(src.value);
    const res = await fetchWithTimeout(
      `https://www.reddit.com/search.json?q=${q}&sort=top&t=week&limit=8`,
      { headers: { "User-Agent": "webee-growthmind/1.0 (trend research)" } },
    );
    if (!res.ok) {
      if (res.status === 429) throw new Error("Reddit rate limited (429)");
      continue;
    }
    const json = await res.json() as any;
    for (const child of json?.data?.children ?? []) {
      const d = child.data;
      if (!d?.id || d.over_18) continue;
      items.push({
        platform:     "reddit",
        externalId:   d.id,
        url:          `https://www.reddit.com${d.permalink}`,
        title:        d.title,
        caption:      (d.selftext || "").slice(0, 1500) || null,
        mediaType:    d.is_video ? "video" : "text",
        authorHandle: d.subreddit_name_prefixed ?? null,
        publishedAt:  d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
        sourceId:     src.id,
        metrics:      { upvotes: d.ups ?? 0, comments: d.num_comments ?? 0, upvoteRatio: d.upvote_ratio ?? null },
        raw:          { sourceKind: src.source_kind, subreddit: d.subreddit },
      });
    }
  }
  return items;
}

// 8. Industry news via Google News RSS per keyword/topic (public, compliant).
async function fetchNews(topicSources: MonitoredRow[]): Promise<DiscoveredItem[]> {
  const topics = topicSources.filter(s => s.source_kind === "target_topic" || s.source_kind === "keyword").slice(0, 5);
  if (topics.length === 0) return [];
  const items: DiscoveredItem[] = [];
  for (const src of topics) {
    const res = await fetchWithTimeout(
      `https://news.google.com/rss/search?q=${encodeURIComponent(src.value)}&hl=en-GB&gl=GB&ceid=GB:en`,
    );
    if (!res.ok) continue;
    const xml = await res.text();
    for (const p of parseRssItems(xml, 8)) {
      items.push({
        platform:    "news",
        externalId:  null,
        url:         p.link,
        title:       p.title,
        mediaType:   "text",
        publishedAt: p.pubDate ? new Date(p.pubDate).toISOString() : null,
        sourceId:    src.id,
        metrics:     {},
        raw:         { sourceKind: src.source_kind },
      });
    }
  }
  return items;
}

// ── Per-workspace discovery run ────────────────────────────────────────────────

const ACCOUNT_KINDS = ["competitor_direct", "competitor_indirect", "industry_creator", "aspirational_brand", "customer_account"];
const TOPIC_KINDS   = ["target_topic", "keyword", "hashtag"];

export async function runTrendDiscoveryForWorkspace(
  workspaceId: string,
  triggeredBy: "scheduler" | "user" = "scheduler",
): Promise<DiscoverySummary> {
  const admin = getTrendAdminClient() as any;
  const summary: DiscoverySummary = { workspaceId, ran: false, runs: [], totalNew: 0 };

  // Settings + daily-limit gate
  const { data: settings, error: setErr } = await admin
    .from("workspace_settings")
    .select("growthmind_discovery_daily_limit, growthmind_trend_scout_enabled")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (setErr) { summary.skipReason = `settings: ${setErr.message}`; return summary; }
  if (settings && settings.growthmind_trend_scout_enabled === false) {
    summary.skipReason = "trend_scout_disabled";
    return summary;
  }
  const dailyLimit = Math.max(1, Math.min(24, settings?.growthmind_discovery_daily_limit ?? 4));

  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { count: runsToday, error: rcErr } = await admin
    .from("growthmind_discovery_runs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("run_kind", "discovery")
    .eq("source", "internal")           // one row per full run marker
    .gte("created_at", dayStart.toISOString());
  if (rcErr) { summary.skipReason = `run-count: ${rcErr.message}`; return summary; }
  // Daily limit applies to BOTH scheduler and manual runs (cost control must
  // not be bypassable). Manual runs get a small extra allowance (+2) so a user
  // can still force a refresh after the scheduler has used the base quota.
  const effectiveLimit = triggeredBy === "user" ? dailyLimit + 2 : dailyLimit;
  if ((runsToday ?? 0) >= effectiveLimit) {
    summary.skipReason = "daily_limit_reached";
    return summary;
  }

  // Load monitored sources + exclusions
  const { data: srcRows, error: srcErr } = await admin
    .from("growthmind_monitored_sources")
    .select("id, source_kind, platform, value, label, priority, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .limit(300);
  if (srcErr) { summary.skipReason = `sources: ${srcErr.message}`; return summary; }
  const sources: MonitoredRow[] = srcRows ?? [];

  const accountSources = sources.filter(s => ACCOUNT_KINDS.includes(s.source_kind));
  const topicSources   = sources.filter(s => TOPIC_KINDS.includes(s.source_kind));
  const excludedAccounts = sources.filter(s => s.source_kind === "excluded_account").map(s => s.value.replace(/^@/, "").toLowerCase());
  const excludedTopics   = sources.filter(s => s.source_kind === "excluded_topic").map(s => s.value.toLowerCase());

  summary.ran = true;

  const fetchers: Array<{ source: DiscoverySource; enabled: boolean; run: () => Promise<DiscoveredItem[]> }> = [
    { source: "internal",              enabled: true,                       run: () => fetchInternalSignals(admin, workspaceId) },
    { source: "owned_meta",            enabled: true,                       run: () => fetchOwnedMeta(admin, workspaceId) },
    { source: "ig_business_discovery", enabled: accountSources.length > 0,  run: () => fetchIgBusinessDiscovery(admin, workspaceId, accountSources) },
    { source: "meta_ad_library",       enabled: accountSources.length > 0,  run: () => fetchMetaAdLibrary(admin, workspaceId, accountSources) },
    { source: "google_trends",         enabled: true,                       run: () => fetchGoogleTrends(topicSources) },
    { source: "youtube",               enabled: accountSources.length > 0,  run: () => fetchYouTube(accountSources) },
    { source: "reddit",                enabled: topicSources.length > 0,    run: () => fetchReddit(topicSources) },
    { source: "news",                  enabled: topicSources.length > 0,    run: () => fetchNews(topicSources) },
  ];

  for (const f of fetchers) {
    const t0 = Date.now();
    let result: SourceRunResult;
    if (!f.enabled) {
      result = { source: f.source, status: "skipped", itemsFound: 0, itemsNew: 0, skipReason: "no_applicable_sources", durationMs: 0 };
    } else {
      try {
        const items = await f.run();
        const inserted = await insertItems(admin, workspaceId, items, excludedAccounts, excludedTopics);
        result = { source: f.source, status: "success", itemsFound: items.length, itemsNew: inserted, durationMs: Date.now() - t0 };
        summary.totalNew += inserted;
      } catch (e: any) {
        result = { source: f.source, status: "error", itemsFound: 0, itemsNew: 0, error: String(e?.message ?? e).slice(0, 500), durationMs: Date.now() - t0 };
      }
    }
    summary.runs.push(result);

    const { error: logErr } = await admin.from("growthmind_discovery_runs").insert({
      workspace_id:  workspaceId,
      run_kind:      "discovery",
      source:        result.source,
      status:        result.status,
      items_found:   result.itemsFound,
      items_new:     result.itemsNew,
      error_message: result.error ?? null,
      skip_reason:   result.skipReason ?? null,
      cost_estimate: 0, // discovery uses no paid AI calls
      duration_ms:   result.durationMs,
      triggered_by:  triggeredBy,
    });
    if (logErr) console.error(`[trend-scout] failed to log run (${result.source}):`, logErr.message);
  }

  // Mark items older than 14 days that are still 'discovered'/'screened' as stale.
  const staleCutoff = new Date(Date.now() - 14 * 86400000).toISOString();
  const { error: staleErr } = await admin
    .from("growthmind_trend_items")
    .update({ status: "stale", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .in("status", ["discovered", "screened"])
    .lt("discovered_at", staleCutoff);
  if (staleErr) console.error("[trend-scout] stale sweep failed:", staleErr.message);

  return summary;
}

// ── Platform tick ──────────────────────────────────────────────────────────────

export async function runTrendDiscoveryTick(): Promise<{ ran: number; skipped: number; totalNew: number }> {
  const admin = getTrendAdminClient() as any;

  // Only workspaces with Trend Scout on AND at least one active monitored source.
  const { data: srcWs, error } = await admin
    .from("growthmind_monitored_sources")
    .select("workspace_id")
    .eq("status", "active")
    .limit(2000);
  if (error) {
    console.error("[trend-scout] tick: source query failed:", error.message);
    return { ran: 0, skipped: 0, totalNew: 0 };
  }
  const wsIds = [...new Set((srcWs ?? []).map((r: any) => r.workspace_id))];

  let ran = 0, skipped = 0, totalNew = 0;
  for (const wid of wsIds) {
    try {
      const s = await runTrendDiscoveryForWorkspace(wid as string, "scheduler");
      if (s.ran) { ran++; totalNew += s.totalNew; } else skipped++;
    } catch (e: any) {
      console.error(`[trend-scout] workspace ${wid} tick error:`, e?.message);
      skipped++;
    }
  }
  if (ran > 0) console.log(`[trend-scout] tick done — ran=${ran} skipped=${skipped} newItems=${totalNew}`);
  return { ran, skipped, totalNew };
}
