/**
 * Default JavaScript shown on Code nodes (n8n-style) — editable by user.
 */
import { getNodeImplementation } from "./wbah-n8n-node-implementations.shared";

const SNIPPETS_BY_NODE: Record<string, string> = {
  "format-data": `// n8n node #9 — Format Data (production parity)
// WEBEE runs formatWbahRetellCallData() — this is the n8n Code node equivalent.
const items = $input.all();

function pickStr(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

function parseJsonField(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}

function normalizeUkTime24(t) {
  const s = String(t ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*(am|pm)?$/i);
  if (!m) return s;
  let hh = Number(m[1]);
  const mm = m[2];
  const ap = (m[4] || "").toLowerCase();
  if (ap === "pm" && hh < 12) hh += 12;
  if (ap === "am" && hh === 12) hh = 0;
  return \`\${String(hh).padStart(2, "0")}:\${mm}:00\`;
}

function ukLocalToUtcIso(date, timeUk) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss = 0] = timeUk.split(":").map(Number);
  const tmpUTC = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "shortOffset",
  }).formatToParts(tmpUTC);
  const offPart = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
  const off = offPart.match(/GMT([+-]\\d+)?/);
  const offHrs = off && off[1] ? Number(off[1]) : 0;
  return new Date(Date.UTC(y, m - 1, d, hh - offHrs, mm, ss)).toISOString();
}

function addMinutesIso(iso, mins) {
  return new Date(new Date(iso).getTime() + mins * 60_000).toISOString();
}

function normalizeCallbackDatetimeUtc(raw) {
  const cb = String(raw ?? "").trim();
  if (!cb || cb === "NA") return null;
  try {
    if (/Z|[+-]\\d{2}:?\\d{2}$/.test(cb)) return new Date(cb).toISOString();
    const [datePart, timePart = "00:00:00"] = cb.split("T");
    const [y, m, day] = datePart.split("-").map(Number);
    const [hh, mm, ss = 0] = timePart.split(":").map(Number);
    const tmpUTC = new Date(Date.UTC(y, m - 1, day, hh, mm, ss));
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      timeZoneName: "shortOffset",
    }).formatToParts(tmpUTC);
    const offPart = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
    const off = offPart.match(/GMT([+-]\\d+)?/);
    const offHrs = off && off[1] ? Number(off[1]) : 0;
    return new Date(Date.UTC(y, m - 1, day, hh - offHrs, mm, ss)).toISOString();
  } catch {
    return cb.endsWith("Z") ? cb : \`\${cb}Z\`;
  }
}

return items.map(({ json }) => {
  const body = json.body ?? json;
  const call = body.call ?? {};
  const dyn = call.retell_llm_dynamic_variables ?? {};
  const custom = call.call_analysis?.custom_analysis_data ?? {};
  const analysis = call.call_analysis ?? {};

  const calendlySlot = parseJsonField(custom.calendly_slot);
  const availableSlots = parseJsonField(dyn.available_slots ?? custom.available_slots);

  let slot = null;
  if (calendlySlot?.preferred_slot?.date && calendlySlot?.preferred_slot?.time) {
    slot = { date: calendlySlot.preferred_slot.date, time: calendlySlot.preferred_slot.time };
  } else if (calendlySlot?.date && calendlySlot?.time) {
    slot = { date: calendlySlot.date, time: calendlySlot.time };
  } else {
    const fb = availableSlots?.preferred_slot?.[0];
    if (fb?.date && fb?.time) slot = { date: fb.date, time: fb.time };
  }

  const timeUk = slot?.time ? normalizeUkTime24(slot.time) : null;
  const requestedStartUtc = slot?.date && timeUk ? ukLocalToUtcIso(slot.date, timeUk) : null;
  const requestedEndUtc = requestedStartUtc ? addMinutesIso(requestedStartUtc, 30) : null;

  const structured = parseJsonField(custom.structured_json_output);
  const verified =
    structured && typeof structured.verified_details === "object"
      ? structured.verified_details
      : structured;

  const callbackRaw = pickStr(custom, "callback_datetime", "callback_date_time");
  const callbackUtc = normalizeCallbackDatetimeUtc(callbackRaw);
  const hasCallback = Boolean(callbackRaw && callbackRaw !== "NA");

  const callSuccessfulRaw = analysis.call_successful ?? custom.call_successful;
  const callSuccessful =
    callSuccessfulRaw === true || callSuccessfulRaw === false
      ? callSuccessfulRaw
      : callSuccessfulRaw != null
        ? String(callSuccessfulRaw).toLowerCase() === "true"
        : null;

  const customerName =
    pickStr(custom, "customer_name", "full_name") ||
    pickStr(dyn, "full_name", "Full_name", "name") ||
    [pickStr(dyn, "First_name", "first_name"), pickStr(dyn, "Last_name", "last_name")]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    null;

  return {
    json: {
      leadId: pickStr(dyn, "lead_id", "leadId", "Lead_id"),
      customerName,
      email: pickStr(custom, "email_address", "email") || pickStr(dyn, "email", "Email"),
      userSentiment: pickStr(custom, "user_sentiment") || pickStr(analysis, "user_sentiment"),
      callSummary: pickStr(custom, "call_summary") || pickStr(analysis, "call_summary"),
      callSuccessful,
      callbackDatetime: callbackRaw,
      callbackDatetimeUtc: callbackUtc,
      callbackType: pickStr(custom, "callback_type"),
      isCallbackRequest: hasCallback,
      appointmentDate: slot?.date ?? null,
      appointmentTimeUk: timeUk,
      requestedStartUtc,
      requestedEndUtc,
      updatedCalendlySlot: slot
        ? { preferred_slot: { date: slot.date, time: timeUk ?? slot.time } }
        : calendlySlot,
      structuredJsonOutput: verified,
      verifiedDetails: verified,
      hasBookingSlot: Boolean(requestedStartUtc),
      appointmentConfirmed:
        custom.appointment_confirmed === true ||
        custom.appointment_confirmed === "true" ||
        Boolean(slot?.date && timeUk),
    },
  };
});`,
  "build-slot-url": `// n8n node #11 — Build Slot URL (production parity)
const baseUrl = $('Create Booking Link').item?.json?.resource?.booking_url
  ?? $('Create Booking Link').first?.()?.json?.resource?.booking_url
  ?? $json.resource?.booking_url
  ?? $json.booking_url
  ?? "";
const formatData = $('Format Data').item?.json ?? $('Format Data').first?.()?.json ?? $json;
const requestedStartRaw = formatData.requested_start ?? formatData.requestedStartUtc ?? "";

const sanitize = (v) => {
  if (!v || typeof v !== "string") return "";
  const lower = v.trim().toLowerCase();
  return ["na", "nan", "null", "undefined", "n/a", ""].includes(lower) ? "" : v.trim();
};

const requestedStart = sanitize(requestedStartRaw);
if (!baseUrl || !requestedStart) {
  return [{ json: {
    booking_url: "",
    appointment_time: "",
    appointment_date: "",
    appointment_time_uk: formatData.appointment_time_uk ?? formatData.appointmentTimeUk ?? "",
    error: !baseUrl ? "Missing Create Booking Link booking_url" : "Missing Format Data requested_start",
  }}];
}

const parsedDate = new Date(requestedStart);
if (isNaN(parsedDate.getTime())) {
  return [{ json: {
    booking_url: "",
    appointment_time: "",
    appointment_date: "",
    appointment_time_uk: formatData.appointment_time_uk ?? "",
    error: \`Invalid requested_start: \${requestedStart}\`,
  }}];
}

const slotDateTime = parsedDate.toISOString();
const slotDate = formatData.appointment_date ?? formatData.appointmentDate ?? slotDateTime.split("T")[0];
const slotMonth = slotDate.slice(0, 7);
const finalUrl = \`\${baseUrl.replace(/\\/$/, "")}/\${encodeURIComponent(slotDateTime)}?month=\${slotMonth}&date=\${slotDate}\`;

return [{ json: {
  booking_url: finalUrl,
  appointment_time: slotDateTime,
  appointment_date: slotDate,
  appointment_time_uk: formatData.appointment_time_uk ?? formatData.appointmentTimeUk ?? "",
}}];`,
  "merge-token": `// Merge OAuth token into lead payload
const token = $json.access_token ?? $('GET D365 Token').first().json.access_token;
return [{ json: { ...$json, accessToken: token } }];`,
  "webhook-extract": `// n8n node #22 — WebhookDataExtractAndPreProcess
const items = $input.all();
return items.map(({ json }) => {
  const body = json.body ?? json;
  const call = body.call ?? {};
  const dyn = call.retell_llm_dynamic_variables ?? {};
  const analysis = call.call_analysis ?? {};
  const custom = analysis.custom_analysis_data ?? {};
  const structured = typeof custom.structured_json_output === 'string'
    ? JSON.parse(custom.structured_json_output)
    : (custom.structured_json_output ?? {});
  const verified = structured?.verified_details ?? structured ?? {};
  return {
    json: {
      lead_id: dyn.lead_id ?? dyn.leadId ?? null,
      accessToken: json.accessToken ?? json.access_token ?? null,
      user_sentiment: custom.user_sentiment ?? analysis.user_sentiment ?? null,
      call_summary: custom.call_summary ?? analysis.call_summary ?? null,
      email: custom.email_address ?? custom.email ?? dyn.email ?? null,
      name: custom.customer_name ?? dyn.full_name ?? dyn.name ?? null,
      verified_details: verified,
      structured_json_output: structured,
      dynamic_variable: dyn,
      body,
    },
  };
});`,
  "forward-if-block": `// n8n node #24 — ForwardDataFromIfBlock
return $input.all();`,
  "apply-allens-logic": `// n8n node #14 — Apply Allens Logic V5
const items = $input.all();
return items.map(({ json }) => {
  const sentiment = json.user_sentiment ?? json.cos_user_sentiment ?? null;
  const bookingUrl = json.calendly_booking_url ?? json.booking_url ?? $('Build Slot URL').item?.json?.booking_url ?? '';
  const callbackDatetime = json.callback_datetime ?? json.callbackDatetime ?? null;
  const callbackUtc = json.callback_datetime_utc ?? json.callbackDatetimeUtc ?? null;
  const currentStatus = json.new_currentstatus ?? json.existingCurrentStatus ?? null;
  const existingState = json.statecode ?? json.existingStateCode ?? null;
  const hasCallback = Boolean(callbackUtc || (callbackDatetime && callbackDatetime !== 'NA'));
  let newCurrentStatus = null;
  let statecodeOverride = null;
  let skipStatusUpdate = true;
  let skipStatecodeUpdate = true;
  let skipAppointmentUpdate = true;
  let rule = 'none';
  if (hasCallback) {
    newCurrentStatus = 181510002;
    statecodeOverride = 0;
    skipStatusUpdate = false;
    skipStatecodeUpdate = false;
    rule = 'callback';
  } else if (String(sentiment ?? '').toLowerCase() === 'negative') {
    newCurrentStatus = 279640000;
    skipStatusUpdate = false;
    rule = 'negative';
  } else if (String(bookingUrl ?? '').trim() && bookingUrl !== 'NA') {
    newCurrentStatus = 100000008;
    skipStatusUpdate = false;
    skipAppointmentUpdate = false;
    rule = 'logged';
  } else {
    newCurrentStatus = 100000001;
    skipStatusUpdate = false;
    rule = 'tried_to_contact';
  }
  return {
    json: {
      ...json,
      newCurrentStatus,
      statecodeOverride,
      skipStatusUpdate,
      skipStatecodeUpdate,
      skipAppointmentUpdate,
      isCallbackRequest: hasCallback,
      calendlyBookingUrl: bookingUrl,
      allenLogicResult: rule,
    },
  };
});`,
  "build-crm-payload": `// n8n node #15 — Build CRM Payload
const items = $input.all();
return items.map(({ json }) => {
  const payload = {};
  if (!json.skipStatusUpdate && json.newCurrentStatus != null) {
    payload.new_currentstatus = json.newCurrentStatus;
  }
  if (!json.skipStatecodeUpdate && json.statecodeOverride != null) {
    payload.statecode = json.statecodeOverride;
  }
  if (!json.skipAppointmentUpdate && json.calendlyBookingUrl) {
    payload.new_calendlybookingurl = json.calendlyBookingUrl;
  }
  if (json.isCallbackRequest && json.callbackDatetimeUtc) {
    payload.new_callbackdatetime = json.callbackDatetimeUtc;
  }
  const vd = json.verified_details ?? json.structured_json_output ?? {};
  for (const [k, v] of Object.entries(vd)) {
    if (v != null && v !== '') payload[k] = v;
  }
  if (json.user_sentiment) payload.cos_user_sentiment = json.user_sentiment;
  if (json.call_summary) payload.cos_call_summary = json.call_summary;
  return { json: { ...json, crmPayload: payload } };
});`,
  "get-structured-json": `const items = $input.all();
return items.map(({ json }) => {
  const raw = json.body?.call?.call_analysis?.custom_analysis_data?.structured_json_output;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return { json: { ...json, structured_json_output: parsed ?? {} } };
});`,
  "get-all-valid-fields": `// n8n getAllValidFields — filter non-empty Dynamics fields
const items = $input.all();
return items.map(({ json }) => {
  const src = json.structured_json_output?.verified_details ?? json.structured_json_output ?? json;
  const fields = {};
  for (const [k, v] of Object.entries(src)) {
    if (v != null && String(v).trim() !== '') fields[k] = v;
  }
  return { json: { ...json, fields } };
});`,
  "get-all-valid-fields-1": `// n8n getALLValidFields1 — alias map + allowed Dynamics keys
const items = $input.all();
const allowed = new Set([
  'new_propinfo_numberofbedrooms','cos_propertyempty','cos_propertyrented','cos_tenure',
  'new_propinfo_howquickly','firstname','lastname','emailaddress1','mobilephone','cos_call_summary',
  'new_propinfo_typeofproperty','address1_line1','address1_postalcode'
]);
return items.map(({ json }) => {
  const src = json.fields ?? json.structured_json_output ?? {};
  const agenticFields = {};
  for (const [k, v] of Object.entries(src)) {
    if (!allowed.has(k)) continue;
    if (v != null && String(v).trim() !== '') agenticFields[k] = v;
  }
  return { json: { ...json, agenticFields } };
});`,
  "clear-data-agentic": `// n8n node #34 — clearDataforAgentic (statecode, status, sentiment, summary)
const items = $input.all();
return items.map(({ json }) => {
  const patch = {};
  if (json.statecode != null) patch.statecode = json.statecode;
  if (json.new_currentstatus != null) patch.new_currentstatus = json.new_currentstatus;
  if (json.user_sentiment) patch.cos_user_sentiment = json.user_sentiment;
  if (json.call_summary) patch.cos_call_summary = json.call_summary;
  return { json: { ...json, agenticFields: patch } };
});`,
  "wbah-calls-upsert": `// Upsert WEBEE Calls tab row for reporting
await upsertWbahCallRow($json.body?.call ?? $json);
return $input.all();`,
};

