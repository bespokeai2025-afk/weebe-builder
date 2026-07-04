// ── CRM Adapter Definition types (spec Phase 6) ───────────────────────────────
// DESCRIPTIVE definitions only — this layer never executes a CRM call. It
// declares HOW each supported CRM would authenticate, which objects it exposes,
// how universal business actions map onto its API, plus rate limits, pagination,
// error handling, retry strategy and a test method. It mirrors the provider
// registry isolation pattern: a frozen in-code seed, cloned on read.
//
// This is intentionally separate from src/lib/providers/crm/ (which holds the
// EXECUTABLE HubSpot/GHL/Salesforce/Pipedrive adapters). Nothing here imports or
// calls those.

import type { UniversalActionId } from "../universal-actions";

export type CrmAuthType =
  | "api_key"
  | "personal_token"
  | "oauth2"
  | "oauth2_client_credentials"
  | "webhook_signature"
  | "basic";

export interface CrmAuthField {
  key: string;
  label: string;
  type: "text" | "secret" | "url";
  required: boolean;
  description: string;
}

export interface CrmAuthDefinition {
  type: CrmAuthType;
  label: string;
  fields: CrmAuthField[];
  docsUrl?: string;
  notes?: string;
}

export interface CrmObjectDefinition {
  /** Universal object key: lead | contact | deal | note | activity | appointment | owner */
  key: string;
  /** Vendor object name, e.g. "Contact", "Deal", "Person", "Organization". */
  crmObject: string;
  description?: string;
}

export interface CrmFieldMapping {
  /** Universal field name (e.g. "email"). */
  universal: string;
  /** Vendor field name (e.g. "properties.email"). */
  crmField: string;
  note?: string;
}

export interface CrmStatusMapping {
  universal: string;
  crmValue: string;
}

export interface CrmPipelineMapping {
  universalStage: string;
  crmStage: string;
  note?: string;
}

export interface CrmOwnerMapping {
  strategy: "user_id" | "email" | "round_robin" | "team";
  crmField: string;
  note?: string;
}

export interface CrmActionMapping {
  action: UniversalActionId;
  supported: boolean;
  crmObject?: string;
  /** Descriptive HTTP verb hint — NOT executed. */
  method?: string;
  /** Descriptive endpoint path template — NOT executed. */
  endpoint?: string;
  fieldMappings?: CrmFieldMapping[];
  notes?: string;
}

export interface CrmRateLimit {
  requestsPerSecond?: number;
  requestsPerMinute?: number;
  requestsPerDay?: number;
  burst?: number;
  notes?: string;
}

export interface CrmPagination {
  style: "cursor" | "offset" | "page" | "link_header" | "none";
  pageParam?: string;
  limitParam?: string;
  maxPageSize?: number;
  notes?: string;
}

export interface CrmErrorHandling {
  authErrorCodes: number[];
  rateLimitCodes: number[];
  retryableCodes: number[];
  notes?: string;
}

export interface CrmRetryStrategy {
  maxRetries: number;
  backoff: "exponential" | "linear" | "fixed";
  baseDelayMs: number;
  respectRetryAfter: boolean;
  notes?: string;
}

export interface CrmTestMethod {
  description: string;
  /** Descriptive verb + endpoint used to validate credentials. NOT executed here. */
  method?: string;
  endpoint?: string;
  expectation: string;
}

export interface CrmCapabilities {
  notes: boolean;
  activities: boolean;
  appointments: boolean;
  recordings: boolean;
  transcripts: boolean;
  customFields: boolean;
  webhooks: boolean;
}

export interface CrmAdapterDefinition {
  /** Stable machine name, e.g. "hubspot". */
  name: string;
  label: string;
  vendor: string;
  description: string;
  status: "available" | "beta" | "planned";
  docsUrl?: string;

  auth: CrmAuthDefinition;
  objects: CrmObjectDefinition[];
  fieldMappings: CrmFieldMapping[];
  statusMappings: CrmStatusMapping[];
  pipelineMappings: CrmPipelineMapping[];
  ownerMapping: CrmOwnerMapping;
  capabilities: CrmCapabilities;

  /** One entry per universal action (supported or not). */
  actionMappings: CrmActionMapping[];

  rateLimits: CrmRateLimit;
  pagination: CrmPagination;
  errorHandling: CrmErrorHandling;
  retryStrategy: CrmRetryStrategy;
  testMethod: CrmTestMethod;
}
