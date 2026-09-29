# SIP setup in Phone Numbers

## UI
- `PhoneNumberWorkspace.tsx`: connections slot below the number directory.
- `phone-numbers.tsx`: Connect SIP trunk opens the form in the right panel; successful directory saves select the new number. SIP records get a read-only SIP-specific detail panel, not Twilio webhook controls.
- `SipNumberForm.tsx`: carrier number, display name, termination URI, optional credentials, compatible agent, and call direction. Pending, unavailable-agent, failure, and partial-success states are explicit. Password is cleared after each attempt and never written to browser storage.

## Backend
- `sip.functions.ts`: authenticated, active-workspace-scoped agent lookup and import wrapper around the existing `importSipPhoneNumberService`.
- Reuses the existing production credential resolution and Retell import API; no new carrier integration or database migration.
- Workspace directory stores provider `retell_sip` (the existing database provider column is text), the number, display name, and agent. SIP passwords and usernames are not stored in the directory.
- Saves the agent's phone setting through the existing service. Partial persistence failures produce warnings instead of inviting another import.
- Existing deployment-dialog SIP flow is retained for compatibility. Imported numbers from before this change are not automatically backfilled into the directory.

## Limitations
- Import success is not a live SIP connectivity check. No carrier configuration, purchase, real import, or test call was performed during development.
- Provider-side import and database writes are separate operations, not an atomic transaction. Partial failures require administrator reconciliation. Concurrent imports are still subject to provider duplicate handling; the directory duplicate check is not a database uniqueness constraint.
- SIP detail intentionally does not offer the generic Twilio edit/delete/assignment controls. Carrier routing and existing provider-side agent changes remain in the established carrier/deployment flows.
- Test coverage uses mock provider/database responses. A real workspace smoke test requires an approved number and carrier configuration.
