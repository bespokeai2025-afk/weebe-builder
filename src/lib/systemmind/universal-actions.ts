// ── Universal Business Action Registry (spec Phase 5) ─────────────────────────
// A catalog of CRM-agnostic action *intents*. These describe WHAT a business
// wants to happen ("Mark Lead as Qualified") independent of any vendor. CRM
// adapter definitions (src/lib/systemmind/crm-definitions/) map each of these
// intents onto a specific CRM's objects/fields, and the knowledge-graph builder
// snapshots them as `universal_action` nodes so later planning can reference
// them.
//
// This module is PURE (no server imports) so both the client UI and the
// server-side graph builder can import it directly. It is descriptive only —
// nothing here executes any CRM operation.

export type UniversalActionId =
  | "create_lead"
  | "update_lead"
  | "create_contact"
  | "update_contact"
  | "create_deal"
  | "update_deal"
  | "assign_owner"
  | "create_note"
  | "attach_transcript"
  | "attach_recording"
  | "move_pipeline_stage"
  | "update_qualification"
  | "schedule_callback"
  | "create_appointment"
  | "tag_record"
  | "search_record"
  | "merge_record"
  | "archive_record";

export type UniversalActionCategory =
  | "lead"
  | "contact"
  | "deal"
  | "ownership"
  | "note"
  | "media"
  | "pipeline"
  | "qualification"
  | "scheduling"
  | "record";

export type UniversalParamType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "enum"
  | "id"
  | "object";

export interface UniversalActionParam {
  name: string;
  type: UniversalParamType;
  required: boolean;
  description: string;
}

export interface UniversalAction {
  id: UniversalActionId;
  label: string;
  /** Natural-language intent phrase, e.g. "Mark this lead as qualified". */
  intent: string;
  category: UniversalActionCategory;
  description: string;
  inputs: UniversalActionParam[];
  /** Logical outputs the action produces, e.g. ["lead_id"]. */
  outputs: string[];
  /** True when re-running with the same inputs is safe (upsert-style). */
  idempotent: boolean;
}

const RECORD_REF: UniversalActionParam = {
  name: "record_id",
  type: "id",
  required: true,
  description: "Identifier of the target record in the CRM.",
};

