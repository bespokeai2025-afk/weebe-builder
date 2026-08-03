/**
 * WATI WhatsApp warm-up — daily send gate per number to avoid Meta blocks.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWatiChannelPhones } from "./wati-webhook.server";
import { getWatiConnectionForWorkspace } from "./wati-campaign.server";
import {
  buildWarmupSchedulePreview,
  channelWarmupStartedAt,
  dailyCapForWarmupDay,
  DEFAULT_WATI_WARMUP_CONFIG,
  parseWatiWarmupConfig,
  resolveActiveWarmupChannels,
  WATI_WARMUP_MAX_DAILY_CAP,
  type WatiWarmupChannelStatus,
  type WatiWarmupConfig,
  type WarmupSendGateResult,
  utcDayStart,
  warmupDayNumber,
} from "./wati-warmup.shared";

export {
  buildWarmupSchedulePreview,
  dailyCapForWarmupDay,
  DEFAULT_WATI_WARMUP_CONFIG,
  parseWatiWarmupConfig,
  resolveActiveWarmupChannels,
  utcDayStart,
  warmupDayNumber,
};
export type { WatiWarmupChannelStatus, WatiWarmupConfig, WarmupSendGateResult };

export async function discoverWatiChannelPhones(workspaceId: string): Promise<string[]> {
  const conn = await getWatiConnectionForWorkspace(supabaseAdmin as any, workspaceId);
  if (!conn) return [];
  return fetchWatiChannelPhones({
    tenantId: conn.tenant_id,
    apiKey: conn.api_key,
    apiHost: conn.api_host,
  });
}

export async function loadWatiWarmupConfig(workspaceId: string): Promise<WatiWarmupConfig> {
  const { data } = await (supabaseAdmin as any)
    .from("wati_connections")
    .select("warmup_config")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .maybeSingle();
  return parseWatiWarmupConfig(data?.warmup_config ?? {});
}

export async function saveWatiWarmupConfig(
  workspaceId: string,
  patch: Partial<WatiWarmupConfig>,
): Promise<WatiWarmupConfig> {
  const current = await loadWatiWarmupConfig(workspaceId);
  const next: WatiWarmupConfig = {
    ...current,
    ...patch,
    startingDaily: patch.startingDaily ?? current.startingDaily,
    dailyIncrement: patch.dailyIncrement ?? current.dailyIncrement,
    targetDaily: patch.targetDaily ?? current.targetDaily,
    channels: { ...current.channels, ...(patch.channels ?? {}) },
  };
  if (patch.channelPhone !== undefined) {
    next.channelPhone = patch.channelPhone
      ? String(patch.channelPhone).replace(/\D/g, "")
      : null;
  }
  if (patch.activeChannels !== undefined) {
    next.activeChannels = [...new Set(patch.activeChannels.map((p) => p.replace(/\D/g, "")))].filter(
      (p) => p.length >= 8,
    );
  }
  await (supabaseAdmin as any)
    .from("wati_connections")
    .update({ warmup_config: next, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId);
  return next;
}

/** Count WATI outbound sends today (UTC), optionally per sender number. */
export async function countWatiOutboundSendsToday(
  workspaceId: string,
  senderChannel?: string | null,
): Promise<number> {
  const since = utcDayStart().toISOString();
  let q = (supabaseAdmin as any)
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("provider", "wati")
    .eq("direction", "outbound")
    .gte("sent_at", since);
  if (senderChannel) {
    q = q.eq("sender_channel", senderChannel);
  }
  const { count, error } = await q;
  if (error) {
    // Migration 20260730183000_wati_sender_channel.sql may not be applied yet
    if (senderChannel && /sender_channel|column/.test(error.message ?? "")) {
      return countWatiOutboundSendsToday(workspaceId);
    }
    console.warn("[wati-warmup] send count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function countWatiFailedSendsToday(workspaceId: string): Promise<number> {
  const since = utcDayStart().toISOString();
  const { count } = await (supabaseAdmin as any)
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("provider", "wati")
    .eq("direction", "outbound")
    .eq("status", "failed")
    .gte("sent_at", since);
  return count ?? 0;
}

export async function buildChannelWarmupStatuses(
  workspaceId: string,
  config: WatiWarmupConfig,
  discovered?: string[],
): Promise<WatiWarmupChannelStatus[]> {
  const phones = resolveActiveWarmupChannels(config, discovered ?? []);
  if (phones.length === 0) {
    const sentToday = await countWatiOutboundSendsToday(workspaceId);
    const day = warmupDayNumber(config.startedAt);
    const dailyCap = dailyCapForWarmupDay(config, day);
    return [
      {
        phone: "default",
        active: true,
        warmupDay: day,
        dailyCap,
        sentToday,
        remaining: Math.max(0, dailyCap - sentToday),
        startedAt: config.startedAt,
      },
    ];
  }

  const rows: WatiWarmupChannelStatus[] = [];
  for (const phone of phones) {
    const startedAt = channelWarmupStartedAt(config, phone);
    const day = warmupDayNumber(startedAt);
    const dailyCap = dailyCapForWarmupDay(config, day);
    const sentToday = await countWatiOutboundSendsToday(workspaceId, phone);
    rows.push({
      phone,
      active: true,
      warmupDay: day,
      dailyCap,
      sentToday,
      remaining: Math.max(0, dailyCap - sentToday),
      startedAt,
    });
  }
  return rows;
}

/** Round-robin allocate N sends across channels respecting each remaining quota. */
export function allocateSendsAcrossChannels(
  total: number,
  channelStatuses: WatiWarmupChannelStatus[],
): Record<string, number> {
  const allocations: Record<string, number> = {};
  if (total <= 0) return allocations;

  const active = channelStatuses.filter((c) => c.phone !== "default" && c.remaining > 0);
  if (active.length === 0) {
    const fallback = channelStatuses[0];
    if (fallback && fallback.remaining > 0) {
      allocations[fallback.phone] = Math.min(total, fallback.remaining);
    }
    return allocations;
  }

  let left = total;
  let idx = 0;
  const caps = active.map((c) => ({ phone: c.phone, room: c.remaining }));
  const used = new Map<string, number>();

  while (left > 0) {
    let placed = false;
    for (let i = 0; i < caps.length; i++) {
      const slot = caps[(idx + i) % caps.length];
      const u = used.get(slot.phone) ?? 0;
      if (u < slot.room) {
        used.set(slot.phone, u + 1);
        left--;
        placed = true;
        idx = (idx + i + 1) % caps.length;
        break;
      }
    }
    if (!placed) break;
  }

  for (const [phone, n] of used) {
    if (n > 0) allocations[phone] = n;
  }
  return allocations;
}

/** Split ordered send items across channels per allocation counts. */
export function splitItemsByChannelAllocations<T>(
  items: T[],
  allocations: Record<string, number>,
): Array<{ channel: string | null; items: T[] }> {
  const order = Object.keys(allocations);
  const batches: Array<{ channel: string | null; items: T[] }> = [];
  let offset = 0;
  for (const phone of order) {
    const n = allocations[phone] ?? 0;
    if (n <= 0) continue;
    batches.push({
      channel: phone === "default" ? null : phone,
      items: items.slice(offset, offset + n),
    });
    offset += n;
  }
  return batches;
}

async function autoStartChannelWarmup(
  workspaceId: string,
  config: WatiWarmupConfig,
  phones: string[],
): Promise<WatiWarmupConfig> {
  const today = utcDayStart().toISOString();
  const channels = { ...config.channels };
  let startedAt = config.startedAt;
  for (const phone of phones) {
    if (!channels[phone]?.startedAt) {
      channels[phone] = { startedAt: today };
    }
  }
  if (!startedAt) startedAt = today;
  return saveWatiWarmupConfig(workspaceId, { startedAt, channels });
}

function buildRecommendations(
  config: WatiWarmupConfig,
  channelCount: number,
  perNumberCap: number,
  totalRemaining: number,
): string[] {
  const tips: string[] = [];
  if (config.enabled && channelCount > 0) {
    tips.push(
      channelCount > 1
        ? `${channelCount} numbers active — combined capacity today: up to ${totalRemaining} sends (${perNumberCap}/number on current warm-up day).`
        : `Single number warm-up: ${perNumberCap}/day on current day; ${totalRemaining} remaining today.`,
    );
    tips.push("Prioritise opted-in contacts likely to reply — reply rate protects each number.");
    tips.push("Spread sends through the day; avoid burst-sending hundreds in one minute.");
  }
  if (channelCount === 1) {
    tips.push("Add a second WhatsApp number in WATI and enable it here to double warm-up capacity.");
  }
  return tips;
}

export async function checkWatiWarmupSendGate(
  workspaceId: string,
  requestedCount: number,
  opts?: { autoStart?: boolean },
): Promise<WarmupSendGateResult> {
  let config = await loadWatiWarmupConfig(workspaceId);
  const discovered = await discoverWatiChannelPhones(workspaceId);
  const blockReasons: string[] = [];
  const warnings: string[] = [];

  if (!config.enabled || config.paused) {
    const sentToday = await countWatiOutboundSendsToday(workspaceId);
    return {
      allowed: requestedCount > 0,
      warmupEnabled: false,
      warmupDay: warmupDayNumber(config.startedAt),
      dailyCap: WATI_WARMUP_MAX_DAILY_CAP,
      sentToday,
      remaining: Math.max(0, WATI_WARMUP_MAX_DAILY_CAP - sentToday),
      requested: requestedCount,
      willSend: requestedCount,
      truncated: false,
      blockReasons: requestedCount <= 0 ? ["No recipients to send"] : [],
      warnings: config.paused
        ? ["Warm-up is paused — daily cap not enforced."]
        : ["Warm-up protection is off — large first-day sends can get numbers blocked."],
      recommendations: buildRecommendations(
        config,
        1,
        WATI_WARMUP_MAX_DAILY_CAP,
        WATI_WARMUP_MAX_DAILY_CAP,
      ),
      channels: [],
      channelAllocations: {},
    };
  }

  let channelStatuses = await buildChannelWarmupStatuses(workspaceId, config, discovered);

  if (opts?.autoStart !== false && requestedCount > 0) {
    const phonesToStart = channelStatuses
      .filter((c) => c.phone !== "default")
      .map((c) => c.phone);
    if (phonesToStart.length > 0 && phonesToStart.some((p) => !channelWarmupStartedAt(config, p))) {
      config = await autoStartChannelWarmup(workspaceId, config, phonesToStart);
      channelStatuses = await buildChannelWarmupStatuses(workspaceId, config, discovered);
    } else if (!config.startedAt) {
      config = await saveWatiWarmupConfig(workspaceId, {
        startedAt: utcDayStart().toISOString(),
      });
      channelStatuses = await buildChannelWarmupStatuses(workspaceId, config, discovered);
    }
  }

  const perNumberCap = channelStatuses[0]?.dailyCap ?? dailyCapForWarmupDay(config, 1);
  const sentToday = channelStatuses.reduce((s, c) => s + c.sentToday, 0);
  const totalRemaining = channelStatuses.reduce((s, c) => s + c.remaining, 0);
  const totalDailyCap = channelStatuses.reduce((s, c) => s + c.dailyCap, 0);
  const warmupDay = channelStatuses[0]?.warmupDay ?? 1;

  if (requestedCount <= 0) {
    blockReasons.push("No leads with phone numbers match this audience");
  } else if (totalRemaining <= 0) {
    blockReasons.push(
      `Daily warm-up limit reached across all numbers (${sentToday}/${totalDailyCap} sent today). Resume tomorrow.`,
    );
  }

  let willSend = Math.min(requestedCount, totalRemaining);
  const truncated = requestedCount > willSend && willSend > 0;
  if (truncated) {
    warnings.push(
      `Audience has ${requestedCount} contacts but only ${totalRemaining} sends left today across ${channelStatuses.length} number(s). Sending ${willSend} now.`,
    );
  } else if (requestedCount > perNumberCap && sentToday === 0 && channelStatuses.length === 1) {
    warnings.push(
      `Warm-up day ${warmupDay}: max ${perNumberCap} per number today.`,
    );
  }

  const channelAllocations =
    willSend > 0 ? allocateSendsAcrossChannels(willSend, channelStatuses) : {};

  const failedToday = await countWatiFailedSendsToday(workspaceId);
  if (failedToday >= 3) {
    warnings.push(`${failedToday} failed sends today — check template quality before scaling.`);
  }

  return {
    allowed: blockReasons.length === 0 && willSend > 0,
    warmupEnabled: true,
    warmupDay,
    dailyCap: totalDailyCap,
    sentToday,
    remaining: totalRemaining,
    requested: requestedCount,
    willSend: blockReasons.length ? 0 : willSend,
    truncated,
    blockReasons,
    warnings,
    recommendations: buildRecommendations(
      config,
      channelStatuses.filter((c) => c.phone !== "default").length || 1,
      perNumberCap,
      totalRemaining,
    ),
    channels: channelStatuses,
    channelAllocations,
  };
}

export async function getWatiWarmupDashboard(workspaceId: string) {
  const config = await loadWatiWarmupConfig(workspaceId);
  const discovered = await discoverWatiChannelPhones(workspaceId);
  const channelStatuses = await buildChannelWarmupStatuses(workspaceId, config, discovered);
  const sentToday = channelStatuses.reduce((s, c) => s + c.sentToday, 0);
  const dailyCap = channelStatuses.reduce((s, c) => s + c.dailyCap, 0);
  const remaining = channelStatuses.reduce((s, c) => s + c.remaining, 0);
  const failedToday = await countWatiFailedSendsToday(workspaceId);
  const schedule = buildWarmupSchedulePreview(config, 14);
  const warmupDay = channelStatuses[0]?.warmupDay ?? 1;

  return {
    config,
    discoveredPhones: discovered,
    channelStatuses,
    warmupDay,
    dailyCap,
    sentToday,
    failedToday,
    remaining,
    schedule,
    atTarget: perNumberAtTarget(config, channelStatuses),
    numberCount: channelStatuses.filter((c) => c.phone !== "default").length || 1,
  };
}

function perNumberAtTarget(_config: WatiWarmupConfig, statuses: WatiWarmupChannelStatus[]): boolean {
  return statuses.every((s) => s.dailyCap >= WATI_WARMUP_MAX_DAILY_CAP);
}
