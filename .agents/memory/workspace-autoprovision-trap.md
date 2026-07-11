---
name: Workspace auto-provision trap
description: Login resolver must never auto-provision a workspace on a failed membership query — it silently orphans an existing tenant's data.
---

# Workspace auto-provision trap

**Rule:** In `resolveWorkspaceIdForUser`, auto-provisioning a personal workspace is only allowed
after a **successful** (error-free) membership query that returned zero rows, double-checked with
the service-role client. A query error must throw a retryable error, never provision.

**Why:** A transient membership-lookup failure (Supabase blip / RLS hiccup) used to fall through to
`autoProvisionWorkspace`, which created a blank workspace AND repointed
`profiles.default_workspace_id` at it. The customer (WeBuyAnyHouse, July 9 2026) then logged into an
empty workspace and reported "all my setup data disappeared" — the data was intact in the original
workspace the whole time.

**How to apply:**
- Symptom "my data vanished" → check `profiles.default_workspace_id` vs the user's oldest
  `workspace_members` row; look for an empty duplicate workspace with the auto-provision slug
  pattern `<name>-<first-6-of-user-id>`.
- Repair = flip `default_workspace_id` back + delete the empty duplicate (children first:
  workspace_onboarding, telephony_configs, workspace_settings, workspace_members, then workspaces).
- Supabase query results must always be checked for `{ error }` before treating `data == null/[]`
  as "no rows" anywhere a write/provision decision hangs on it.
