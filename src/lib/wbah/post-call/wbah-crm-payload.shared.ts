import type { AllensLogicResult } from "./wbah-allens-logic.shared";
import type { WbahFormattedCallData } from "./wbah-format-data.shared";
import { normalizeWbahAgenticCrmFields } from "./wbah-agentic-crm-normalize.shared";

export type WbahCrmPatchPayload = Record<string, string | number | boolean | null>;

const NUMERIC_FIELD_PATTERN = /^(100000\d+|181510\d+|279640\d+)$/;

function isNumericOptionValue(v: unknown): v is string {
  return typeof v === "string" && NUMERIC_FIELD_PATTERN.test(v.trim());
}

function val(...args: unknown[]): unknown {
  for (const v of args) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function intVal(...args: unknown[]): number | undefined {
  const v = val(...args);
  if (v === undefined) return undefined;
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? undefined : n;
}

function cleanNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const cleaned = String(v).replace(/[£$,]/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? undefined : n;
}

/** Only include non-empty Dynamics fields (mirrors n8n getAllValidFields behaviour). */
export function filterValidDynamicsFields(
  fields: Record<string, unknown>,
): WbahCrmPatchPayload {
  const out: WbahCrmPatchPayload = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      out[key] = isNumericOptionValue(trimmed) ? Number(trimmed) : trimmed;
      continue;
    }
  }
  return out;
}

/** n8n node 34 — small agentic sentiment/status patch. */
export function buildWbahClearDataAgenticPayload(input: {
  statecode?: number | null;
  newCurrentstatus?: number | null;
  userSentiment?: string | null;
  callSummary?: string | null;
}): WbahCrmPatchPayload {
  const base: Record<string, unknown> = {};
  if (input.statecode != null) base.statecode = input.statecode;
  if (input.newCurrentstatus != null) base.new_currentstatus = input.newCurrentstatus;
  if (input.userSentiment) base.cos_user_sentiment = input.userSentiment;
  if (input.callSummary) base.cos_call_summary = input.callSummary;
  return filterValidDynamicsFields(base);
}

