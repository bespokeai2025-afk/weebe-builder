## Scope

Pure additive extension. No changes to auth, agent builder, deployment, or existing per-agent Cal.com fields. "Workspace" = user (current model) — every new table is keyed by `user_id` with RLS, same pattern as `agents`.

## What gets added

### 1. Database (one migration)

- `workspace_calendar_settings` — one row per user. Holds the workspace-level Cal.com API key, default event type id, timezone, booking prefs (buffer, min notice, working hours).
- `calendar_connections` — one row per Google Calendar surfaced from Cal.com. Fields: `user_id`, `calcom_credential_id`, `external_id`, `email`, `name`, `is_availability` bool, `is_primary_booking` bool, `read_only`, `last_synced_at`.
- `calcom_event_types` — cached list from Cal.com. Fields: `user_id`, `calcom_event_type_id`, `title`, `slug`, `length_minutes`, `active` bool.
- `bookings` — every booking made through Retell. Fields: `user_id`, `agent_id` (FK to existing `agents`, nullable), `calcom_booking_id`, `attendee_name`, `attendee_email`, `attendee_phone`, `start_at`, `end_at`, `status` (`confirmed|cancelled|no_show`), `event_type_id`, `retell_call_id`, `raw` jsonb.

All four: `user_id`-scoped RLS, GRANT to `authenticated` + `service_role`, `updated_at` trigger via existing `touch_updated_at`.

Existing `agents.settings.calcom` (per-agent key/event-type) stays as override. Resolution at call time: per-agent value → workspace value.

### 2. Server functions (`src/lib/calendar/calendar.functions.ts`)

All protected with `requireSupabaseAuth`:
- `getWorkspaceCalendarSettings` / `saveWorkspaceCalendarSettings`
- `syncCalcomConnections` — hits Cal.com `/v2/calendars` + `/v2/event-types` with the workspace key, upserts both tables
- `setCalendarFlags` — toggle availability / primary booking
- `listMyBookings`

### 3. Public Retell endpoints (`src/routes/api/public/retell/`)

Three endpoints Retell custom-functions call:
- `POST /api/public/retell/availability` → body `{ agent_id, date_range, timezone }` → returns `{ slots: [{start, end}] }`
- `POST /api/public/retell/book` → body `{ agent_id, start, name, email, phone, notes }` → creates Cal.com booking, inserts `bookings` row, returns `{ booking_id, start, end, confirmation_code }`
- `POST /api/public/retell/cancel` → body `{ booking_id, reason }`

Security: each request includes `x-retell-signature` (HMAC of body with `RETELL_WEBHOOK_SECRET`). Verified with `timingSafeEqual`. `agent_id` resolves the owning user → loads their Cal.com key. Zod-validated. No PII in error responses.

### 4. UI

New route `src/routes/_authenticated/settings.calendar.tsx` (matches existing flat-route convention). One page, sections:
- **Cal.com workspace connection** — API key input, "Test & Sync" button, status, timezone select.
- **Connected calendars** — cards for each row in `calendar_connections`, toggles for "use for availability" / "primary booking destination".
- **Event types** — table of synced event types with active toggle + "set as default".
- **Booking preferences** — buffer minutes, min notice hours, working hours.
- **Recent bookings** — last 20 from `bookings` table.

Header link added to `/builder` and `/my-agents` ("Calendar"). Uses existing `Button`, `Card`, `Tabs`, `Switch`, `Input`, `Select`, `toast` — no new design tokens.

### 5. Auto-wire Retell custom functions on deploy

Extend existing `deployRetellAgent` in `src/lib/builder/retell.functions.ts`: when deploying, if workspace has a Cal.com key configured, attach 3 custom functions (`check_availability`, `book_appointment`, `cancel_appointment`) pointing at `https://webespokegenbuilder.lovable.app/api/public/retell/*` with the HMAC secret. Skipped if user has no Cal.com setup. This is the only edit to existing code.

## File map

Add:
- `supabase/migrations/<ts>_calendar.sql`
- `src/lib/calendar/calendar.functions.ts`
- `src/lib/calendar/calcom.server.ts` (Cal.com REST helper)
- `src/lib/calendar/retell-signature.ts`
- `src/routes/api/public/retell/availability.ts`
- `src/routes/api/public/retell/book.ts`
- `src/routes/api/public/retell/cancel.ts`
- `src/routes/_authenticated/settings.calendar.tsx`
- `src/components/calendar/WorkspaceCalcomCard.tsx`
- `src/components/calendar/ConnectedCalendarsList.tsx`
- `src/components/calendar/EventTypesTable.tsx`
- `src/components/calendar/BookingPrefsForm.tsx`
- `src/components/calendar/RecentBookingsTable.tsx`

Edit (minimal):
- `src/lib/builder/retell.functions.ts` — add `attachBookingTools` helper, call from `deployRetellAgent`
- `src/routes/_authenticated/my-agents.tsx` + `src/routes/_authenticated/builder.tsx` — one nav link each

Secret to add: `RETELL_WEBHOOK_SECRET` (for HMAC). I'll request it before wiring the Retell side.

## Out of scope (call out if you want it)

- Cal.com Platform OAuth (managed users). Today users connect Google inside their Cal.com account; we deep-link.
- Outlook — schema supports it (`provider` column on `calendar_connections`) but no UI this pass.
- Real workspaces table / team sharing.
- SMS reminders / no-show tracking beyond a `status` field.

## Order I'll build in

1. Migration (you approve)
2. Server fns + Cal.com helper
3. Public Retell endpoints
4. Settings UI
5. Wire deploy-time custom function attachment
6. Add nav links

Confirm and I'll start with the migration.