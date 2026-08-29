/**
 * Extract WATI template variable slots for campaign / lead template sends.
 * WATI EU API uses customParams.paramName (e.g. "name"), not Meta-style components.
 */

/** Lead / CSV fields available when mapping template variables in campaigns. */
export const WATI_TEMPLATE_PARAM_FIELD_OPTIONS: Array<{
  value: string;
  label: string;
  group: "lead" | "property";
}> = [
  { value: "full_name", label: "Owner / Full Name", group: "lead" },
  { value: "phone", label: "Phone (primary)", group: "lead" },
  { value: "email", label: "Email", group: "lead" },
  { value: "company_name", label: "Company", group: "lead" },
  { value: "notes", label: "Notes (all fields text)", group: "lead" },
  { value: "source", label: "Source", group: "lead" },
  { value: "call_summary", label: "Call Summary", group: "lead" },
  { value: "next_action", label: "Next Action", group: "lead" },
  { value: "meta.Building", label: "Building", group: "property" },
  { value: "meta.Master Project", label: "Master Project", group: "property" },
  { value: "meta.Project", label: "Project", group: "property" },
  { value: "meta.Master Location", label: "Location / Area", group: "property" },
  { value: "meta.UnitNumber", label: "Unit Number", group: "property" },
  { value: "meta.property_number", label: "Property Number", group: "property" },
  { value: "meta.Property Type", label: "Property Type", group: "property" },
  { value: "meta.Sub Type", label: "Sub Type", group: "property" },
  { value: "meta.Usage", label: "Usage (Residential/Commercial)", group: "property" },
  { value: "meta.Completion Status", label: "Completion Status", group: "property" },
  { value: "meta.Transaction Amount", label: "Transaction Amount", group: "property" },
  { value: "meta.Size", label: "Size", group: "property" },
  { value: "meta.beds", label: "Bedrooms", group: "property" },
  { value: "meta.Requirement", label: "Requirement (Sell/Rent/Both)", group: "property" },
  { value: "meta.Asking Price", label: "Asking Price", group: "property" },
  { value: "meta.Rental Price", label: "Rental Price", group: "property" },
  { value: "meta.Date", label: "Transaction Date", group: "property" },
  { value: "meta.Mobile 1", label: "Mobile 1", group: "property" },
  { value: "meta.Mobile 2", label: "Mobile 2", group: "property" },
  { value: "meta.Phone 1", label: "Phone 1", group: "property" },
  { value: "meta.Phone 2", label: "Phone 2", group: "property" },
];

function normalizeSlotKey(slot: string): string {
  return slot.toLowerCase().replace(/[\s-]+/g, "_");
}

const SLOT_TO_LEAD_FIELD: Record<string, string> = {
  name: "full_name",
  customer: "full_name",
  owner: "full_name",
  owner_name: "full_name",
  first_name: "full_name",
  client: "full_name",
  building: "meta.Building",
  building_name: "meta.Building",
  buildingname: "meta.Building",
  project: "meta.Master Project",
  master_project: "meta.Master Project",
  masterproject: "meta.Master Project",
  location: "meta.Master Location",
  master_location: "meta.Master Location",
  masterlocation: "meta.Master Location",
  area: "meta.Master Location",
  community: "meta.Master Location",
  unit: "meta.UnitNumber",
  unit_number: "meta.UnitNumber",
  unitnumber: "meta.UnitNumber",
  property: "meta.Property Type",
  property_type: "meta.Property Type",
  propertytype: "meta.Property Type",
  type: "meta.Property Type",
  amount: "meta.Transaction Amount",
  transaction_amount: "meta.Transaction Amount",
  price: "meta.Transaction Amount",
  value: "meta.Transaction Amount",
  size: "meta.Size",
  sqft: "meta.Size",
  beds: "meta.beds",
  bed: "meta.beds",
  bedroom: "meta.beds",
  bedrooms: "meta.beds",
  date: "meta.Date",
  phone: "phone",
  mobile: "phone",
  email: "email",
  completion: "meta.Completion Status",
  usage: "meta.Usage",
  requirement: "meta.Requirement",
  intent: "meta.Requirement",
  asking_price: "meta.Asking Price",
  askingprice: "meta.Asking Price",
  rental_price: "meta.Rental Price",
  rentalprice: "meta.Rental Price",
};

export function watiTemplateComponentsPayload(
  t: Record<string, unknown>,
): Record<string, unknown> | null {
  const customParams = t.customParams;
  const body = t.body;
  const bodyOriginal = t.bodyOriginal;
  const header = t.header;
  const metaComponents = t.components;

  if (!customParams && !body && !bodyOriginal && !header && !Array.isArray(metaComponents)) {
    return null;
  }

  return {
    customParams: customParams ?? null,
    body: body ?? null,
    bodyOriginal: bodyOriginal ?? null,
    header: header ?? null,
    ...(Array.isArray(metaComponents) ? { metaComponents } : {}),
  };
}

