/**
 * Effective package catalog (server only).
 *
 * package_definitions DB rows OVERRIDE the code-level PACKAGE_CATALOG so
 * Master Admin can edit package rules without a deploy. Merge rules:
 *   • A DB row for a known packageKey overlays the code definition —
 *     scalar limits/prices replace when present (non-null), features_json /
 *     page_access_json / action_access_json / ai_departments_json replace
 *     the whole map when non-empty, notification caps/defaults replace when
 *     non-empty.
 *   • A DB row for an UNKNOWN packageKey is a new admin-created package,
 *     built on the trial (fail-closed) baseline.
 *   • Any lookup error → code catalog only (never wider than code + DB).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  type FeatureKey,
  type NotificationCaps,
  type NotificationEventDefault,
  type PackageDef,
  DEFAULT_PACKAGE_KEY,
  FEATURE_KEYS,
  PACKAGE_CATALOG,
  notificationCapsForPackage,
  notificationDefaultsForPackage,
  packageByKey,
} from "./packages.shared";
import { NOTIFICATION_EVENT_KEYS } from "@/lib/notifications/notification-engine.shared";
import {
  SIGNAL_PACKAGE_CATALOG,
  bumpCacheSignal,
  checkCacheSignal,
} from "./cache-signals.server";

interface DbPackageRow {
  package_key: string;
  package_name: string | null;
  description: string | null;
  monthly_price: number | null;
  annual_price: number | null;
  included_voice_minutes: number | null;
  included_staff_users: number | null;
  max_agents: number | null;
  max_workflows: number | null;
  max_campaigns: number | null;
  max_custom_views: number | null;
  max_page_filters: number | null;
  max_campaign_filters: number | null;
  max_child_accounts: number | null;
  features_json: unknown;
  page_access_json: unknown;
  action_access_json: unknown;
  ai_departments_json: unknown;
  notification_caps_json: unknown;
  notification_defaults_json: unknown;
  is_active: boolean | null;
}

export interface EffectivePackage extends PackageDef {
  /** true when a package_definitions row overrides the code catalog. */
  dbOverride: boolean;
  notificationCaps: NotificationCaps;
  notificationDefaults: Record<string, NotificationEventDefault>;
}

const CACHE_TTL_MS = 30_000;
let cache: { at: number; signal: number | null; value: Map<string, EffectivePackage> } | null = null;

/**
 * Drop the in-process cache. When `broadcast` (default) also bumps the shared
 * DB signal so OTHER instances drop theirs promptly. Pass
 * `{ broadcast: false }` for read-path freshness (no admin write happened).
 */
export function invalidatePackageCatalogCache(opts?: { broadcast?: boolean }) {
  cache = null;
  if (opts?.broadcast !== false) void bumpCacheSignal(SIGNAL_PACKAGE_CATALOG);
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function sanitizeFeatures(raw: unknown): FeatureKey[] | null {
  const obj = asObject(raw);
  const keys = Object.entries(obj)
    .filter(([k, v]) => (FEATURE_KEYS as readonly string[]).includes(k) && v === true)
    .map(([k]) => k as FeatureKey);
  return Object.keys(obj).length > 0 ? keys : null;
}

function sanitizeNotificationCaps(raw: unknown): NotificationCaps | null {
  const obj = asObject(raw);
  if (typeof obj.emailAllowed !== "boolean" && typeof obj.customRecipientsAllowed !== "boolean") return null;
  // Fail closed on missing halves.
  return {
    emailAllowed: obj.emailAllowed === true,
    customRecipientsAllowed: obj.customRecipientsAllowed === true,
  };
}

const FREQUENCIES = ["immediate", "hourly", "daily", "weekly"] as const;

function sanitizeNotificationDefaults(raw: unknown): Record<string, NotificationEventDefault> | null {
  const obj = asObject(raw);
  const out: Record<string, NotificationEventDefault> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!(NOTIFICATION_EVENT_KEYS as readonly string[]).includes(k)) continue;
    const d = asObject(v);
    out[k] = {
      enabled: d.enabled !== false,
      inAppEnabled: d.inAppEnabled !== false,
      emailEnabled: d.emailEnabled === true,
      frequency: FREQUENCIES.includes(d.frequency as any) ? (d.frequency as any) : "immediate",
    };
  }
  return Object.keys(obj).length > 0 ? out : null;
}

function baseEffective(pkg: PackageDef): EffectivePackage {
  return {
    ...pkg,
    limits: { ...pkg.limits },
    features: [...pkg.features],
    aiDepartments: [...pkg.aiDepartments],
    dbOverride: false,
    notificationCaps: notificationCapsForPackage(pkg.packageKey),
    notificationDefaults: notificationDefaultsForPackage(pkg.packageKey),
  };
}

/**
 * Nullable-limit overlay. DB semantics:
 *   NULL  → not overridden (keep code default)
 *   -1    → explicitly UNLIMITED (admin cleared the cap)
 *   n>=0  → cap of n
 */
