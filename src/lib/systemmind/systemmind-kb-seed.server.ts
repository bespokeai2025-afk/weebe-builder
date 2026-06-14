// ── SystemMind Knowledge Base Seeder (SERVER ONLY) ─────────────────────────────
// Seeds Architecture KB and Workflow KB starter documents into the systemmind
// executive knowledge base so querySystemMindKnowledgeContext has grounding
// material from day one.
//
// Idempotent: every document has a stable `seed_key`; rows already indexed are
// skipped.  Processing is batched (default 4 per call) so the routine never
// exceeds request timeouts — callers re-invoke until `remaining === 0`.
//
// Repair KB is handled separately by seedRepairPlaybooks() in
// systemmind-workflow.server.ts (22 structured playbooks in a dedicated table).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveOpenAiKey, ensureDefaultKnowledgeBases } from "@/lib/executives/executive-knowledge.server";
import { indexTextDocument } from "@/lib/executives/executive-document-processing.server";

// ── Static seed documents ──────────────────────────────────────────────────────
// Content is hardcoded (not AI-generated) because it describes THIS platform
// precisely — no prompt can be more accurate.  Each doc is ~600-900 words of
// dense markdown, which chunks/embeds well for RAG retrieval.

type KbSeedDoc = {
  seedKey: string;
  title: string;
  content: string;
};

