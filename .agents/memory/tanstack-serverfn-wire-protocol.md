---
name: Replicating TanStack Start server-fn calls from Node
description: How to call /_serverFn endpoints from a plain Node script with the exact browser wire contract (seroval), since serverFnFetcher needs Start context.
---

# Calling TanStack Start server fns from a plain Node script

Used for browser-contract e2e verification when the screenshot tool can't log in
(see `.local/browser-contract-test.mjs` for a working reference implementation).

- **Don't use `serverFnFetcher`** from `@tanstack/start-client-core` in Node: it calls
  `getDefaultSerovalPlugins()` → `getStartOptions()` which resolves to the *server* isomorphic
  branch outside a browser and throws "No Start context found in AsyncLocalStorage".
- Replicate the wire protocol directly instead:
  - URL: `/_serverFn/<base64url(JSON {file:"/src/....ts?tss-serverfn-split", export:"<name>_createServerFn_handler"})>`.
    In dev, discover real IDs by fetching the vite-transformed module and regexing
    `createClientRpc` ids.
  - Request: `JSON.stringify(await toJSONAsync({ data }, { plugins: defaultSerovalPlugins }))`
    (`seroval` + `@tanstack/router-core` exports). POST = JSON body; GET = `?payload=` via
    router-core `encode()`.
  - Headers: `Authorization: Bearer <supabase access token>`, `Cookie: wb_workspace_id=<ws>`,
    `Sec-Fetch-Site: same-origin` (CSRF middleware), `x-tsr-serverFn: true`,
    `accept: application/json` (avoids framed/streaming responses).
  - Response (`x-tss-serialized: true`): seroval cross-JSON —
    `fromCrossJSON(json, { plugins: defaultSerovalPlugins, refs: new Map() })` yields
    `{ result, error, context }`; throw on `error`.
- Auth session: Supabase password grant with a throwaway user created via service role.
