/**
 * WBAH externally-hosted Retell agents → WEBEE workspace mapping.
 * Shared by live ingest, post-call pipeline, and admin cutover UI.
 */
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";

export type WbahRetellAgentMapping = {
  workspaceId: string;
  agentName: string;
  role?: "new_leads_dialer" | "qualification" | "tried_to_contact" | "rebooking";
};

/** Production WBAH dialers that share the legacy n8n webhook (pre-migration). */
export const WBAH_RETELL_AGENT_MAP: Record<string, WbahRetellAgentMapping> = {
  agent_0440750bb59597eef7352901bf: {
    workspaceId: WBAH_WORKSPACE_ID,
    agentName: "WBAH Client qualification agent outbound",
    role: "qualification",
  },
  agent_50598858538a69272a4bf04bf8: {
    workspaceId: WBAH_WORKSPACE_ID,
    agentName: "WBAH Client qualification agent",
    role: "qualification",
  },
  agent_ca1d79998c01bb510e60a4dd39: {
    workspaceId: WBAH_WORKSPACE_ID,
    agentName: "WBAH Tried to contact agent",
    role: "tried_to_contact",
  },
  // New Retell workspace (New Leads + Rebooking moved here — add IDs only; TTC/DQ unchanged above)
  agent_53f739ef52b1244f5d86fcd955: {
    workspaceId: WBAH_WORKSPACE_ID,
    agentName: "WBAH New Leads Agent",
    role: "new_leads_dialer",
  },
  agent_b642aebb65a218741169ba7759: {
    workspaceId: WBAH_WORKSPACE_ID,
    agentName: "WBAH Rebooking Agent",
    role: "rebooking",
  },
  agent_a03162ee94d003c298817e727c: {
    workspaceId: WBAH_WORKSPACE_ID,
    agentName: "WBAH New Leads Agent",
    role: "new_leads_dialer",
  },
  agent_698b8e07acac970aefaf0a52b6: {
    workspaceId: WBAH_WORKSPACE_ID,
    agentName: "WBAH New leads",
    role: "new_leads_dialer",
  },
  agent_d6a2d73962c52f673b98f56218: {
    workspaceId: WBAH_WORKSPACE_ID,
    agentName: "WBAH New Leads Agent (SystemMind test)",
    role: "new_leads_dialer",
  },
  agent_1e1b13bd9564da4556370fe0be: {
    workspaceId: WBAH_WORKSPACE_ID,
    agentName: "Rebooking consultation agent",
    role: "rebooking",
  },
  agent_0e07f26bebd25acbd82993e3a3: {
    workspaceId: WBAH_WORKSPACE_ID,
    agentName: "Rebooking agent: WBAH client qualification agent",
    role: "rebooking",
  },
};

/**
 * Extra Retell API key for the new WBAH workspace (New Leads + Rebooking).
 * Leave Settings → Providers on the existing key — TTC/DQ stay on the old account.
 */
export function getWbahAdditionalRetellApiKeys(): string[] {
  const raw =
    process.env.WBAH_RETELL_NEW_WORKSPACE_API_KEY?.trim() ||
    process.env.WBAH_RETELL_ADDITIONAL_API_KEYS?.trim() ||
    // Back-compat alias from earlier cutover draft
    process.env.WBAH_RETELL_LEGACY_API_KEY?.trim() ||
    "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.startsWith("key_"));
}

export function stripRetellAgentPrefix(value: string): string {
  return value.replace(/^agents\//, "").trim();
}

export function resolveWbahRetellAgent(
  agentId: string | null | undefined,
): WbahRetellAgentMapping | null {
  if (!agentId) return null;
  const id = stripRetellAgentPrefix(agentId);
  return WBAH_RETELL_AGENT_MAP[id] ?? null;
}

export function isWbahRetellAgent(agentId: string | null | undefined): boolean {
  return resolveWbahRetellAgent(agentId) != null;
}

export const WBAH_WEBEE_RETELL_WEBHOOK_PATH = "/api/public/voice-webhook";

export function wbahWebeeRetellWebhookUrl(baseUrl?: string): string {
  const origin =
    baseUrl?.replace(/\/$/, "") ||
    process.env.WEBEE_PUBLIC_URL?.replace(/\/$/, "") ||
    process.env.VITE_APP_URL?.replace(/\/$/, "") ||
    "https://webeebuilder.com";
  return `${origin}${WBAH_WEBEE_RETELL_WEBHOOK_PATH}`;
}

/** When true, WBAH post-call writes to WeeBespoke, Dynamics, and Calendly (not just live transcript). */
export function isWbahPostCallExecutionEnabled(): boolean {
  const raw = process.env.WBAH_POST_CALL_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}