const ARCHITECTURE_DOCS: KbSeedDoc[] = [
  {
    seedKey: "systemmind-arch:platform-overview",
    title: "Platform Architecture Overview",
    content: `# Platform Architecture Overview

## What This Platform Is
An AI voice-agent builder and multi-executive intelligence platform. Users build
conversation workflows in a visual drag-and-drop canvas (the Builder), deploy
agents to phone numbers or WhatsApp channels, and monitor performance through
three AI executives: SystemMind (CTO), GrowthMind (CMO), and HiveMind (COO).

## Core Modules

### Agent Builder
- Visual flow editor (React Flow) where each conversation step is a **node**
- Nodes are connected by **edges** that carry conditions
- Flow is stored as JSON (\`flow_data.nodes[]\`, \`flow_data.edges[]\`) in the \`agents\` table
- Agents can be deployed via Retell (OmniVoice), ElevenLabs (HyperStream/VoxStream),
  or OpenAI Realtime (VoxStream) for voice; Twilio/WATI/Meta for WhatsApp

### Executive Dashboards
- **SystemMind** — CTO: architecture visualisation, workflow intelligence,
  repair analysis, provider health, cost observability
- **GrowthMind** — CMO: lead pipeline, funnel, content calendar, SEO, paid ads,
  revenue forecasting
- **HiveMind** — COO: cross-executive summaries, task management, KPIs,
  business health monitoring

### Provider Framework
- Unified abstraction across 12 provider categories
- Each provider has: adapter (healthCheck, runtime methods), factory (withFallback),
  instrumentation (usage tracking), credential storage (\`provider_settings\` table)
- Fallback providers are tried automatically when the primary fails

### Knowledge System (RAG)
- Three executive KBs: \`growthmind\`, \`systemmind\`, \`hivemind\` + \`shared\`
- Documents chunked and embedded with \`text-embedding-3-small\` (1536 dims)
- Retrieved via pgvector cosine similarity in \`executive_document_chunks\`
- Access rules prevent cross-executive KB leakage

### Campaign Engine
- Campaigns enrol contacts → executor fires actions (call, WhatsApp, email) on schedule
- Scheduled by \`pg_cron\` in production; Vite plugin ticker in development
- State tracked in \`campaign_enrollments\` + \`campaign_enrollment_actions\`

## Tech Stack
- **Frontend**: React + TanStack Start (SSR), Vite, Tailwind CSS, shadcn/ui
- **Backend**: TanStack Server Functions (edge-compatible), Supabase (PostgreSQL + Auth + Storage + pgvector)
- **AI**: OpenAI GPT-4o-mini for generation, text-embedding-3-small for RAG, OpenAI Realtime API for VoxStream
- **Voice providers**: Retell AI, ElevenLabs, OpenAI Realtime
- **WhatsApp**: WATI, Twilio, Meta Cloud API
- **Email**: Resend, SendGrid (via provider framework)

## Deployment
- Development: \`npm run dev\` starts the Vite + TanStack Start dev server (port 3000)
- Production: srvx static serving; \`--static=../client\` must point to the built client
- Environment: Replit with Supabase as the primary database; Replit PostgreSQL available
  but the app uses Supabase for all application data
`,
  },
  {
    seedKey: "systemmind-arch:provider-types",
    title: "Provider Types and Registry",
    content: `# Provider Types and Registry

## The 12 Provider Categories

Each category has an **interface** (declared in \`src/lib/providers/\`), one or more
**adapters**, a **factory** (creates instrumented instances with fallback), and
credential storage in the \`provider_settings\` table.

### 1. Voice (\`VoiceProvider\`)
- **retell** — OmniVoice; uses Retell AI API; calls created on the Retell platform
- **openai** — VoxStream; uses OpenAI Realtime API with WebRTC; ephemeral key sessions
- **elevenlabs** — HyperStream; ElevenLabs Conversational AI; WebSocket audio relay

### 2. Email (\`EmailProvider\`)
- **resend** — Resend.com transactional API; \`from\` requires a verified domain
- **sendgrid** — SendGrid v3 API; template or plain-text sends

### 3. Calendar (\`CalendarProvider\`)
- **calcom** — Cal.com self-hosted or cloud; create bookings via REST API
- **google** — Google Calendar API; OAuth required

### 4. WhatsApp (\`WhatsAppProvider\`)
- **wati** — WATI cloud API; session-based messaging; healthCheck via getContacts
- **meta** — Meta Cloud API; requires phone number ID + permanent access token
- **twilio** — Twilio WhatsApp channel; sandbox or production numbers

### 5. CRM (\`CrmProvider\`)
- **hubspot** — HubSpot Contacts API v3; create/update/search contacts
- **gohighlevel** — GoHighLevel API; contacts and pipeline management

### 6. Image (\`ImageProvider\`)
- **gpt_image** — DALL-E 3 (OpenAI); standard or HD quality
- **imagen** — Google Imagen 3; via Vertex AI

### 7. Video (\`VideoProvider\`)
- **runway** — Runway Gen3; text-to-video; tracked in video_seconds
- **google_veo** — Google Veo; video generation

### 8. Analytics (\`AnalyticsProvider\`)
- **google_analytics** — GA4 Data API; free tier; report dimensions/metrics

### 9. Advertising (\`AdvertisingProvider\`)
- **google_ads** — Google Ads API; accessible customers list; sync unit
- **meta_ads** — Meta Marketing API; ad account sync

### 10. Streaming (\`StreamingProvider\`)
- Audio relay bridges for real-time voice streaming

### 11. LLM (\`LlmProvider\`)
- **openai** — GPT-4o/4o-mini for agent generation and executive AI
- **openrouter** — Multi-model gateway (stub, configurable)

### 12. Storage (\`StorageProvider\`)
- **supabase** — Storage buckets for documents and recordings

## Provider Registry
- Defined in \`src/lib/providers/registry.ts\`
- Global immutable seed (REGISTRY constant); never mutated at runtime
- \`buildScopedView(workspaceId)\` merges DB credentials into a per-request view
- Each entry: \`{ id, name, category, displayName, description, unitType, isComingSoon }\`

## Cost Tracking (provider_usage table)
- Columns: workspace_id, provider_category, provider_name, requests, errors,
  total_cost_usd, total_duration_ms, units_consumed, unit_type, cost_per_unit_usd
- Updated by \`withProviderTracking\` wrapper on every instrumented call
- Default cost rates seeded in \`provider_cost_rates\` table per workspace

## Unit Types (canonical)
\`email\`, \`image\`, \`video_seconds\`, \`whatsapp\`, \`api_call\`, \`sync\`, \`minute\`, \`token_1k\`
`,
  },
  {
    seedKey: "systemmind-arch:database-schema",
    title: "Database Schema Overview",
    content: `# Database Schema Overview

## Core Workspace Tables

### workspaces
Primary workspace entity. All user data is scoped by workspace_id.
Key columns: id (UUID), name, owner_id, created_at.

### workspace_members
Maps users to workspaces with roles: \`owner\`, \`admin\`, \`member\`.
Drives RLS policies — every table that stores user data joins against this.

### workspace_settings
One row per workspace. Stores: openai_api_key, crm settings (type, api_key,
base_url), voice preferences, GrowthMind forecast settings, HiveMind mode,
retell_workspace_id, etc. Columns expand via JSONB \`settings\` overflow.

## Agent & Call Tables

### agents
Stores the full agent definition:
- \`flow_data\` JSONB: \`{ nodes: FlowNode[], edges: FlowEdge[] }\`
- \`settings\` JSONB: global prompt, voice settings, openaiSchema, etc.
- \`variables\` JSONB: variable definitions for the conversation
- \`agent_type\`, \`voice_provider\` (retell/elevenlabs/openai), \`status\`

### calls
Records every inbound/outbound call: agent_id, workspace_id, retell_call_id,
start_time, end_time, duration_seconds, sentiment, outcome, transcript JSONB,
provider_channel (retell/hyperstream/voxstream), call_type.

### scheduled_calls
Future calls for the campaign executor: contact_id, agent_id, scheduled_at,
status (pending/completed/failed/cancelled).

## CRM & Contact Tables

### leads / contacts / data_records
Unified contact storage. Each workspace has its own lead/contact records.
Key fields: name, email, phone, status, qualification_score, stage_id, crm_synced_at.

### pipeline_stages
Kanban columns for the CRM pipeline. Ordered by position within a workspace.

### calendar_bookings
Appointments booked by agents. Links to lead, agent, and external booking ID
(cal.com or Google Calendar).

## Provider Framework Tables

### provider_settings
Per-workspace provider credentials and status:
- workspace_id, provider_category, provider_name, credentials JSONB
- status: connected/disconnected/error/coming_soon
- is_default, is_fallback, priority

### provider_usage
Aggregated usage metrics per provider per workspace. Upserted on each tracked call.

### provider_cost_rates
Workspace-level per-unit cost overrides. Seeded with platform defaults.
UNIQUE(workspace_id, provider_category, provider_name, unit_type).

### provider_credential_audit
Audit log of save/delete/test_ok/test_fail events for credential changes.

## Executive Knowledge Tables

### executive_knowledge_bases
One row per KB per workspace: slug (growthmind/systemmind/hivemind/shared),
mind_type, name, description, is_shared.

### executive_documents
Documents uploaded or seeded into a KB. Tracked by embedding_status
(pending/processing/indexed/failed) and optionally seed_key for idempotent seeding.

### executive_document_chunks
Chunked text + pgvector embeddings (vector(1536)). Queried via cosine similarity.

## Campaign & WhatsApp Tables

### campaigns / campaign_enrollments / campaign_enrollment_actions
Multi-step outreach sequences. Executor fires actions (call/whatsapp/email)
at scheduled intervals.

### whatsapp_sessions / whatsapp_messages
Per-contact WhatsApp conversation state, message log, agent assignments.

## SystemMind Tables

### systemmind_repair_playbooks
Structured repair playbooks: problem, symptoms[], checks[], fix_steps[],
risk_level, rollback_plan, provider. Seeded with 22 default entries.

### systemmind_workflow_library
Scanned agent workflows stored for reference.

### systemmind_workflow_patterns / systemmind_workflow_drafts
Extracted patterns and AI-generated workflow drafts.
`,
  },
  {
    seedKey: "systemmind-arch:builder-structure",
    title: "Agent Builder Flow Structure",
    content: `# Agent Builder Flow Structure

## Overview
The Agent Builder is a visual conversation-flow editor built on React Flow.
Each agent's conversation is a directed graph stored as \`flow_data\` JSON in the
\`agents\` table:

\`\`\`json
{
  "nodes": [ /* FlowNode[] */ ],
  "edges": [ /* FlowEdge[] */ ]
}
\`\`\`

## FlowNode Shape
\`\`\`typescript
{
  id: string,            // unique in this flow
  type: string,          // node type key (see below)
  position: { x, y },   // canvas coordinates
  data: {
    label?: string,      // display label
    dialogue?: string,   // what the agent says at this step
    condition?: string,  // for condition nodes
    // ... type-specific fields
  }
}
\`\`\`

## FlowEdge Shape
\`\`\`typescript
{
  id: string,
  source: string,        // source node id
  target: string,        // target node id
  sourceHandle?: string, // which output handle ("yes"/"no"/"default"/custom)
  targetHandle?: string,
  label?: string         // display label on the edge
}
\`\`\`

## Node Types

### start
The conversation entry point. Every flow has exactly one start node.
Typically carries the agent's greeting dialogue.
- data: { dialogue, globalPrompt }

### message
Agent speaks a message and waits for caller response.
- data: { dialogue, label }

### condition
Branches on a caller's response or variable value.
- data: { condition, label }
- Outputs: "yes" (true branch) and "no" (false branch) handles

### question
Asks the caller a specific question and captures their answer into a variable.
- data: { question, variable, label }

### transfer
Transfers the call to a phone number or extension.
- data: { phoneNumber, label, transferMessage }

### webhook
Makes an HTTP call to an external URL. Can inject call data or variables.
- data: { webhookUrl, method, body, label }

### end
Terminates the conversation. Multiple end nodes are allowed.
- data: { endMessage, label }

### knowledge_base
Queries the agent's attached knowledge base for dynamic answers.
- data: { query, label }

## Global Agent Settings (\`agents.settings\` JSONB)
- \`globalPrompt\` — system-level instructions for the AI
- \`voice\` — voice name/ID for Retell or ElevenLabs
- \`language\` — ISO 639-1 code
- \`openaiSchema\` — for VoxStream: \`{ voice, tools[] }\`
- \`variables\` — array of variable definitions \`{ name, type, defaultValue }\`

## Compilation for Runtime
When an agent is called live or tested, the flow graph is compiled:
- For **Retell (OmniVoice)**: flow_data is sent directly to the Retell agent
  configuration endpoint
- For **OpenAI Realtime (VoxStream)**: \`compileRealtimePrompt()\` traverses all
  reachable nodes and builds a single instruction string
- For **ElevenLabs (HyperStream)**: WebSocket audio relay bridges the caller
  to a pre-configured ElevenLabs conversational agent

## Variable Store
Agents can define typed variables (string, number, boolean, enum) that are
filled during the conversation. Variables are referenced in dialogue as
\`{{variableName}}\`. At call end, captured values are persisted to the call record.

## Best Practices for Flow Design
- Keep flows under 30 nodes for maintainability
- Always include an \`end\` node reachable from every branch
- Use \`condition\` nodes sparingly — each branch doubles complexity
- Test with the in-builder Test Call before deploying
- Use webhook nodes only for synchronous lookups (< 5s timeout)
- Avoid circular references in the flow graph
`,
  },
];

