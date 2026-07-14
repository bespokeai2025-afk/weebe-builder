/**
 * Team Access (RBAC) — shared permission model.
 *
 * Safe for client + server import: contains only types, constants and pure
 * merge logic. The resolver/guards live in permissions.server.ts.
 *
 * Model:
 *   • Role keys — built-in roles below, plus free-form workspace-defined keys.
 *   • Page access — ordered levels per page section.
 *   • Action access — boolean grants for high-risk actions.
 *   • assignedRecordsOnly — optional flag restricting list reads to records
 *     assigned to the current user.
 *
 * Workspace overrides (workspace_role_permissions rows) are merged on top of
 * the code defaults. Anything unknown or any resolution error FAILS CLOSED.
 */

export const ROLE_KEYS = [
  "owner",
  "admin",
  "manager",
  "agent_builder",
  "campaign_manager",
  "reports_only",
  "viewer",
  "suspended",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  agent_builder: "Agent Builder",
  campaign_manager: "Campaign Manager",
  reports_only: "Reports Only",
  viewer: "Viewer",
  suspended: "No Access / Suspended",
};

/** Ordered page-access levels (each level implies all lower levels). */
export const PAGE_LEVELS = [
  "hidden",
  "view",
  "edit",
  "create_draft",
  "approve",
  "activate",
  "manage",
] as const;
export type PageLevel = (typeof PAGE_LEVELS)[number];

export function pageLevelRank(level: string): number {
  const i = (PAGE_LEVELS as readonly string[]).indexOf(level);
  return i < 0 ? 0 : i;
}

/** Major app sections that page-level permissions apply to. */
export const PAGE_KEYS = [
  "dashboard",
  "agents",
  "campaigns",
  "leads",
  "calls",
  "data",
  "pipeline",
  "reports",
  "crm",
  "knowledge",
  "workflows",
  "systemmind",
  "growthmind",
  "hivemind",
  "phone_numbers",
  "settings",
  "team_access",
  "billing",
] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

export const PAGE_LABELS: Record<PageKey, string> = {
  dashboard: "Dashboard",
  agents: "Agents & Builder",
  campaigns: "Campaigns",
  leads: "Leads",
  calls: "Calls",
  data: "Data Records",
  pipeline: "Pipeline",
  reports: "Reports & Analytics",
  crm: "CRM & Contacts",
  knowledge: "Knowledge Centre",
  workflows: "Workflow Engine",
  systemmind: "SystemMind",
  growthmind: "GrowthMind",
  hivemind: "HiveMind",
  phone_numbers: "Phone Numbers",
  settings: "Provider & Integration Settings",
  team_access: "Team Access & Notifications",
  billing: "Billing",
};

/** High-risk action grants. */
export const ACTION_KEYS = [
  "go_live",
  "phone_purchase",
  "provider_keys",
  "campaign_activation",
  "systemmind_approval",
  "crm_mappings",
  "user_management",
  "billing",
  "notification_settings",
] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];

export const ACTION_LABELS: Record<ActionKey, string> = {
  go_live: "Go Live / deploy agents",
  phone_purchase: "Purchase / assign phone numbers",
  provider_keys: "Change provider API keys",
  campaign_activation: "Activate campaigns",
  systemmind_approval: "Approve SystemMind changes",
  crm_mappings: "Change CRM mappings",
  user_management: "Invite / remove users & change roles",
  billing: "Manage billing",
  notification_settings: "Change notification settings",
};

export type PageAccessMap = Partial<Record<PageKey, PageLevel>>;
export type ActionAccessMap = Partial<Record<ActionKey, boolean>>;

export interface RolePermissions {
  roleKey: string;
  pageAccess: Record<PageKey, PageLevel>;
  actionAccess: Record<ActionKey, boolean>;
  assignedRecordsOnly: boolean;
}

function allPages(level: PageLevel, overrides?: PageAccessMap): Record<PageKey, PageLevel> {
  const out = {} as Record<PageKey, PageLevel>;
  for (const k of PAGE_KEYS) out[k] = overrides?.[k] ?? level;
  return out;
}

function allActions(value: boolean, overrides?: ActionAccessMap): Record<ActionKey, boolean> {
  const out = {} as Record<ActionKey, boolean>;
  for (const k of ACTION_KEYS) out[k] = overrides?.[k] ?? value;
  return out;
}

