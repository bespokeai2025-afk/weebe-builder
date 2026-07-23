/**
 * Build payloads for WATI POST /api/v1/whatsApp/templates
 * @see https://docs.wati.io/reference/post_api-v1-whatsapp-templates
 */

const DEFAULT_PARAM_SAMPLES: Record<string, string> = {
  name: "Customer",
  phone: "447000000000",
  date: "Monday 9am",
};

export function normalizeWatiElementName(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function extractTemplateVariablesFromBody(body: string): string[] {
  const matches = body.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, "")))];
}

export function defaultParamSample(paramName: string): string {
  const key = paramName.toLowerCase();
  if (DEFAULT_PARAM_SAMPLES[key]) return DEFAULT_PARAM_SAMPLES[key];
  if (key.includes("name")) return "Customer";
  if (key.includes("phone")) return "447000000000";
  return "Sample";
}

export type WatiCreateTemplateInput = {
  elementName: string;
  body: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language?: string;
  footer?: string | null;
  paramSamples?: Record<string, string>;
};

/** Request body for WATI create template API. */
export function buildWatiCreateTemplatePayload(input: WatiCreateTemplateInput): Record<string, unknown> {
  const elementName = normalizeWatiElementName(input.elementName);
  if (!elementName) throw new Error("Template name is required (use letters, numbers, underscores)");

  const body = String(input.body ?? "").trim();
  if (!body) throw new Error("Message body is required");

  const vars = extractTemplateVariablesFromBody(body);
  const samples = input.paramSamples ?? {};

  return {
    type: "template",
    category: input.category,
    subCategory: "STANDARD",
    buttonsType: "NONE",
    buttons: [],
    elementName,
    language: input.language?.trim() || "en",
    header: {
      type: 0,
      headerTypeString: "none",
      typeString: "none",
    },
    body,
    ...(input.footer?.trim() ? { footer: input.footer.trim() } : {}),
    customParams: vars.map((paramName) => ({
      paramName,
      paramValue: (samples[paramName] ?? defaultParamSample(paramName)).trim() || defaultParamSample(paramName),
    })),
    creationMethod: 0,
  };
}

/** Map WATI create-template response → wati_templates row fields. */
export function watiTemplateRowFromCreateResult(
  workspaceId: string,
  result: Record<string, unknown>,
): Record<string, unknown> {
  const statusObj = (result.status ?? null) as Record<string, unknown> | null;
  const statusCode =
    typeof statusObj?.newStatus === "number"
      ? statusObj.newStatus
      : typeof result.statusCode === "number"
        ? result.statusCode
        : null;

  const statusFromCode =
    statusCode === 1 || statusCode === 5
      ? "PENDING"
      : statusCode === 2
        ? "APPROVED"
        : statusCode === 3
          ? "REJECTED"
          : statusCode === 0
            ? "DRAFT"
            : null;

  const now = new Date().toISOString();
  const customParams = result.customParams;
  const components = {
    customParams: customParams ?? null,
    body: result.body ?? null,
    bodyOriginal: result.bodyOriginal ?? result.body ?? null,
    header: result.header ?? null,
  };

  return {
    workspace_id: workspaceId,
    wati_template_id: String(result.id ?? result.elementName ?? normalizeWatiElementName(String(result.elementName ?? ""))),
    name: String(result.elementName ?? result.name ?? "Untitled"),
    status: statusFromCode ?? (result.status != null && typeof result.status !== "object" ? String(result.status) : "DRAFT"),
    status_code: statusCode,
    language: result.language != null ? String(result.language) : "en",
    category: result.category != null ? String(result.category) : null,
    components,
    body_preview: typeof result.body === "string" ? result.body : null,
    rejection_reason:
      statusObj?.feedback != null && String(statusObj.feedback).trim()
        ? String(statusObj.feedback).slice(0, 500)
        : null,
    quality: result.quality != null ? String(result.quality) : null,
    last_status_at: now,
    wati_modified_at: result.lastModified ? String(result.lastModified) : null,
    synced_at: now,
  };
}
