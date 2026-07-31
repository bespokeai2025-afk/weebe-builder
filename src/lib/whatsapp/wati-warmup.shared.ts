/** Shared types + schedule helpers (safe for client import). */

export type WatiWarmupScheduleStep = {
  fromDay: number;
  toDay: number | null;
  cap: number;
};

/** Safe warm-up ramp — per number, per calendar day (UTC). */
export const WATI_WARMUP_SCHEDULE: WatiWarmupScheduleStep[] = [
  { fromDay: 1, toDay: 2, cap: 50 },
  { fromDay: 3, toDay: 4, cap: 100 },
  { fromDay: 5, toDay: 6, cap: 200 },
  { fromDay: 7, toDay: 8, cap: 500 },
  { fromDay: 9, toDay: null, cap: 1000 },
];

export const WATI_WARMUP_MAX_DAILY_CAP = 1000;

export type WatiWarmupChannelState = {
  startedAt: string | null;
};

export type WatiWarmupConfig = {
  enabled: boolean;
  /** Legacy workspace-level start (used when no per-channel state). */
  startedAt: string | null;
  /** @deprecated Linear ramp — caps now follow WATI_WARMUP_SCHEDULE. */
  startingDaily: number;
  /** @deprecated Linear ramp — caps now follow WATI_WARMUP_SCHEDULE. */
  dailyIncrement: number;
  /** Steady-state daily cap after warm-up (day 9+). */
  targetDaily: number;
  /** Primary/default WATI channel digits (legacy). */
  channelPhone: string | null;
  /** Numbers enabled for outbound — each gets its own daily warm-up cap. */
  activeChannels: string[];
  /** Per-number warm-up start dates. */
  channels: Record<string, WatiWarmupChannelState>;
  paused: boolean;
};

export type WatiWarmupChannelStatus = {
  phone: string;
  active: boolean;
  warmupDay: number;
  dailyCap: number;
  sentToday: number;
  remaining: number;
  startedAt: string | null;
};

export const DEFAULT_WATI_WARMUP_CONFIG: WatiWarmupConfig = {
  enabled: true,
  startedAt: null,
  startingDaily: 50,
  dailyIncrement: 50,
  targetDaily: WATI_WARMUP_MAX_DAILY_CAP,
  channelPhone: null,
  activeChannels: [],
  channels: {},
  paused: false,
};

function normChannelPhone(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = raw.replace(/\D/g, "");
  return d.length >= 8 ? d : null;
}

export function parseWatiWarmupConfig(raw: unknown): WatiWarmupConfig {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const channelsRaw = o.channels && typeof o.channels === "object" ? (o.channels as Record<string, unknown>) : {};
  const channels: Record<string, WatiWarmupChannelState> = {};
  for (const [key, val] of Object.entries(channelsRaw)) {
    const phone = normChannelPhone(key);
    if (!phone) continue;
    const row = val && typeof val === "object" ? (val as Record<string, unknown>) : {};
    channels[phone] = {
      startedAt: typeof row.startedAt === "string" ? row.startedAt : null,
    };
  }
  const activeChannels = Array.isArray(o.activeChannels)
    ? [...new Set(o.activeChannels.map(normChannelPhone).filter(Boolean) as string[])]
    : [];

  return {
    enabled: o.enabled !== false,
    startedAt: typeof o.startedAt === "string" ? o.startedAt : null,
    startingDaily: Math.max(1, Number(o.startingDaily) || 50),
    dailyIncrement: Math.max(1, Number(o.dailyIncrement) || 50),
    targetDaily: Math.max(10, Number(o.targetDaily) || WATI_WARMUP_MAX_DAILY_CAP),
    channelPhone: normChannelPhone(o.channelPhone),
    activeChannels,
    channels,
    paused: o.paused === true,
  };
}

/** Resolve which numbers participate in outreach (explicit list or legacy single). */
export function resolveActiveWarmupChannels(
  config: WatiWarmupConfig,
  discovered: string[],
): string[] {
  if (config.activeChannels.length > 0) {
    return config.activeChannels;
  }
  if (config.channelPhone) return [config.channelPhone];
  if (discovered.length > 0) return discovered;
  return [];
}

export function channelWarmupStartedAt(
  config: WatiWarmupConfig,
  phone: string,
): string | null {
  return config.channels[phone]?.startedAt ?? config.startedAt;
}

export function utcDayStart(d = new Date()): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/** Warm-up day 1 = first calendar day (UTC) on or after startedAt. */
export function warmupDayNumber(startedAt: string | null, now = new Date()): number {
  if (!startedAt) return 1;
  const start = utcDayStart(new Date(startedAt));
  const today = utcDayStart(now);
  const diff = Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.max(1, diff);
}

/** Daily outbound cap for a given warm-up day (stepped schedule). */
export function dailyCapForWarmupDay(_config: WatiWarmupConfig, day: number): number {
  const d = Math.max(1, day);
  for (const step of WATI_WARMUP_SCHEDULE) {
    const end = step.toDay ?? Number.POSITIVE_INFINITY;
    if (d >= step.fromDay && d <= end) return step.cap;
  }
  return WATI_WARMUP_MAX_DAILY_CAP;
}

export function formatWarmupScheduleDayRange(step: WatiWarmupScheduleStep): string {
  if (step.toDay == null) return `Day ${step.fromDay}+`;
  if (step.fromDay === step.toDay) return `Day ${step.fromDay}`;
  return `Days ${step.fromDay}–${step.toDay}`;
}

/** Next 14 days of recommended daily caps (for UI table). */
export function buildWarmupSchedulePreview(
  config: WatiWarmupConfig,
  days = 14,
): Array<{ day: number; cap: number }> {
  return Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    return { day, cap: dailyCapForWarmupDay(config, day) };
  });
}

export type WarmupSendGateResult = {
  allowed: boolean;
  warmupEnabled: boolean;
  warmupDay: number;
  dailyCap: number;
  sentToday: number;
  remaining: number;
  requested: number;
  willSend: number;
  truncated: boolean;
  blockReasons: string[];
  warnings: string[];
  recommendations: string[];
  /** Per-number quota breakdown (multi-number). */
  channels: WatiWarmupChannelStatus[];
  /** Round-robin assignment: channel phone → max sends on this launch. */
  channelAllocations: Record<string, number>;
};