/** Ordered param keys as WATI expects them in sendTemplateMessage.parameters[].name */
export function extractWatiTemplateParamSlots(
  template: Record<string, unknown> | null | undefined,
): string[] {
  if (!template) return [];

  const comps = template.components as Record<string, unknown> | null | undefined;
  const customParams = (comps?.customParams ?? template.customParams) as
    | Array<{ paramName?: string }>
    | undefined;

  if (Array.isArray(customParams) && customParams.length > 0) {
    return customParams.map((p) => String(p.paramName ?? "").trim()).filter(Boolean);
  }

  const slots = new Set<string>();

  const metaComps = Array.isArray(template.components)
    ? template.components
    : Array.isArray(comps?.metaComponents)
      ? (comps.metaComponents as unknown[])
      : [];

  for (const c of metaComps) {
    const text =
      (c as { text?: string; body?: string })?.text ?? (c as { body?: string })?.body ?? "";
    for (const m of String(text).match(/\{\{(\d+)\}\}/g) ?? []) {
      slots.add(m.replace(/\{\{|\}\}/g, ""));
    }
  }

  for (const field of [comps?.body, comps?.bodyOriginal, template.body, template.bodyOriginal]) {
    const text = String(field ?? "");
    for (const m of text.match(/\{\{([^}]+)\}\}/g) ?? []) {
      const inner = m.replace(/\{\{|\}\}/g, "").trim();
      if (inner) slots.add(inner);
    }
  }

  return [...slots].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

/** Prefix for template params that use the same text on every send (e.g. agent name). */
export const LITERAL_FIELD_PREFIX = "literal:";

export function encodeLiteralTemplateField(text: string): string {
  return `${LITERAL_FIELD_PREFIX}${text}`;
}

export function isLiteralTemplateField(fieldKey: string | undefined): boolean {
  return !!fieldKey?.startsWith(LITERAL_FIELD_PREFIX);
}

export function literalTemplateFieldText(fieldKey: string): string {
  return fieldKey.startsWith(LITERAL_FIELD_PREFIX)
    ? fieldKey.slice(LITERAL_FIELD_PREFIX.length)
    : "";
}

export function templateFieldMappingIsComplete(fieldKey: string | undefined): boolean {
  if (!fieldKey) return false;
  if (isLiteralTemplateField(fieldKey)) return literalTemplateFieldText(fieldKey).trim().length > 0;
  return true;
}

/** WATI sends using bodyOriginal — not always the same placeholder order as body. */
export function watiTemplateBodyOriginalText(
  template: Record<string, unknown> | null | undefined,
): string | null {
  if (!template) return null;
  const comps = template.components as Record<string, unknown> | null | undefined;
  const orig = comps?.bodyOriginal ?? template.bodyOriginal;
  if (typeof orig === "string" && orig.trim()) return orig.trim();
  const body = comps?.body ?? template.body ?? template.body_preview;
  if (typeof body === "string" && body.trim()) return body.trim();
  return null;
}

export type TemplateSlotRole =
  | "name"
  | "agent"
  | "property_primary"
  | "property_secondary"
  | "unknown";

const SLOT_ROLE_TO_FIELD: Record<Exclude<TemplateSlotRole, "unknown">, string> = {
  name: "full_name",
  agent: LITERAL_FIELD_PREFIX,
  property_primary: "meta.Master Location",
  property_secondary: "meta.Building",
};

/** Infer each {{N}} role from the registered template body (bodyOriginal). */
export function inferTemplateSlotRoles(bodyText: string): Record<string, TemplateSlotRole> {
  const roles: Record<string, TemplateSlotRole> = {};
  const text = bodyText.replace(/\r\n/g, "\n");

  const helloMatch = text.match(/Hello\s+\{\{\s*(\d+)\s*\}\}/i);
  if (helloMatch) roles[helloMatch[1]] = "name";

  const agentMatch = text.match(/This is\s+\{\{\s*(\d+)\s*\}\}\s+from/i);
  if (agentMatch) roles[agentMatch[1]] = "agent";

  const propertyMatch = text.match(/property in\s+\{\{\s*(\d+)\s*\}\}\s*\{\{\s*(\d+)\s*\}\}/i);
  if (propertyMatch) {
    roles[propertyMatch[1]] = "property_primary";
    roles[propertyMatch[2]] = "property_secondary";
  }

  return roles;
}

