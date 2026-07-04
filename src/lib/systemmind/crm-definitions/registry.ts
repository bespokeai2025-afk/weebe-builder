// ── CRM Adapter Definition registry (spec Phase 6) ────────────────────────────
// Frozen in-code seed of DESCRIPTIVE CRM adapter definitions. Mirrors the
// provider registry isolation pattern: the seed is immutable and consumers get
// deep clones on read, so no caller can mutate the shared catalogue. Code-only —
// there is no DB table and nothing here executes a CRM call.

import type { CrmAdapterDefinition } from "./types";
import { hubspotDefinition } from "./hubspot";
import { salesforceDefinition } from "./salesforce";
import { pipedriveDefinition } from "./pipedrive";
import { gohighlevelDefinition } from "./gohighlevel";
import { dynamicsDefinition } from "./dynamics";
import { zohoDefinition } from "./zoho";
import { genericRestDefinition } from "./generic-rest";
import { webhookDefinition } from "./webhook";

const SEED: readonly CrmAdapterDefinition[] = Object.freeze([
  hubspotDefinition,
  salesforceDefinition,
  pipedriveDefinition,
  gohighlevelDefinition,
  dynamicsDefinition,
  zohoDefinition,
  genericRestDefinition,
  webhookDefinition,
]);

function clone<T>(v: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(v)
    : (JSON.parse(JSON.stringify(v)) as T);
}

/** All CRM adapter definitions, deep-cloned so callers cannot mutate the seed. */
export function listCrmAdapterDefinitions(): CrmAdapterDefinition[] {
  return SEED.map((d) => clone(d));
}

/** A single CRM adapter definition by machine name, deep-cloned. */
export function getCrmAdapterDefinition(name: string): CrmAdapterDefinition | undefined {
  const found = SEED.find((d) => d.name === name);
  return found ? clone(found) : undefined;
}

export interface CrmAdapterSummary {
  name: string;
  label: string;
  vendor: string;
  status: CrmAdapterDefinition["status"];
  authType: string;
  supportedActions: number;
  totalActions: number;
}

/** Lightweight summaries for list views (no deep clone of nested mappings). */
export function listCrmAdapterSummaries(): CrmAdapterSummary[] {
  return SEED.map((d) => ({
    name: d.name,
    label: d.label,
    vendor: d.vendor,
    status: d.status,
    authType: d.auth.type,
    supportedActions: d.actionMappings.filter((a) => a.supported).length,
    totalActions: d.actionMappings.length,
  }));
}
