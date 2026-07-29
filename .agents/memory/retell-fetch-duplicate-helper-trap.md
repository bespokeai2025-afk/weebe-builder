---
name: Duplicate retellFetch helper trap
description: Why "Invalid API Key" 401s appeared on qualification calls despite valid keys — a local retellFetch duplicate with a different signature.
---

# Duplicate retellFetch helper trap

- The shared Retell client is `retellFetch(path, body, method, overrideApiKey)` in `src/lib/providers/retell/client.server.ts`. A file-local duplicate existed in the leads dashboard functions with signature `(path, body, apiKey)`.
- **What happened:** a session "fixed the argument order" of call sites to the 4-arg shared form while the file still used its local 3-arg helper — so the literal string `"POST"` was sent as the Bearer API key → Retell 401 "Invalid API Key" on every qualification call, even though the workspace key in `workspace_settings.retell_workspace_id` was fully valid (owned the agent and from-number).
- **Rule:** never keep file-local duplicates of shared API helpers; always import the shared client. When a call-site "signature fix" is made, verify which symbol is actually in scope (grep for a local `function retellFetch` in the same file).
- **Debug tip:** Retell validates the request body schema BEFORE auth — probing `create-phone-call` with `{}` returns 400 for ANY key. To test key validity without placing a call, send a full-shape payload with an unowned from_number: bad key → 401, valid key → 404 "not found in phone-number".