export function getTemplateSlotHint(
  template: Record<string, unknown> | null | undefined,
  slot: string,
): string | null {
  const bodyText = watiTemplateBodyOriginalText(template);
  if (!bodyText) return null;
  const role = inferTemplateSlotRoles(bodyText)[slot];
  switch (role) {
    case "name":
      return "Owner first name (Hello {{…}})";
    case "agent":
      return "Your agent name (This is {{…}} from Avenue 7)";
    case "property_primary":
      return "Area / location (property in {{…}}…)";
    case "property_secondary":
      return "Building name (…{{…}})";
    default:
      return null;
  }
}

function mappingFromBodyRoles(bodyText: string, slots: string[]): Record<string, string> {
  const roles = inferTemplateSlotRoles(bodyText);
  const mapping: Record<string, string> = {};
  for (const slot of slots) {
    const role = roles[slot];
    if (role && role !== "unknown") {
      mapping[slot] = SLOT_ROLE_TO_FIELD[role];
    }
  }
  return mapping;
}

export function defaultWatiTemplateParamMapping(
  slots: string[],
  template?: Record<string, unknown> | null,
): Record<string, string> {
  if (slots.length === 0) return {};

  const bodyText = watiTemplateBodyOriginalText(template ?? null);
  const mapping = bodyText ? mappingFromBodyRoles(bodyText, slots) : {};

  for (const slot of slots) {
    if (mapping[slot]) continue;
    const key = normalizeSlotKey(slot);
    if (SLOT_TO_LEAD_FIELD[key]) mapping[slot] = SLOT_TO_LEAD_FIELD[key];
  }

  for (const slot of slots) {
    if (mapping[slot]) continue;
    const key = normalizeSlotKey(slot);
    if (key.includes("name") || key.includes("owner")) mapping[slot] = "full_name";
    else if (key.includes("building")) mapping[slot] = "meta.Building";
    else if (key.includes("master") && key.includes("project"))
      mapping[slot] = "meta.Master Project";
    else if (key.includes("project")) mapping[slot] = "meta.Master Project";
    else if (key.includes("location") || key.includes("area") || key.includes("community"))
      mapping[slot] = "meta.Master Location";
    else if (key.includes("unit")) mapping[slot] = "meta.UnitNumber";
    else if (key.includes("property") || key === "type") mapping[slot] = "meta.Property Type";
    else if (key.includes("amount") || key.includes("price") || key.includes("value"))
      mapping[slot] = "meta.Transaction Amount";
    else if (key.includes("bed")) mapping[slot] = "meta.beds";
    else if (key.includes("size") || key.includes("sqft")) mapping[slot] = "meta.Size";
    else if (key.includes("date")) mapping[slot] = "meta.Date";
    else if (key.includes("phone") || key.includes("mobile")) mapping[slot] = "phone";
    else if (key.includes("email")) mapping[slot] = "email";
  }

  if (slots.length === 1 && !mapping[slots[0]]) {
    mapping[slots[0]] = "full_name";
  }

  return mapping;
}

export function validateWatiTemplateParamMapping(
  slots: string[],
  mapping: Record<string, string> | null | undefined,
): string | null {
  if (slots.length === 0) return null;
  const m = mapping ?? {};
  for (const slot of slots) {
    if (!templateFieldMappingIsComplete(m[slot])) {
      if (isLiteralTemplateField(m[slot])) {
        return `Enter fixed text for {{${slot}}} (e.g. your agent name).`;
      }
      return `Map template variable {{${slot}}} to a lead field before sending.`;
    }
  }
  return null;
}

/** Render template body with parameter values for inbox / message log display. */
export function parseTemplateFallbackBody(body: string | null | undefined): {
  templateName: string;
  values: string[];
} | null {
  if (!body?.trim()) return null;
  const m = body.trim().match(/^\[Template:\s*([^\]]+)\]\s*(.*)$/s);
  if (!m) return null;
  const values = m[2]
    .split(/\s·\s/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { templateName: m[1].trim(), values };
}

function hasNumericTemplatePlaceholders(body: string): boolean {
  return /\{\{\s*\d+\s*\}\}/.test(body);
}

/** Map ordered parameter values onto {{1}}, {{2}}, … placeholders (WATI bodyOriginal). */
export function renderWatiTemplateBodyPositional(
  templateBody: string | null | undefined,
  values: string[],
): string | null {
  if (!templateBody?.trim() || values.length === 0) return null;
  if (!hasNumericTemplatePlaceholders(templateBody)) return null;

  const rendered = templateBody
    .replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, key: string) => {
      const idx = parseInt(key, 10) - 1;
      return values[idx] ?? "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return rendered || null;
}