const SNIPPETS_BY_FN: Record<string, string> = {
  formatWbahRetellCallData: SNIPPETS_BY_NODE["format-data"]!,
  buildWbahCalendlySlotUrl: SNIPPETS_BY_NODE["build-slot-url"]!,
  applyAllensLogicV5: SNIPPETS_BY_NODE["apply-allens-logic"]!,
  buildWbahAllensCrmPayload: SNIPPETS_BY_NODE["build-crm-payload"]!,
  normalizeWbahAgenticCrmFields: SNIPPETS_BY_NODE["get-all-valid-fields-1"]!,
};

export const DEFAULT_CODE_NODE_SNIPPET = `// Run Once for All Items
const items = $input.all();
return items.map(({ json }) => ({ json }));`;

/** Resolve display/edit code — stored code wins, then snippet catalog, then fn hint stub. */
export function resolveNodeJavaScript(
  nodeId: string,
  config: Record<string, unknown> = {},
): string {
  const stored = String(config.code ?? "").trim();
  if (stored) return stored;

  const byNode = SNIPPETS_BY_NODE[nodeId];
  if (byNode) return byNode;

  const hint = String(config.codeHint ?? "").trim();
  if (hint && SNIPPETS_BY_FN[hint]) return SNIPPETS_BY_FN[hint];

  const impl = getNodeImplementation(nodeId);
  if (hint && impl?.fn) {
    return `// ${impl.fn}()
// ${impl.description}
const items = $input.all();
return items.map(({ json }) => ({ json: ${impl.fn}(json) }));`;
  }
  if (hint) {
    return `// ${hint}
const items = $input.all();
return items;`;
  }
  if (impl?.fn) {
    return `// WEBEE: ${impl.fn}()
// ${impl.description}
const items = $input.all();
return items.map(({ json }) => ({ json: ${impl.fn}(json) }));`;
  }

  return DEFAULT_CODE_NODE_SNIPPET;
}

/** Bake default code onto code-node configs when missing (template load). */
export function withDefaultCodeIfMissing(
  nodeId: string,
  kind: string,
  config: Record<string, unknown> = {},
): Record<string, unknown> {
  if (kind !== "code") return config;
  if (String(config.code ?? "").trim()) return config;
  return {
    ...config,
    code: resolveNodeJavaScript(nodeId, config),
    mode: config.mode ?? "Run Once for All Items",
    language: config.language ?? "JavaScript",
  };
}
