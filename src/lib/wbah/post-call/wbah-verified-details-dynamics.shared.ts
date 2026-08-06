/**
 * Retell structured_json_output.verified_details → Dynamics Lead attributes.
 * Single source of truth for New Leads post-call field mapping.
 */

/** Retell extraction keys that alias to a Dynamics attribute (extraction name → CRM name). */
export const WBAH_VERIFIED_DETAILS_ALIASES: Record<string, string> = {
  property_type: "new_propinfo_typeofproperty",
  tenure: "cos_tenure",
  timeframe: "new_propinfo_howquickly",
  floor: "new_propinfo_whichfloor",
  on_market: "cos_onthemarket",
  first_name: "firstname",
  last_name: "lastname",
  user_email: "emailaddress1",
  email_address: "emailaddress1",
  user_mobile: "mobilephone",
  title: "new_contact_title",
  no_of_bedrooms: "new_propinfo_numberofbedrooms",
  floor_number_if_apartment: "new_propinfo_whichfloor",
  is_property_currently_vacant: "cos_propertyempty",
  is_property_currently_rented: "cos_propertyrented",
  ground_rent: "cos_groundrent",
  service_charge: "cos_servicecharge",
  years_on_lease: "cos_numberofyearsonlease",
  numberofyearsonlease: "cos_numberofyearsonlease",
  sellers_timeframe: "new_propinfo_howquickly",
  property_empty: "cos_propertyempty",
  property_rented: "cos_propertyrented",
  decision_maker: "decisionmaker",
};

/** Extraction-only keys — never PATCH under the raw name (use alias or derivation). */
export const WBAH_VERIFIED_DETAILS_EXCLUDED_KEYS = new Set([
  "property_type",
  "vacant_or_tenanted",
  "tenure",
  "floor",
  "on_market",
  "timeframe",
  "is_need_to_call_again_for_booking",
  "verified_details",
  "decision_maker",
  "first_name",
  "last_name",
  "user_email",
  "email_address",
  "user_mobile",
  "title",
]);

/** Dynamics Lead attributes writable from WBAH verified_details (production set). */
export const WBAH_VERIFIED_DETAILS_DYNAMICS_FIELDS = new Set([
  "new_propinfo_numberofbedrooms",
  "cos_propertyempty",
  "cos_propertyrented",
  "cos_sharedownership",
  "cos_sellrentback",
  "cos_parkhome",
  "cos_commercial",
  "cos_tenure",
  "cos_onthemarket",
  "new_propinfo_howquickly",
  "cos_sourcetype",
  "new_contact_title",
  "cos_groundrent",
  "cos_servicecharge",
  "cos_numberofyearsonlease",
  "new_propinfo_street2",
  "new_propinfo_street3",
  "new_propinfo_city",
  "address1_line1",
  "address1_line2",
  "address1_city",
  "new_propinfo_stateorprovince",
  "address1_stateorprovince",
  "address1_postalcode",
  "new_propinfo_postalcode",
  "firstname",
  "lastname",
  "emailaddress1",
  "new_othervendor_hometelephone",
  "mobilephone",
  "cos_call_summary",
  "new_propinfo_typeofproperty",
  "new_propinfo_whichfloor",
  "decisionmaker",
]);

const LEASEHOLD_TENURE = 279640001;

function isEmptyValue(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

function val(...args: unknown[]): unknown {
  for (const v of args) {
    if (!isEmptyValue(v)) return v;
  }
  return undefined;
}

function intVal(...args: unknown[]): number | undefined {
  const v = val(...args);
  if (v === undefined) return undefined;
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? undefined : n;
}

function boolVal(v: unknown): boolean | undefined {
  if (v === true || v === false) return v;
  if (isEmptyValue(v)) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "1") return true;
  if (s === "false" || s === "no" || s === "0") return false;
  return undefined;
}

