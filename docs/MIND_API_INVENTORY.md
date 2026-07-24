# WEBEE Mind API — Endpoint & Tool Inventory

Mobile-compatible, versioned, workspace-scoped REST surface for the Mind layer
(HiveMind COO, GrowthMind CMO, SystemMind CTO, AccountsMind CFO). All endpoints
live under `/api/v1/minds/*` and share ONE implementation with the web app —
every route delegates to the same core services/registry the web server
functions use; no duplicated business logic.

## Authentication

Two credential types, both via `Authorization: Bearer <token>`:

| Credential | Who | Notes |
|---|---|---|
| **Supabase user access token** (JWT) | First-party mobile app | Validated via `auth.getClaims`. All data access goes through a user-JWT-bound Supabase client, so RLS + the exact web permission checks apply. Workspace: `X-Workspace-Id` header (membership verified fail-closed) or the user's default workspace. Rate limit 60 req/min per user. |
| **Workspace HMAC API key** (existing Developer API key) | Server integrations | Same HMAC scheme as the rest of `/api/v1` (`key_id.timestamp.signature`), needs the `minds:read` / `minds:execute` permission on the key. Carries **no user identity** — user-scoped endpoints refuse it with 403. Rate limit 60 req/min per key. |

Error shape everywhere: `{ "error": "message" }` with proper HTTP status
(400 validation, 401 bad credentials, 403 permission/membership, 404 not found,
409 conflict, 429 rate limit + `Retry-After`, 5xx server).

## Endpoints

| Method & Path | Auth | Purpose |
|---|---|---|
| `GET /api/v1/minds/tools` | user or API key (`minds:read`) | Full tool catalog with per-user `allowed`/`deniedReason` flags (entitlement-gated tools are not-allowed for API keys). |
| `POST /api/v1/minds/tools/execute` | **user only** (`minds:execute`) | Execute a registry tool. Body `{ tool, input }`. Full guard chain: platform check, membership, entitlements, mode gate, zod input validation, sensitive-approval requirement, audit lifecycle. Returns real status: `completed` (200), `approval_required` (202), `blocked` (403), `failed` (500) + `execution_id` audit ref. Explicit approval can NEVER be passed here. |
| `GET /api/v1/minds/conversations?mind=…` | user only | List the caller's conversations for a Mind (`include_archived`, `limit`). |
| `POST /api/v1/minds/conversations` | user only | Get-or-create the ACTIVE conversation for a Mind + recent messages (same call as web chat mount). Body `{ mind, message_limit? }`. |
| `PATCH /api/v1/minds/conversations/:id` | user only | Rename / set `current_objective`. |
| `DELETE /api/v1/minds/conversations/:id` | user only | Archive ("clear chat" — history preserved, never deleted). |
| `GET /api/v1/minds/conversations/:id/messages` | user only | Paginated history (`before` ISO cursor, `limit` ≤ 500, `has_more`). |
| `POST /api/v1/minds/conversations/:id/messages` | user only | Append ≤ 10 messages; `client_msg_id` retries are skipped idempotently. |
| `GET /api/v1/minds/tasks` | user or API key | HiveMind tasks + recent events + unread/badge counts. User tokens honor assigned-records-only visibility; workspace keys see workspace scope. |
| `POST /api/v1/minds/tasks` | user only | Create a manual task (mode-gated: blocked in Observe mode, same as web). |
| `PATCH /api/v1/minds/tasks/:id` | user only | Update status / priority / assignment / due date / title / description. |
| `GET /api/v1/minds/actions` | user or API key | Approval queue (`?status=`, `limit`), pending count, authoriser identity enrichment. |
| `POST /api/v1/minds/actions/:id/approve` | user only | Shared approval core: mode gate, sensitive-category entitlement (fail closed), atomic single-use CAS consume, post-consume re-validation, audited execution, recommendation follow-through. 409 if already processed. |
| `POST /api/v1/minds/actions/:id/reject` | user only | Reject + reflect outcome onto the source executive recommendation. |
| `GET /api/v1/minds/notifications` | user only | In-app notifications for the caller (`unread_only`, `severity`, `limit`). |
| `POST /api/v1/minds/notifications` | user only | Mark read — `{ ids: [...] }` or `{ all: true }`. |
| `GET /api/v1/minds/summary` | user or API key | One-call mobile home screen: executive recommendations + linked actions, open recommendation count, pending approvals, open tasks, unread events, badge. |