const CATALOG: UniversalAction[] = [
  {
    id: "create_lead",
    label: "Create Lead",
    intent: "Create a new lead from a captured contact or call.",
    category: "lead",
    description: "Create a new lead record with contact details and source attribution.",
    inputs: [
      { name: "name", type: "string", required: true, description: "Full name of the lead." },
      { name: "email", type: "string", required: false, description: "Email address." },
      { name: "phone", type: "string", required: false, description: "Phone number." },
      { name: "source", type: "string", required: false, description: "Lead source / channel." },
      { name: "attributes", type: "object", required: false, description: "Additional custom fields." },
    ],
    outputs: ["lead_id"],
    idempotent: false,
  },
  {
    id: "update_lead",
    label: "Update Lead",
    intent: "Update an existing lead's details.",
    category: "lead",
    description: "Patch fields on an existing lead record.",
    inputs: [RECORD_REF, { name: "attributes", type: "object", required: true, description: "Fields to update." }],
    outputs: ["lead_id"],
    idempotent: true,
  },
  {
    id: "create_contact",
    label: "Create Contact",
    intent: "Create a new contact / person record.",
    category: "contact",
    description: "Create a person/contact record.",
    inputs: [
      { name: "name", type: "string", required: true, description: "Full name of the contact." },
      { name: "email", type: "string", required: false, description: "Email address." },
      { name: "phone", type: "string", required: false, description: "Phone number." },
      { name: "attributes", type: "object", required: false, description: "Additional custom fields." },
    ],
    outputs: ["contact_id"],
    idempotent: false,
  },
  {
    id: "update_contact",
    label: "Update Contact",
    intent: "Update an existing contact's details.",
    category: "contact",
    description: "Patch fields on an existing contact record.",
    inputs: [RECORD_REF, { name: "attributes", type: "object", required: true, description: "Fields to update." }],
    outputs: ["contact_id"],
    idempotent: true,
  },
  {
    id: "create_deal",
    label: "Create Deal",
    intent: "Create a new deal / opportunity.",
    category: "deal",
    description: "Create a deal/opportunity linked to a contact or lead.",
    inputs: [
      { name: "title", type: "string", required: true, description: "Deal name/title." },
      { name: "value", type: "number", required: false, description: "Monetary value." },
      { name: "currency", type: "string", required: false, description: "Currency code." },
      { name: "contact_id", type: "id", required: false, description: "Associated contact." },
      { name: "stage", type: "string", required: false, description: "Initial pipeline stage." },
    ],
    outputs: ["deal_id"],
    idempotent: false,
  },
  {
    id: "update_deal",
    label: "Update Deal",
    intent: "Update an existing deal's details.",
    category: "deal",
    description: "Patch fields on an existing deal/opportunity.",
    inputs: [RECORD_REF, { name: "attributes", type: "object", required: true, description: "Fields to update." }],
    outputs: ["deal_id"],
    idempotent: true,
  },
  {
    id: "assign_owner",
    label: "Assign Owner",
    intent: "Assign or reassign the owner of a record.",
    category: "ownership",
    description: "Set the owning user/team for a lead, contact, or deal.",
    inputs: [
      RECORD_REF,
      { name: "owner", type: "string", required: true, description: "Owner identifier (user id, email, or team)." },
    ],
    outputs: ["record_id"],
    idempotent: true,
  },
  {
    id: "create_note",
    label: "Create Note",
    intent: "Attach a note to a record.",
    category: "note",
    description: "Add a free-text note/comment to a record.",
    inputs: [
      RECORD_REF,
      { name: "body", type: "string", required: true, description: "Note content." },
    ],
    outputs: ["note_id"],
    idempotent: false,
  },
  {
    id: "attach_transcript",
    label: "Attach Transcript",
    intent: "Attach a call transcript to a record.",
    category: "media",
    description: "Store a call transcript as an activity/note on the record.",
    inputs: [
      RECORD_REF,
      { name: "transcript", type: "string", required: true, description: "Full transcript text." },
      { name: "call_id", type: "id", required: false, description: "Source call identifier." },
    ],
    outputs: ["activity_id"],
    idempotent: false,
  },
  {
    id: "attach_recording",
    label: "Attach Recording",
    intent: "Attach a call recording URL to a record.",
    category: "media",
    description: "Store a call recording reference as an activity on the record.",
    inputs: [
      RECORD_REF,
      { name: "recording_url", type: "string", required: true, description: "Recording URL." },
      { name: "call_id", type: "id", required: false, description: "Source call identifier." },
    ],
    outputs: ["activity_id"],
    idempotent: false,
  },
  {
    id: "move_pipeline_stage",
    label: "Move Pipeline Stage",
    intent: "Move a deal to a different pipeline stage.",
    category: "pipeline",
    description: "Change the pipeline stage of a deal/opportunity.",
    inputs: [
      RECORD_REF,
      { name: "stage", type: "string", required: true, description: "Target pipeline stage." },
    ],
    outputs: ["deal_id"],
    idempotent: true,
  },
  {
    id: "update_qualification",
    label: "Update Qualification",
    intent: "Mark a lead/contact as qualified, unqualified, or nurturing.",
    category: "qualification",
    description: "Set the qualification status of a lead or contact.",
    inputs: [
      RECORD_REF,
      { name: "qualification", type: "enum", required: true, description: "qualified | unqualified | nurturing | disqualified." },
      { name: "reason", type: "string", required: false, description: "Optional reason/notes." },
    ],
    outputs: ["record_id"],
    idempotent: true,
  },
  {
    id: "schedule_callback",
    label: "Schedule Callback",
    intent: "Schedule a callback task for a record.",
    category: "scheduling",
    description: "Create a task/reminder to call the contact back at a given time.",
    inputs: [
      RECORD_REF,
      { name: "callback_at", type: "date", required: true, description: "When to call back." },
      { name: "owner", type: "string", required: false, description: "Owner to assign the task to." },
    ],
    outputs: ["task_id"],
    idempotent: false,
  },
  {
    id: "create_appointment",
    label: "Create Appointment",
    intent: "Book an appointment / meeting for a record.",
    category: "scheduling",
    description: "Create a calendar appointment/meeting linked to the record.",
    inputs: [
      RECORD_REF,
      { name: "start_at", type: "date", required: true, description: "Appointment start time." },
      { name: "end_at", type: "date", required: false, description: "Appointment end time." },
      { name: "title", type: "string", required: false, description: "Appointment title." },
    ],
    outputs: ["appointment_id"],
    idempotent: false,
  },
  {
    id: "tag_record",
    label: "Tag Record",
    intent: "Add or remove tags/labels on a record.",
    category: "record",
    description: "Apply one or more tags/labels to a record.",
    inputs: [
      RECORD_REF,
      { name: "tags", type: "object", required: true, description: "Array of tag names to apply." },
    ],
    outputs: ["record_id"],
    idempotent: true,
  },
  {
    id: "search_record",
    label: "Search Record",
    intent: "Find a record by email, phone, or other identifier.",
    category: "record",
    description: "Look up an existing record before create/update (dedupe).",
    inputs: [
      { name: "query", type: "string", required: true, description: "Search term (email, phone, name)." },
      { name: "object", type: "string", required: false, description: "Object type to search (lead|contact|deal)." },
    ],
    outputs: ["record_id"],
    idempotent: true,
  },
  {
    id: "merge_record",
    label: "Merge Record",
    intent: "Merge duplicate records into one.",
    category: "record",
    description: "Merge a duplicate record into a surviving primary record.",
    inputs: [
      { name: "primary_id", type: "id", required: true, description: "Record to keep." },
      { name: "duplicate_id", type: "id", required: true, description: "Record to merge away." },
    ],
    outputs: ["record_id"],
    idempotent: false,
  },
  {
    id: "archive_record",
    label: "Archive Record",
    intent: "Archive or soft-delete a record.",
    category: "record",
    description: "Archive/soft-delete a record without hard deletion.",
    inputs: [RECORD_REF],
    outputs: ["record_id"],
    idempotent: true,
  },
];

// Frozen, module-level seed. Consumers get clones so no caller can mutate it.
const UNIVERSAL_ACTIONS_SEED: readonly UniversalAction[] = Object.freeze(CATALOG);

function clone<T>(v: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(v)
    : (JSON.parse(JSON.stringify(v)) as T);
}

export function listUniversalActions(): UniversalAction[] {
  return UNIVERSAL_ACTIONS_SEED.map((a) => clone(a));
}

export function getUniversalAction(id: UniversalActionId): UniversalAction | undefined {
  const found = UNIVERSAL_ACTIONS_SEED.find((a) => a.id === id);
  return found ? clone(found) : undefined;
}

export const UNIVERSAL_ACTION_CATEGORIES: Record<UniversalActionCategory, string> = {
  lead: "Leads",
  contact: "Contacts",
  deal: "Deals",
  ownership: "Ownership",
  note: "Notes",
  media: "Media",
  pipeline: "Pipeline",
  qualification: "Qualification",
  scheduling: "Scheduling",
  record: "Records",
};

export function listUniversalActionIds(): UniversalActionId[] {
  return UNIVERSAL_ACTIONS_SEED.map((a) => a.id);
}