function overlayLimit(dbVal: number | null, baseVal: number | null): number | null {
  if (dbVal === null || dbVal === undefined) return baseVal;
  return dbVal === -1 ? null : dbVal;
}

function overlayRow(base: EffectivePackage, row: DbPackageRow): EffectivePackage {
  const out: EffectivePackage = {
    ...base,
    dbOverride: true,
    packageName: row.package_name ?? base.packageName,
    description: row.description ?? base.description,
    monthlyPricePence: row.monthly_price ?? base.monthlyPricePence,
    annualPricePence: row.annual_price ?? base.annualPricePence,
    isActive: row.is_active ?? base.isActive,
    limits: {
      includedVoiceMinutes: Math.max(0, row.included_voice_minutes ?? base.limits.includedVoiceMinutes),
      includedStaffUsers: Math.max(0, row.included_staff_users ?? base.limits.includedStaffUsers),
      maxAgents: overlayLimit(row.max_agents, base.limits.maxAgents),
      maxWorkflows: overlayLimit(row.max_workflows, base.limits.maxWorkflows),
      maxCampaigns: overlayLimit(row.max_campaigns, base.limits.maxCampaigns),
      maxCustomViews: overlayLimit(row.max_custom_views, base.limits.maxCustomViews),
      maxPageFilters: overlayLimit(row.max_page_filters, base.limits.maxPageFilters),
      maxCampaignFilters: overlayLimit(row.max_campaign_filters, base.limits.maxCampaignFilters),
      maxChildAccounts: overlayLimit(row.max_child_accounts, base.limits.maxChildAccounts),
    },
  };
  const feats = sanitizeFeatures(row.features_json);
  if (feats) out.features = feats;
  const pageCaps = asObject(row.page_access_json);
  if (Object.keys(pageCaps).length > 0) out.pageAccessCaps = pageCaps as any;
  const actionCaps = asObject(row.action_access_json);
  if (Object.keys(actionCaps).length > 0) out.actionCaps = actionCaps as any;
  if (Array.isArray(row.ai_departments_json)) {
    const depts = (row.ai_departments_json as unknown[]).filter((d) =>
      ["growthmind", "hivemind", "systemmind", "accountsmind"].includes(String(d)),
    ) as EffectivePackage["aiDepartments"];
    if ((row.ai_departments_json as unknown[]).length > 0 || depts.length > 0) out.aiDepartments = depts;
  }
  const caps = sanitizeNotificationCaps(row.notification_caps_json);
  if (caps) out.notificationCaps = caps;
  const defaults = sanitizeNotificationDefaults(row.notification_defaults_json);
  if (defaults) out.notificationDefaults = defaults;
  return out;
}

/** Effective catalog map (code catalog + DB overlays). Cached ~30s. */
export async function getEffectivePackageCatalog(): Promise<Map<string, EffectivePackage>> {
  const signal = await checkCacheSignal(SIGNAL_PACKAGE_CATALOG);
  if (cache && Date.now() - cache.at < CACHE_TTL_MS && cache.signal === signal) {
    return cache.value;
  }
  const map = new Map<string, EffectivePackage>();
  for (const pkg of PACKAGE_CATALOG) map.set(pkg.packageKey, baseEffective(pkg));
  try {
    const { data, error } = await (supabaseAdmin as any)
      .from("package_definitions")
      .select("*");
    if (!error) {
      for (const row of (data ?? []) as DbPackageRow[]) {
        const base = map.get(row.package_key) ?? baseEffective(packageByKey(DEFAULT_PACKAGE_KEY));
        map.set(row.package_key, overlayRow({ ...base, packageKey: row.package_key }, row));
      }
      cache = { at: Date.now(), signal, value: map };
    }
  } catch {
    // DB unavailable → code catalog only (no cache so we retry next call).
  }
  return map;
}

/** Effective package def for a key; unknown keys fail closed to trial. */
export async function packageByKeyServer(key: string | null | undefined): Promise<EffectivePackage> {
  const catalog = await getEffectivePackageCatalog();
  return catalog.get(key ?? "") ?? catalog.get(DEFAULT_PACKAGE_KEY) ?? baseEffective(packageByKey(DEFAULT_PACKAGE_KEY));
}

/** Notification caps honouring DB overrides; unknown keys fail closed. */
export async function notificationCapsForPackageServer(
  packageKey: string | null | undefined,
): Promise<NotificationCaps> {
  const catalog = await getEffectivePackageCatalog();
  const pkg = packageKey ? catalog.get(packageKey) : undefined;
  return pkg ? pkg.notificationCaps : notificationCapsForPackage(packageKey);
}

/** Notification defaults honouring DB overrides. */
export async function notificationDefaultsForPackageServer(
  packageKey: string | null | undefined,
): Promise<Record<string, NotificationEventDefault>> {
  const catalog = await getEffectivePackageCatalog();
  const pkg = packageKey ? catalog.get(packageKey) : undefined;
  return pkg ? pkg.notificationDefaults : notificationDefaultsForPackage(packageKey);
}