const WORKFLOW_DOCS: KbSeedDoc[] = [
  {
    seedKey: "systemmind-wf:node-type-reference",
    title: "Workflow Node Type Reference",
    content: `# Workflow Node Type Reference

## Node Catalogue

### start
- **Purpose**: Conversation entry point
- **Count per flow**: Exactly 1
- **Inputs**: None (root node)
- **Outputs**: 1 handle → the first step of the conversation
- **Key fields**: dialogue (greeting), globalPrompt (AI system instructions)
- **Common mistake**: Setting globalPrompt here instead of in agent settings

### message
- **Purpose**: Agent speaks a prompt and waits for the caller's response
- **Inputs**: 1 (from previous step)
- **Outputs**: 1 default handle
- **Key fields**: dialogue (what to say), label (node name in canvas)
- **Tips**: Keep dialogues under 100 words; callers interrupt after ~8 seconds

### condition
- **Purpose**: Branch flow based on caller's last utterance or a variable value
- **Inputs**: 1
- **Outputs**: 2 — "yes" handle (condition true) and "no" handle (condition false)
- **Key fields**: condition (natural-language or variable comparison)
- **Example conditions**: "caller said yes", "{{score}} >= 7", "caller is interested"
- **Common mistake**: Forgetting to wire both "yes" and "no" handles to targets

### question
- **Purpose**: Ask a specific question and capture the answer into a named variable
- **Inputs**: 1
- **Outputs**: 1 (after capture)
- **Key fields**: question (dialogue), variable (the variable to capture into)
- **Tips**: Define the variable in agent settings before using it here

### transfer
- **Purpose**: Transfer the active call to a phone number
- **Inputs**: 1
- **Outputs**: 0 (call is handed off — no further nodes execute)
- **Key fields**: phoneNumber (E.164 format), transferMessage (what to say before transferring)
- **Common mistake**: Using a non-E.164 phone number; the transfer silently fails

### webhook
- **Purpose**: Call an external HTTP endpoint mid-conversation
- **Inputs**: 1
- **Outputs**: 1 (continues flow after HTTP response)
- **Key fields**: webhookUrl, method (GET/POST), body (JSON template with {{variable}} interpolation)
- **Timeout**: Must respond within 5 seconds or the node retries once then continues
- **Common mistake**: Calling slow APIs; blocking the conversation for > 8s drops the call

### knowledge_base
- **Purpose**: Query the agent's attached knowledge base for a dynamic answer
- **Inputs**: 1
- **Outputs**: 1
- **Key fields**: query (what to look up), label
- **Result**: The retrieved answer is injected as context into the AI's next response

### end
- **Purpose**: Terminate the conversation cleanly
- **Inputs**: 1
- **Outputs**: 0 (terminal)
- **Key fields**: endMessage (optional farewell)
- **Count per flow**: 1 or more; every branch must reach an end node

## Node Connection Rules
- Every non-end node must have at least one outgoing edge
- Condition nodes must have exactly 2 outgoing edges (yes + no)
- Circular flows (A→B→A) are allowed but must have an exit condition
- Orphaned nodes (no incoming or outgoing edges) are flagged by repair analysis

## Performance Benchmarks
- Optimal flow depth: 5–15 nodes
- Max recommended: 30 nodes (beyond this, repair/analysis degrades)
- Condition depth: max 5 nested conditions before conversation feels like an IVR tree
`,
  },
  {
    seedKey: "systemmind-wf:edge-conditions",
    title: "Edge Conditions and Branching Logic",
    content: `# Edge Conditions and Branching Logic

## How Edges Work
An edge connects two nodes and carries flow control from the source to the target.
At runtime, the AI voice engine evaluates which outgoing edge to follow based on
the caller's response and the node type.

## Edge Properties
\`\`\`
id: string          — unique edge identifier
source: string      — source node id
target: string      — target node id
sourceHandle: string — which output "slot" to use on the source node
targetHandle: string — which input "slot" on the target node
label: string       — display label shown on the canvas
\`\`\`

## Source Handle Values

### Default (message, question, webhook, knowledge_base, start)
- sourceHandle: \`"default"\` or \`null\`
- One edge per output; the flow continues unconditionally

### Condition node handles
- sourceHandle: \`"yes"\` — taken when the condition evaluates TRUE
- sourceHandle: \`"no"\` — taken when the condition evaluates FALSE
- Both handles MUST be wired or the repair analyser flags this as broken

### Custom handles (advanced)
- Builders can create up to 4 custom output handles for multi-branch nodes
- Identified by arbitrary string IDs; labelled via edge.label

## Condition Evaluation
Conditions are evaluated by the AI engine (GPT-4o-mini at runtime) based on:
1. The caller's most recent utterance
2. The current value of any referenced {{variable}}
3. The conversation context up to that point

### Natural-language conditions
\`\`\`
"caller said yes or agreed"
"caller expressed interest in buying"
"caller asked about pricing"
"caller wants to speak to a human"
\`\`\`

### Variable-based conditions
\`\`\`
"{{score}} >= 7"
"{{appointmentBooked}} is true"
"{{city}} is not empty"
"{{productInterest}} equals 'enterprise'"
\`\`\`

## Common Edge Patterns

### Simple linear flow
start → message → question → condition → [end | transfer]

### Qualification gate
message → condition(qualified?) → yes: book_appointment, no: end(polite_decline)

### Retry loop
question → condition(answered?) → no: question (loop back, max 2x) → yes: continue

### Escalation
message → condition(frustrated?) → yes: transfer(human), no: continue

## Edge Validation (Repair Rules)
The repair analyser flags:
- **Dangling source**: a node with no outgoing edge (except end nodes)
- **Missing condition branch**: condition node missing "yes" or "no" edge
- **Unreachable node**: a node with no incoming edge (except start)
- **Dead end loop**: cycle with no exit path to an end node
- **Transfer without phone**: transfer node with empty phoneNumber

## Debugging Edge Issues
1. Open the agent in Builder → visually trace all paths to end nodes
2. Run SystemMind → Repair Analysis for automated detection
3. Use the Test Call button (top-right of Builder) to walk through the flow
4. Check browser console for React Flow layout warnings on reconnected edges
`,
  },
  {
    seedKey: "systemmind-wf:common-patterns",
    title: "Common Workflow Patterns",
    content: `# Common Workflow Patterns

## 1. Lead Qualification Flow

**Purpose**: Qualify an inbound or outbound lead against scoring criteria.

**Typical structure**:
\`\`\`
start (greeting)
  → question (What are you looking for?)
  → question (What is your budget/timeline?)
  → condition (score >= threshold?)
    yes → message (great fit!) → question (book appointment?)
            → condition (wants booking?) → yes: webhook(cal.com) → end
                                        → no: end (follow up later)
    no  → message (not right fit) → end
\`\`\`

**Key variables**: budget, timeline, interest_level, score
**Common webhook**: POST to Cal.com to create a booking

---

## 2. Appointment Booking Flow

**Purpose**: Book a call or meeting, confirm the slot, and send confirmation.

**Typical structure**:
\`\`\`
start (greeting + purpose)
  → question (preferred date)
  → question (preferred time)
  → webhook (check availability via Cal.com API)
  → condition (slot available?)
    yes → message (confirming slot) → webhook (create booking) → end
    no  → message (suggest next slot) → [loop back]
\`\`\`

---

## 3. Customer Receptionist Flow

**Purpose**: Answer inbound calls, route to the right department.

**Typical structure**:
\`\`\`
start (company greeting)
  → message (how can I help?)
  → condition (sales inquiry?)
    yes → transfer (+15551234567)
    no  → condition (support?)
            yes → transfer (+15557654321)
            no  → message (take message) → end
\`\`\`

---

## 4. Document / Information Collection

**Purpose**: Gather structured data from a caller (intake forms, surveys).

**Typical structure**:
\`\`\`
start
  → question (field_1) → question (field_2) → question (field_3)
  → message (confirming details)
  → webhook (POST to CRM / intake system)
  → end
\`\`\`

**Tips**: Capture each answer into a named variable, post all variables via webhook at the end.

---

## 5. WhatsApp Nurture Sequence

**Purpose**: Send multi-touch WhatsApp messages over days/weeks.

**Implemented as**: A campaign with WhatsApp actions (not a flow graph).
- Campaign enrols contacts
- Executor fires WhatsApp messages at scheduled intervals
- Response handling routes through a WhatsApp session agent

---

## 6. Follow-Up After No-Show

**Purpose**: Re-engage a contact who missed an appointment.

**Typical structure**:
\`\`\`
start (personalised missed-appointment message)
  → question (would you like to reschedule?)
  → condition (yes)
    yes → [appointment booking sub-flow]
    no  → message (no problem, here's our website) → end
\`\`\`

---

## Anti-Patterns to Avoid

| Anti-pattern | Problem | Fix |
|---|---|---|
| All dialogue in globalPrompt | Ignores flow graph; AI free-forms | Use explicit nodes |
| Transfer with no fallback | Call drops on busy | Add condition → fallback message |
| Webhook as first node | Cold start latency | Move webhook after at least one message |
| >5 conditions in sequence | IVR feel; caller frustration | Flatten via AI evaluation |
| No end node on some branches | Call hangs | Always wire every branch to end |
`,
  },
  {
    seedKey: "systemmind-wf:best-practices",
    title: "Workflow Builder Best Practices",
    content: `# Workflow Builder Best Practices

## Flow Design Principles

### 1. Start simple, add complexity only when needed
- A 5-node flow that converts is better than a 25-node flow that confuses callers
- The AI voice model fills gaps — you don't need a node for every possible utterance
- Add branches only when the business outcome genuinely differs

### 2. globalPrompt is the foundation
Write a clear, directive globalPrompt in agent settings:
- Who the agent is and what company it represents
- Its primary goal in one sentence
- Tone (professional, friendly, direct)
- What to do when the caller goes off-topic
- What to do when the caller says "human" or "agent"

Example:
\`\`\`
You are Alex, a sales agent for Acme Corp. Your goal is to qualify inbound leads
and book discovery calls. Be warm and professional. If asked to speak to a human,
transfer to +15551234567. Do not discuss competitors.
\`\`\`

### 3. Name nodes and variables clearly
- Node labels: verb-noun style ("Qualify Budget", "Book Appointment", "Handle Objection")
- Variable names: camelCase, descriptive ("callerBudget", "preferredDate", "qualificationScore")
- Edge labels: short condition description ("is interested", "budget >= $1000", "no objection")

### 4. Always have a graceful exit
Every flow path must eventually reach an end node. Common graceful exits:
- "I'll have someone from our team follow up shortly."
- "Thanks for your time today. Goodbye!"
- Transfer to a human when stuck

### 5. Test before deploying
1. Use the in-builder Test Call (browser → OpenAI Realtime)
2. Walk every branch manually at least once
3. Test edge cases: caller says nothing, caller interrupts, caller gives unexpected answer
4. Use SystemMind → Repair Analysis to catch structural issues

---

## Variable Best Practices

- Define all variables in agent Settings → Variables before referencing them in nodes
- Use **enum** type for categorical answers to constrain AI extraction
- Use **boolean** type for yes/no outcomes
- Use **number** type for scores and budgets (prevents "about $5K" extraction)
- Reference variables in dialogue as \`{{variableName}}\` (double braces)
- In webhooks, interpolate in the body JSON: \`{ "budget": "{{callerBudget}}" }\`

---

## Webhook Best Practices

- Respond within **5 seconds** or the webhook node retries
- Return a JSON response; the agent can reference \`{{webhook_result}}\` in subsequent nodes
- Use POST for data-changing operations (bookings, CRM creation)
- Secure with a shared secret header; validate on your server
- Test the endpoint independently before wiring it into the flow

---

## Repair & Maintenance

### Weekly checks
- Run SystemMind → Workflow Intelligence to view health scores
- Review agents with health score < 70 for structural issues
- Check provider_usage for high error rates on specific providers

### After updating a flow
- Re-run Repair Analysis to catch any new dangling edges or orphaned nodes
- Re-deploy to Retell/ElevenLabs after saving (deployments are not automatic)
- Monitor the first 5 calls post-change for unexpected behaviour

### Performance benchmarks
| Metric | Good | Needs attention |
|---|---|---|
| Flow depth | ≤ 15 nodes | > 25 nodes |
| Condition branches | ≤ 3 levels | > 5 levels |
| Webhook count | ≤ 2 per flow | > 3 (latency risk) |
| Call completion rate | ≥ 75% | < 60% |
| Average sentiment | ≥ 0.6 | < 0.4 |
`,
  },
];

