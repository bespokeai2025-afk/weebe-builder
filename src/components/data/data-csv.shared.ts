/** Data page — CSV column detection and parsing. */


export const SYSTEM_FIELDS: Array<{ value: string; label: string; required?: boolean; custom?: boolean }> =
  [
    { value: "name", label: "Name", required: true },
    { value: "mobile_number", label: "Mobile Number", required: true },
    { value: "first_name", label: "First Name" },
    { value: "last_name", label: "Last Name" },
    { value: "email", label: "Email" },
    { value: "title", label: "Title" },
    { value: "client_name", label: "Client Name" },
    { value: "unique_id", label: "Unique ID" },
    { value: "lead_external_id", label: "Lead External ID" },
    { value: "property_type", label: "Property Type" },
    { value: "bedrooms", label: "Bedrooms" },
    { value: "address_line1", label: "Address Line 1" },
    { value: "address_line2", label: "Address Line 2" },
    { value: "city", label: "City" },
    { value: "state", label: "State" },
    { value: "postal_code", label: "Postal Code" },
    { value: "notes", label: "Notes" },
    { value: "__custom__", label: "Custom field (stored in meta)", custom: true },
  ];

export function normaliseKey(s: string) {
  return s.toLowerCase().replace(/[\s_\-().]/g, "");
}

/** Convert a CSV column header to a snake_case meta key */
export function toMetaKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-().\/]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export const FIELD_ALIASES: Record<string, string> = {
  name: "name",
  fullname: "name",
  mobilenumber: "mobile_number",
  phone: "mobile_number",
  phonenumber: "mobile_number",
  mobile: "mobile_number",
  cellphone: "mobile_number",
  cell: "mobile_number",
  contactnumber: "mobile_number",
  firstname: "first_name",
  givenname: "first_name",
  lastname: "last_name",
  surname: "last_name",
  familyname: "last_name",
  email: "email",
  emailaddress: "email",
  title: "title",
  jobtitle: "title",
  clientname: "client_name",
  company: "client_name",
  organisation: "client_name",
  organization: "client_name",
  uniqueid: "unique_id",
  externalid: "unique_id",
  ref: "unique_id",
  propertytype: "property_type",
  type: "property_type",
  bedrooms: "bedrooms",
  beds: "bedrooms",
  addressline1: "address_line1",
  address1: "address_line1",
  streetaddress: "address_line1",
  address: "address_line1",
  addressline2: "address_line2",
  address2: "address_line2",
  city: "city",
  town: "city",
  suburb: "city",
  state: "state",
  county: "state",
  region: "state",
  postalcode: "postal_code",
  postcode: "postal_code",
  zip: "postal_code",
  zipcode: "postal_code",
  leadexternalid: "lead_external_id",
  leadid: "lead_external_id",
  notes: "notes",
  note: "notes",
  comments: "notes",
  description: "notes",
  remarks: "notes",
};

export function autoDetectMapping(headers: string[]): Record<string, string> {
  const used = new Set<string>();
  const mapping: Record<string, string> = {};
  for (const h of headers) {
    const norm = normaliseKey(h);
    const sysField = FIELD_ALIASES[norm] ?? "";
    if (sysField && !used.has(sysField)) {
      mapping[h] = sysField;
      used.add(sysField);
    } else {
      mapping[h] = "";
    }
  }
  return mapping;
}

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