Existing `/api/v1` developer endpoints (calls, leads, contacts, campaigns, …)
are unchanged; the two new API-key permissions are `minds:read` and
`minds:execute`.

## Mind Tool Registry (executable via `POST /minds/tools/execute`)

All tools are registered centrally (`src/lib/minds`), platform-tagged
(`web | mobile | api | system`) and audited. **Sensitive** tools cannot run
directly — execution returns `approval_required` and creates a pending
HiveMind action to approve via the actions endpoints.

### HiveMind (COO)
| Tool | Access | Notes |
|---|---|---|
| `hivemind.create_task` | write | Create an internal task. |
| `hivemind.create_followup_campaign` | write | HexMail follow-up campaign draft (+ optional enrolment). |
| `hivemind.enroll_leads_in_campaign` | write | Enroll leads into an existing campaign. |
| `hivemind.move_pipeline_stage` | write | Move leads across pipeline stages. |
| `hivemind.assign_knowledge_base` | write | Assign a KB to an agent. |
| `hivemind.register_resend_webhook` | write | Register the Resend deliverability webhook. |

### GrowthMind (CMO)
| Tool | Access | Notes |
|---|---|---|
| `growthmind.sync_ad_stats` | write | Refresh connected ad platform stats. |
| `growthmind.video_campaign` | write | Video campaign draft (high cost). |
| `growthmind.growth_campaign` | write | Coordinated growth campaign. |
| `growthmind.publish_content` | write | Publish approved content to a connected social account. |
| `growthmind.create_content_project` | write | Content Studio project draft. |
| `growthmind.submit_content_for_approval` | write | Publishes only after human approval. |
| `growthmind.run_campaign_proposals` | write | Proposal engine from live performance data. |

### SystemMind (CTO)
| Tool | Access | Notes |
|---|---|---|
| `systemmind.send_workflow_draft_to_builder` | write | Hand a draft to the Workflow Builder. |
| `systemmind.activate_lead_intake_workflow` | write | Webform → auto-call intake activation. |
| `systemmind.activate_systemmind_automation` | write | Activate an approved automation draft. |
| `systemmind.generate_report` | write | Analytics report generation. |
| `systemmind.build_session` | write, **sensitive** (`systemmind_approval`) | Build Workspace sessions; applying goes through approval. |

### AccountsMind (CFO)
| Tool | Access | Notes |
|---|---|---|
| `accountsmind.save_invoice_draft` | write (`billing`) | Create/update draft invoice. |
| `accountsmind.issue_invoice` | write, **sensitive** (`billing`) | Locks invoice + assigns final number. |
| `accountsmind.record_invoice_payment` | write, **sensitive** (`billing`) | Needs authorised evidence or approval. |

> The authoritative, always-current list (incl. per-user allowance) is
> `GET /api/v1/minds/tools` — this table is a point-in-time snapshot.

## Parity guarantees
- **Permissions**: user-token requests run under RLS with the same
  `resolvePermissions` / entitlement checks as web server functions
  (fail-closed). UI hiding is never the enforcement layer.
- **Audit**: tool executions and approvals write the same audit rows
  (`executionId` returned) as web.
- **No secrets**: responses never include credentials; the catalog strips
  `inputSchema`/`run` internals.
- **Approvals**: sensitive actions can only be approved through the CAS
  approval endpoints — no bypass flags accepted from clients.