/**
 * Code-level defaults for built-in roles.
 *
 * IMPORTANT backwards-compat mapping (existing workspace_members roles):
 *   owner  → "owner", admin → "admin", member → "manager".
 * Manager keeps full page access (what members have today) but no high-risk
 * action grants, so existing workspaces keep working with safe defaults.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, RolePermissions> = {
  owner: {
    roleKey: "owner",
    pageAccess: allPages("manage"),
    actionAccess: allActions(true),
    assignedRecordsOnly: false,
  },
  admin: {
    roleKey: "admin",
    pageAccess: allPages("manage"),
    actionAccess: allActions(true),
    assignedRecordsOnly: false,
  },
  manager: {
    roleKey: "manager",
    pageAccess: allPages("manage", { team_access: "view", billing: "hidden" }),
    actionAccess: allActions(false, { campaign_activation: true, crm_mappings: true }),
    assignedRecordsOnly: false,
  },
  agent_builder: {
    roleKey: "agent_builder",
    pageAccess: allPages("view", {
      agents: "create_draft",
      workflows: "create_draft",
      knowledge: "edit",
      systemmind: "create_draft",
      settings: "hidden",
      team_access: "hidden",
      billing: "hidden",
      phone_numbers: "view",
    }),
    actionAccess: allActions(false),
    assignedRecordsOnly: false,
  },
  campaign_manager: {
    roleKey: "campaign_manager",
    pageAccess: allPages("view", {
      campaigns: "activate",
      leads: "edit",
      calls: "view",
      data: "edit",
      pipeline: "edit",
      reports: "view",
      settings: "hidden",
      team_access: "hidden",
      billing: "hidden",
    }),
    actionAccess: allActions(false, { campaign_activation: true }),
    assignedRecordsOnly: false,
  },
  reports_only: {
    roleKey: "reports_only",
    pageAccess: allPages("hidden", { dashboard: "view", reports: "view", campaigns: "view" }),
    actionAccess: allActions(false),
    assignedRecordsOnly: false,
  },
  viewer: {
    roleKey: "viewer",
    pageAccess: allPages("view", { settings: "hidden", team_access: "hidden", billing: "hidden" }),
    actionAccess: allActions(false),
    assignedRecordsOnly: false,
  },
  suspended: {
    roleKey: "suspended",
    pageAccess: allPages("hidden"),
    actionAccess: allActions(false),
    assignedRecordsOnly: false,
  },
};

/** Fully-locked permission set — the fail-closed fallback. */
export const NO_ACCESS: RolePermissions = DEFAULT_ROLE_PERMISSIONS.suspended;

/** Map an existing workspace_members.role onto a built-in role key. */
export function legacyRoleToRoleKey(role: string | null | undefined): RoleKey {
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (role === "member") return "manager";
  return "suspended"; // unknown → fail closed
}

function sanitizePageAccess(raw: unknown): PageAccessMap {
  const out: PageAccessMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if ((PAGE_KEYS as readonly string[]).includes(k) && typeof v === "string" &&
        (PAGE_LEVELS as readonly string[]).includes(v)) {
      out[k as PageKey] = v as PageLevel;
    }
  }
  return out;
}

function sanitizeActionAccess(raw: unknown): ActionAccessMap {
  const out: ActionAccessMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if ((ACTION_KEYS as readonly string[]).includes(k) && typeof v === "boolean") {
      out[k as ActionKey] = v;
    }
  }
  return out;
}

/**
 * Merge a workspace override row on top of a base default. Unknown keys are
 * dropped; missing keys keep the base value.
 */
export function mergeRolePermissions(
  base: RolePermissions,
  override: {
    page_access?: unknown;
    action_access?: unknown;
    assigned_records_only?: boolean | null;
  } | null | undefined,
): RolePermissions {
  if (!override) return base;
  const page = sanitizePageAccess(override.page_access);
  const action = sanitizeActionAccess(override.action_access);
  return {
    roleKey: base.roleKey,
    pageAccess: { ...base.pageAccess, ...page },
    actionAccess: { ...base.actionAccess, ...action },
    assignedRecordsOnly:
      typeof override.assigned_records_only === "boolean"
        ? override.assigned_records_only
        : base.assignedRecordsOnly,
  };
}

/** Resolve the default for any role key (custom keys start from viewer-like NO base → fail closed to suspended unless overridden). */
export function defaultsForRoleKey(roleKey: string): RolePermissions {
  const builtIn = DEFAULT_ROLE_PERMISSIONS[roleKey as RoleKey];
  if (builtIn) return builtIn;
  // Custom workspace-defined role: starts fully locked; the workspace override
  // row defines what it can do. Fail closed by construction.
  return { ...NO_ACCESS, roleKey };
}

export function hasPageAccess(p: RolePermissions, page: PageKey, level: PageLevel): boolean {
  return pageLevelRank(p.pageAccess[page] ?? "hidden") >= pageLevelRank(level);
}

export function hasAction(p: RolePermissions, action: ActionKey): boolean {
  return p.actionAccess[action] === true;
}
