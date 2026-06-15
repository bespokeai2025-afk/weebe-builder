// ── Executive Knowledge — shared, client-safe config ──────────────────────────
// Single source of truth for the executive knowledge bases and the access rules
// that govern which KBs each executive (mind_type) may retrieve from.
//
// NO server imports here — imported by both UI and server code.
//
// Adding a future executive (salesmind, financemind, …) is a CONFIG edit only:
// add a default KB + an access entry. No migration is required because
// `mind_type` / `slug` are open text in the database.

export type ExecutiveKbDef = {
  slug:        string;   // stable key, unique per workspace
  mindType:    string;   // open text; mirrors slug for executive KBs
  name:        string;
  description: string;
  isShared:    boolean;
  scope?:      "workspace" | "platform_default";
};

// The four default knowledge bases auto-created per workspace on first use.
export const DEFAULT_EXECUTIVE_KBS: ExecutiveKbDef[] = [
  {
    slug: "hivemind",
    mindType: "hivemind",
    name: "HiveMind Knowledge",
    description: "Business operations, executive reporting, KPIs, decision-making and scaling playbooks for the COO.",
    isShared: false,
    scope: "workspace",
  },
  {
    slug: "growthmind",
    mindType: "growthmind",
    name: "GrowthMind Knowledge",
    description: "Marketing frameworks, funnels, offers, SEO, paid ads and conversion playbooks for the CMO.",
    isShared: false,
    scope: "workspace",
  },
  {
    slug: "systemmind",
    mindType: "systemmind",
    name: "SystemMind Knowledge",
    description: "Monitoring, observability, security, reliability, infrastructure and cost playbooks for the CTO.",
    isShared: false,
    scope: "workspace",
  },
  {
    slug: "shared",
    mindType: "shared",
    name: "Shared Knowledge",
    description: "Company-wide reference material readable by every executive.",
    isShared: true,
    scope: "workspace",
  },
];

// Platform-default KBs — global, admin-managed, NOT per-workspace.
// These are seeded once in PLATFORM_KNOWLEDGE_MIGRATION.sql.
// workspace_id = NULL in the DB; scope = 'platform_default'.
export const PLATFORM_EXECUTIVE_KBS: ExecutiveKbDef[] = [
  {
    slug: "platform_hivemind",
    mindType: "hivemind",
    name: "WEBEE HiveMind Knowledge",
    description: "Platform-wide business operations, decision-making and COO playbooks provided by WEBEE. Available to all workspaces automatically.",
    isShared: false,
    scope: "platform_default",
  },
  {
    slug: "platform_growthmind",
    mindType: "growthmind",
    name: "WEBEE GrowthMind Knowledge",
    description: "Platform-wide marketing frameworks, funnels, offers and CMO playbooks provided by WEBEE. Available to all workspaces automatically.",
    isShared: false,
    scope: "platform_default",
  },
  {
    slug: "platform_systemmind",
    mindType: "systemmind",
    name: "WEBEE SystemMind Knowledge",
    description: "Platform-wide technical frameworks, monitoring, reliability and CTO playbooks provided by WEBEE. Available to all workspaces automatically.",
    isShared: false,
    scope: "platform_default",
  },
  {
    slug: "platform_shared",
    mindType: "shared",
    name: "WEBEE Shared Knowledge",
    description: "Platform-wide shared knowledge available to all executives. Provided by WEBEE.",
    isShared: true,
    scope: "platform_default",
  },
];

// Access rules: which KB slugs each executive (mind_type) may RETRIEVE from.
// Cross-executive flow (e.g. HiveMind reading GrowthMind output) happens through
// executive SUMMARIES via the bridge — never by direct KB access. GrowthMind and
// SystemMind therefore never read each other's KB.
export const EXECUTIVE_KNOWLEDGE_ACCESS: Record<string, string[]> = {
  hivemind:   ["hivemind", "shared"],
  growthmind: ["growthmind", "shared"],
  systemmind: ["systemmind", "shared"],
  shared:     ["shared"],
};

// Platform KB slugs accessible per mind_type.
// Retrieval order: workspace KBs first → platform KBs second.
export const PLATFORM_KB_ACCESS: Record<string, string[]> = {
  hivemind:   ["platform_hivemind", "platform_shared"],
  growthmind: ["platform_growthmind", "platform_shared"],
  systemmind: ["platform_systemmind", "platform_shared"],
  shared:     ["platform_shared"],
};

// Resolve the readable workspace KB slugs for a mind_type.
export function getReadableKbSlugs(mindType: string): string[] {
  return EXECUTIVE_KNOWLEDGE_ACCESS[mindType] ?? [mindType, "shared"];
}

// Resolve the readable platform KB slugs for a mind_type.
export function getPlatformKbSlugs(mindType: string): string[] {
  return PLATFORM_KB_ACCESS[mindType] ?? [`platform_${mindType}`, "platform_shared"];
}

// Friendly display name for a KB slug (falls back to the slug).
export function kbDisplayName(slug: string): string {
  const all = [...DEFAULT_EXECUTIVE_KBS, ...PLATFORM_EXECUTIVE_KBS];
  return all.find((k) => k.slug === slug)?.name ?? slug;
}

// Embedding model + dimensions — must stay consistent with the cost-engine and
// the `vector(1536)` column in the migration.
export const EXECUTIVE_EMBEDDING_MODEL = "text-embedding-3-small";
export const EXECUTIVE_EMBEDDING_DIMS  = 1536;
