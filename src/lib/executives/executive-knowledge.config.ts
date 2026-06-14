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
};

// The four default knowledge bases auto-created per workspace on first use.
export const DEFAULT_EXECUTIVE_KBS: ExecutiveKbDef[] = [
  {
    slug: "hivemind",
    mindType: "hivemind",
    name: "HiveMind Knowledge",
    description: "Business operations, executive reporting, KPIs, decision-making and scaling playbooks for the COO.",
    isShared: false,
  },
  {
    slug: "growthmind",
    mindType: "growthmind",
    name: "GrowthMind Knowledge",
    description: "Marketing frameworks, funnels, offers, SEO, paid ads and conversion playbooks for the CMO.",
    isShared: false,
  },
  {
    slug: "systemmind",
    mindType: "systemmind",
    name: "SystemMind Knowledge",
    description: "Monitoring, observability, security, reliability, infrastructure and cost playbooks for the CTO.",
    isShared: false,
  },
  {
    slug: "shared",
    mindType: "shared",
    name: "Shared Knowledge",
    description: "Company-wide reference material readable by every executive.",
    isShared: true,
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

// Resolve the readable KB slugs for a mind_type, defaulting to its own KB + shared.
export function getReadableKbSlugs(mindType: string): string[] {
  return EXECUTIVE_KNOWLEDGE_ACCESS[mindType] ?? [mindType, "shared"];
}

// Friendly display name for a KB slug (falls back to the slug).
export function kbDisplayName(slug: string): string {
  return DEFAULT_EXECUTIVE_KBS.find((k) => k.slug === slug)?.name ?? slug;
}

// Embedding model + dimensions — must stay consistent with the cost-engine and
// the `vector(1536)` column in the migration.
export const EXECUTIVE_EMBEDDING_MODEL = "text-embedding-3-small";
export const EXECUTIVE_EMBEDDING_DIMS  = 1536;