/** n8n node 15 — Build CRM Payload with Allen's skip flags + verified_details. */
export function buildWbahAllensCrmPayload(input: {
  formatted: WbahFormattedCallData;
  allens: AllensLogicResult;
  calendlyBookingUrl: string | null;
  callbackUtc: string | null;
}): WbahCrmPatchPayload {
  const { formatted, allens, calendlyBookingUrl, callbackUtc } = input;
  const payload: Record<string, unknown> = {};
  const vd = formatted.verifiedDetails ?? formatted.structuredJsonOutput ?? {};

  if (allens.skipStatusUpdate) {
    if (!allens.skipAppointmentUpdate) {
      if (formatted.requestedStartUtc) payload.cos_appointment_time = formatted.requestedStartUtc;
      if (calendlyBookingUrl) payload.cos_calendly_booking_url = calendlyBookingUrl;
      if (formatted.appointmentDate) payload.cos_appointment_date = formatted.appointmentDate;
    }
  } else {
    if (!allens.skipStatecodeUpdate && allens.statecodeOverride != null) {
      payload.statecode = allens.statecodeOverride;
    } else if (!allens.skipStatecodeUpdate) {
      payload.statecode = 0;
    }

    if (allens.newCurrentStatus != null) {
      payload.new_currentstatus = allens.newCurrentStatus;
    }

    if (allens.isCallbackRequest && callbackUtc) {
      payload.cos_callbackrequest = callbackUtc;
    }

    if (!allens.skipAppointmentUpdate) {
      if (formatted.requestedStartUtc) payload.cos_appointment_time = formatted.requestedStartUtc;
      if (calendlyBookingUrl) payload.cos_calendly_booking_url = calendlyBookingUrl;
      if (formatted.appointmentDate) payload.cos_appointment_date = formatted.appointmentDate;
    }
  }

  if (formatted.userSentiment) payload.cos_user_sentiment = formatted.userSentiment;
  if (formatted.callSummary) payload.cos_call_summary = formatted.callSummary;

  const fn = val(vd.firstname, vd.first_name); if (fn) payload.firstname = fn;
  const ln = val(vd.lastname, vd.last_name); if (ln) payload.lastname = ln;
  const email = val(vd.emailaddress1, vd.user_email, vd.email_address, formatted.email);
  if (email) payload.emailaddress1 = email;
  const mobile = val(vd.mobilephone, vd.user_mobile); if (mobile) payload.mobilephone = mobile;
  const homeTel = val(vd.new_othervendor_hometelephone, vd.user_mobile); if (homeTel) payload.new_othervendor_hometelephone = homeTel;
  const titleVal = intVal(vd.new_contact_title, vd.title); if (titleVal !== undefined) payload.new_contact_title = titleVal;

  const street2 = val(vd.new_propinfo_street2); if (street2) payload.new_propinfo_street2 = street2;
  const street3 = val(vd.new_propinfo_street3); if (street3) payload.new_propinfo_street3 = street3;
  const propCity = val(vd.new_propinfo_city); if (propCity) payload.new_propinfo_city = propCity;
  const propPostcode = val(vd.new_propinfo_postalcode); if (propPostcode) payload.new_propinfo_postalcode = propPostcode;
  const propState = val(vd.new_propinfo_stateorprovince); if (propState) payload.new_propinfo_stateorprovince = propState;
  const addr1 = val(vd.address1_line1); if (addr1) payload.address1_line1 = addr1;
  const addr2 = val(vd.address1_line2); if (addr2) payload.address1_line2 = addr2;
  const addrCity = val(vd.address1_city); if (addrCity) payload.address1_city = addrCity;
  const addrState = val(vd.address1_stateorprovince); if (addrState) payload.address1_stateorprovince = addrState;
  const addrPostcode = val(vd.address1_postalcode); if (addrPostcode) payload.address1_postalcode = addrPostcode;

  const propType = intVal(vd.new_propinfo_typeofproperty, vd.property_type); if (propType !== undefined) payload.new_propinfo_typeofproperty = propType;
  const floor = intVal(vd.new_propinfo_whichfloor, vd.floor); if (floor !== undefined) payload.new_propinfo_whichfloor = floor;
  const bedrooms = intVal(vd.new_propinfo_numberofbedrooms); if (bedrooms !== undefined) payload.new_propinfo_numberofbedrooms = bedrooms;
  const howQuickly = intVal(vd.new_propinfo_howquickly, vd.timeframe); if (howQuickly !== undefined) payload.new_propinfo_howquickly = howQuickly;

  const propEmpty = intVal(vd.cos_propertyempty); if (propEmpty !== undefined) payload.cos_propertyempty = propEmpty;
  const propRented = intVal(vd.cos_propertyrented); if (propRented !== undefined) payload.cos_propertyrented = propRented;
  const sharedOwn = intVal(vd.cos_sharedownership); if (sharedOwn !== undefined) payload.cos_sharedownership = sharedOwn;
  const sellRent = intVal(vd.cos_sellrentback); if (sellRent !== undefined) payload.cos_sellrentback = sellRent;
  const parkHome = intVal(vd.cos_parkhome); if (parkHome !== undefined) payload.cos_parkhome = parkHome;
  const commercial = intVal(vd.cos_commercial); if (commercial !== undefined) payload.cos_commercial = commercial;
  const tenureVal = intVal(vd.cos_tenure, vd.tenure); if (tenureVal !== undefined) payload.cos_tenure = tenureVal;
  const sourceType = intVal(vd.cos_sourcetype); if (sourceType !== undefined) payload.cos_sourcetype = sourceType;

  if (tenureVal === 279640001) {
    const groundRent = cleanNumber(vd.cos_groundrent ?? vd.ground_rent); if (groundRent !== undefined) payload.cos_groundrent = groundRent;
    const serviceCharge = cleanNumber(vd.cos_servicecharge ?? vd.service_charge); if (serviceCharge !== undefined) payload.cos_servicecharge = serviceCharge;
    const leaseYears = cleanNumber(vd.cos_numberofyearsonlease ?? vd.years_on_lease); if (leaseYears !== undefined) payload.cos_numberofyearsonlease = leaseYears;
  }

  return filterValidDynamicsFields(payload);
}

/** Agentic PATCH from structured_json_output.verified_details */
export function buildWbahAgenticCrmPayload(
  structured: Record<string, unknown> | null,
  custom?: Record<string, unknown>,
): WbahCrmPatchPayload {
  if (!structured) return {};
  const normalized = normalizeWbahAgenticCrmFields(structured, custom);
  return filterValidDynamicsFields(normalized);
}

/** n8n node 11 — append slot UTC to Calendly scheduling URL path. */
export function buildWbahCalendlySlotUrl(
  bookingUrl: string,
  formatted: WbahFormattedCallData,
): string {
  const requestedStart = formatted.requestedStartUtc;
  if (!bookingUrl || !requestedStart) return bookingUrl;

  try {
    const slotDateTime = new Date(requestedStart).toISOString();
    const slotDate = formatted.appointmentDate ?? slotDateTime.split("T")[0]!;
    const slotMonth = slotDate.slice(0, 7);
    const base = bookingUrl.replace(/\/$/, "");
    return `${base}/${encodeURIComponent(slotDateTime)}?month=${slotMonth}&date=${slotDate}`;
  } catch {
    return bookingUrl;
  }
}