function cleanNumber(v: unknown): number | undefined {
  if (isEmptyValue(v)) return undefined;
  const cleaned = String(v).replace(/[£$,]/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * vacant_or_tenanted: 181510000 Vacant, 181510001 Rented
 * cos_propertyempty / cos_propertyrented: 181510001 Yes, 181510000 No
 */
export function applyVacantOrTenantedToPayload(
  target: Record<string, unknown>,
  vacantOrTenanted: unknown,
): void {
  const code = String(vacantOrTenanted ?? "").trim();
  if (!code) return;

  if (code === "181510000") {
    if (isEmptyValue(target.cos_propertyempty)) target.cos_propertyempty = 181510001;
    if (isEmptyValue(target.cos_propertyrented)) target.cos_propertyrented = 181510000;
    return;
  }

  if (code === "181510001") {
    if (isEmptyValue(target.cos_propertyempty)) target.cos_propertyempty = 181510000;
    if (isEmptyValue(target.cos_propertyrented)) target.cos_propertyrented = 181510001;
  }
}

/** Map verified_details (+ optional top-level email) → Dynamics Lead PATCH fields. */
export function mapWbahVerifiedDetailsToDynamicsFields(input: {
  verifiedDetails: Record<string, unknown>;
  fallbackEmail?: string | null;
}): Record<string, unknown> {
  const vd = input.verifiedDetails;
  const payload: Record<string, unknown> = {};

  const fn = val(vd.firstname, vd.first_name);
  if (fn) payload.firstname = fn;
  const ln = val(vd.lastname, vd.last_name);
  if (ln) payload.lastname = ln;
  const email = val(vd.emailaddress1, vd.user_email, vd.email_address, input.fallbackEmail);
  if (email) payload.emailaddress1 = email;
  const mobile = val(vd.mobilephone, vd.user_mobile);
  if (mobile) payload.mobilephone = mobile;
  const homeTel = val(vd.new_othervendor_hometelephone, vd.user_mobile);
  if (homeTel) payload.new_othervendor_hometelephone = homeTel;

  const titleVal = intVal(vd.new_contact_title, vd.title);
  if (titleVal !== undefined) payload.new_contact_title = titleVal;

  const decisionMaker = boolVal(vd.decision_maker ?? vd.decisionmaker);
  if (decisionMaker !== undefined) payload.decisionmaker = decisionMaker;

  for (const key of [
    "new_propinfo_street2",
    "new_propinfo_street3",
    "new_propinfo_city",
    "new_propinfo_postalcode",
    "new_propinfo_stateorprovince",
    "address1_line1",
    "address1_line2",
    "address1_city",
    "address1_stateorprovince",
    "address1_postalcode",
  ] as const) {
    const v = val(vd[key]);
    if (v) payload[key] = v;
  }

  const propType = intVal(vd.new_propinfo_typeofproperty, vd.property_type);
  if (propType !== undefined) payload.new_propinfo_typeofproperty = propType;
  const floor = intVal(vd.new_propinfo_whichfloor, vd.floor);
  if (floor !== undefined) payload.new_propinfo_whichfloor = floor;
  const bedrooms = intVal(vd.new_propinfo_numberofbedrooms);
  if (bedrooms !== undefined) payload.new_propinfo_numberofbedrooms = bedrooms;
  const howQuickly = intVal(vd.new_propinfo_howquickly, vd.timeframe);
  if (howQuickly !== undefined) payload.new_propinfo_howquickly = howQuickly;

  applyVacantOrTenantedToPayload(payload, vd.vacant_or_tenanted);

  const propEmpty = intVal(vd.cos_propertyempty);
  if (propEmpty !== undefined) payload.cos_propertyempty = propEmpty;
  const propRented = intVal(vd.cos_propertyrented);
  if (propRented !== undefined) payload.cos_propertyrented = propRented;
  const sharedOwn = intVal(vd.cos_sharedownership);
  if (sharedOwn !== undefined) payload.cos_sharedownership = sharedOwn;
  const sellRent = intVal(vd.cos_sellrentback);
  if (sellRent !== undefined) payload.cos_sellrentback = sellRent;
  const parkHome = intVal(vd.cos_parkhome);
  if (parkHome !== undefined) payload.cos_parkhome = parkHome;
  const commercial = intVal(vd.cos_commercial);
  if (commercial !== undefined) payload.cos_commercial = commercial;
  const tenureVal = intVal(vd.cos_tenure, vd.tenure);
  if (tenureVal !== undefined) payload.cos_tenure = tenureVal;
  const onMarket = intVal(vd.on_market);
  if (onMarket !== undefined) payload.cos_onthemarket = onMarket;
  const sourceType = intVal(vd.cos_sourcetype);
  if (sourceType !== undefined) payload.cos_sourcetype = sourceType;

  const isLeasehold = tenureVal === LEASEHOLD_TENURE;
  if (isLeasehold) {
    const groundRent = cleanNumber(vd.cos_groundrent ?? vd.ground_rent);
    if (groundRent !== undefined) payload.cos_groundrent = groundRent;
    const serviceCharge = cleanNumber(vd.cos_servicecharge ?? vd.service_charge);
    if (serviceCharge !== undefined) payload.cos_servicecharge = serviceCharge;
    const leaseYears = cleanNumber(vd.cos_numberofyearsonlease ?? vd.years_on_lease);
    if (leaseYears !== undefined) payload.cos_numberofyearsonlease = leaseYears;
  }

  const callSummary = val(vd.cos_call_summary);
  if (callSummary) payload.cos_call_summary = callSummary;

  return payload;
}