/** Sort WATI numeric slots (1, 2, 10) for legacy shorthand value order. */
export function sortNumericParamSlots(slots: string[]): string[] {
  return [...slots].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

/** Inbox shorthand label — values in numeric slot order for stable rehydrate. */
export function buildTemplateShorthandLabel(
  templateName: string,
  parameters: Array<{ name: string; value: string }>,
): string {
  const byName = Object.fromEntries(parameters.map((p) => [p.name, p.value]));
  const slotNames = sortNumericParamSlots(parameters.map((p) => p.name));
  const values = slotNames.map((name) => byName[name] ?? "").filter(Boolean);
  return `[Template: ${templateName}] ${values.join(" · ")}`.trim();
}

/** Map middle-dot shorthand values onto param slots (customParams order, then numeric legacy). */
export function parametersFromShorthandValues(
  paramSlots: string[],
  values: string[],
): Array<Array<{ name: string; value: string }>> {
  if (paramSlots.length === 0 || values.length === 0) return [];

  const attempts: Array<Array<{ name: string; value: string }>> = [];
  attempts.push(paramSlots.map((name, i) => ({ name, value: values[i] ?? "" })));

  const numericSlots = sortNumericParamSlots(paramSlots);
  if (numericSlots.join("|") !== paramSlots.join("|")) {
    attempts.push(numericSlots.map((name, i) => ({ name, value: values[i] ?? "" })));
  }

  return attempts;
}

function normalizeRenderedTemplateText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function scoreRenderedTemplateMatch(
  bodyText: string,
  parameters: Array<{ name: string; value: string }>,
  rendered: string,
): number {
  const roles = inferTemplateSlotRoles(bodyText);
  let score = 0;

  for (const p of parameters) {
    const value = p.value.trim();
    if (!value) continue;
    if (!rendered.includes(value)) {
      score -= 10;
      continue;
    }

    const role = roles[p.name];
    if (role === "agent") {
      if (
        value.length > 40 ||
        /village|circle|jvc|residence|tower|views|block|apartment|district|marina/i.test(value)
      ) {
        score -= 8;
      } else {
        score += 3;
      }
    } else if (role === "name" && value.length <= 40) {
      score += 2;
    } else if (role === "property_primary" || role === "property_secondary") {
      if (
        /village|circle|jvc|residence|tower|views|block|district|marina|dubai|heights|park/i.test(
          value,
        )
      ) {
        score += 2;
      }
    }
  }

  return score;
}

/** Expand [Template: name] a · b · c shorthand using template body + param slot names. */
export function rehydrateTemplateFallbackBody(
  fallbackBody: string,
  template: Record<string, unknown> | null | undefined,
): string | null {
  const parsed = parseTemplateFallbackBody(fallbackBody);
  if (!parsed) return null;
  const bodyText =
    watiTemplateBodyOriginalText(template ?? null) ??
    (typeof template?.body_preview === "string" ? template.body_preview.trim() : null);
  if (!bodyText) return null;

  const paramSlots = extractWatiTemplateParamSlots(template ?? undefined);
  let best: { rendered: string; score: number } | null = null;

  for (const parameters of parametersFromShorthandValues(paramSlots, parsed.values)) {
    const rendered = renderWatiTemplateBodyPreview(bodyText, parsed.templateName, parameters);
    if (rendered.startsWith("[Template:")) continue;
    const score = scoreRenderedTemplateMatch(bodyText, parameters, rendered);
    if (!best || score > best.score) best = { rendered, score };
  }

  if (best && best.score > -5) return best.rendered;

  const positional = renderWatiTemplateBodyPositional(bodyText, parsed.values);
  if (positional) return positional;

  return null;
}

export function renderWatiTemplateBodyPreview(
  templateBody: string | null | undefined,
  templateName: string,
  parameters: Array<{ name: string; value: string }>,
): string {
  const fallback = buildTemplateShorthandLabel(templateName, parameters);

  if (!templateBody?.trim()) return fallback;

  const byName = Object.fromEntries(parameters.map((p) => [p.name, p.value]));
  const nameRendered = templateBody.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key: string) => {
    return byName[key.trim()] ?? "";
  });
  const nameText = normalizeRenderedTemplateText(nameRendered);
  if (nameText) return nameText;

  const orderedValues = parameters.map((p) => p.value);
  const positional = renderWatiTemplateBodyPositional(templateBody, orderedValues);
  if (positional) return positional;

  return fallback;
}

/** Full rendered template body for inbox storage/display (never shorthand when template text exists). */
export function resolveWatiTemplateMessageBody(
  templateBody: string | null | undefined,
  templateName: string,
  parameters: Array<{ name: string; value: string }>,
): string {
  return renderWatiTemplateBodyPreview(templateBody, templateName, parameters);
}
