/**
 * Extract WATI template variable slots for campaign / lead template sends.
 * WATI EU API uses customParams.paramName (e.g. "name"), not Meta-style components.
 */

export function watiTemplateComponentsPayload(t: Record<string, unknown>): Record<string, unknown> | null {
  const customParams = t.customParams;
  const body = t.body;
  const bodyOriginal = t.bodyOriginal;
  const header = t.header;
  const metaComponents = t.components;

  if (
    !customParams &&
    !body &&
    !bodyOriginal &&
    !header &&
    !Array.isArray(metaComponents)
  ) {
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
    return customParams
      .map((p) => String(p.paramName ?? "").trim())
      .filter(Boolean);
  }

  const slots = new Set<string>();

  const metaComps = Array.isArray(template.components)
    ? template.components
    : Array.isArray(comps?.metaComponents)
      ? (comps.metaComponents as unknown[])
      : [];

  for (const c of metaComps) {
    const text =
      (c as { text?: string; body?: string })?.text ??
      (c as { body?: string })?.body ??
      "";
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

export function defaultWatiTemplateParamMapping(slots: string[]): Record<string, string> {
  if (slots.length === 0) return {};
  const mapping: Record<string, string> = {};
  for (const slot of slots) {
    if (slot === "name" || slot === "1") mapping[slot] = "full_name";
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
    if (!m[slot]) {
      return `Map template variable {{${slot}}} to a lead field before sending.`;
    }
  }
  return null;
}