// ── Seeder entry point ─────────────────────────────────────────────────────────

export type KbSeedResult = {
  processed: number;
  remaining: number;
  failed: number;
  total: number;
};

/**
 * Seeds Architecture KB and Workflow KB documents into the systemmind executive
 * knowledge base.  Processes up to `limit` missing documents per call (default 4)
 * and returns how many remain so callers can repeat until remaining === 0.
 *
 * Repair KB is handled separately by seedRepairPlaybooks().
 */
export async function seedSystemMindKnowledgeBases(
  workspaceId: string,
  limit = 4,
): Promise<KbSeedResult> {
  const sb = supabaseAdmin as any;

  const kbs = await ensureDefaultKnowledgeBases(sb, workspaceId);
  const systemmindKb = kbs.find((k) => k.slug === "systemmind");
  if (!systemmindKb) {
    throw new Error("SystemMind knowledge base not found; run ensureDefaultKnowledgeBases first");
  }

  const apiKey = await resolveOpenAiKey(sb, workspaceId);

  const allDocs: KbSeedDoc[] = [...ARCHITECTURE_DOCS, ...WORKFLOW_DOCS];
  const total = allDocs.length;

  const { data: existingRows } = await sb
    .from("executive_documents")
    .select("id, seed_key, embedding_status")
    .eq("workspace_id", workspaceId)
    .not("seed_key", "is", null);

  const existingByKey = new Map<string, { id: string; embedding_status: string }>(
    (existingRows ?? []).map((r: any) => [
      r.seed_key,
      { id: r.id, embedding_status: r.embedding_status },
    ]),
  );

  // Missing = not present at all OR present but not successfully indexed (retry failed)
  const missing = allDocs.filter((doc) => {
    const ex = existingByKey.get(doc.seedKey);
    return !ex || ex.embedding_status !== "indexed";
  });

  const batch = missing.slice(0, limit);
  let processed = 0;
  let failed = 0;

  for (const doc of batch) {
    try {
      let docId = existingByKey.get(doc.seedKey)?.id;

      if (!docId) {
        const { data: inserted, error } = await sb
          .from("executive_documents")
          .insert({
            workspace_id:     workspaceId,
            knowledge_base_id: systemmindKb.id,
            source_type:      "seed",
            title:            doc.title,
            seed_key:         doc.seedKey,
            embedding_status: "pending",
          })
          .select("id")
          .single();
        if (error || !inserted) throw new Error(error?.message ?? "Insert failed");
        docId = inserted.id;
      }

      await indexTextDocument(sb, {
        documentId:  docId,
        workspaceId,
        text:        doc.content,
        apiKey,
      });

      processed++;
    } catch (e) {
      console.error(`[SystemMindKbSeed] ${doc.seedKey} failed:`, (e as Error)?.message);
      failed++;
    }
  }

  return {
    processed,
    remaining: Math.max(0, missing.length - processed),
    failed,
    total,
  };
}
