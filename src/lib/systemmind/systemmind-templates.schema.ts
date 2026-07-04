// ── Shared zod schema for importing portable SystemMind templates ─────────────
// Used server-side to validate untrusted imported payloads. Kept in its own
// module (no server-only imports) so it can be dynamically imported safely.

import { z } from "zod";

const strArr = z.array(z.string()).optional();

const deploymentVariableSchema = z.object({
  key: z.string(),
  name: z.string(),
  type: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  example: z.string().optional(),
  required: z.boolean().optional(),
  source: z.string().optional(),
});

export const importedTemplateSchema = z.object({
  __webee_template__: z.union([z.number(), z.string()]).optional(),
  name: z.string().min(1, "name is required").max(300),
  description: z.string().nullish(),
  business_purpose: z.string().nullish(),
  category: z.string().nullish(),
  template_type: z
    .enum(["reusable_template", "customer_specific", "experimental", "legacy", "archive"])
    .optional(),
  confidence: z.number().nullish(),
  readiness: z.string().nullish(),
  risk_rating: z.string().nullish(),
  known_limitations: strArr,
  supported_agent_providers: strArr,
  supported_crm_providers: strArr,
  supported_calendar_providers: strArr,
  supported_telephony_providers: strArr,
  supported_messaging_providers: strArr,
  required_apis: strArr,
  required_credentials: strArr,
  deployment_variables: z.array(deploymentVariableSchema).optional(),
  business_summary: z.string().nullish(),
  technical_summary: z.string().nullish(),
  dependencies: strArr,
  structure: z.any().optional(),
  tags: strArr,
});

export type ImportedTemplate = z.infer<typeof importedTemplateSchema>;
