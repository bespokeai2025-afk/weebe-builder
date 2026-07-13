---
name: Vite envPrefix can bake secrets into the client bundle
description: Widening envPrefix to a secret-bearing prefix exposes those env vars in the client build; narrow to the exact non-secret var name.
---

# Vite envPrefix is a client-exposure boundary, not just an SSR convenience

**Rule:** Never add a prefix to `envPrefix` that matches any secret. `envPrefix`
is a plain string-prefix match, so a full variable name works as an entry —
narrow to the exact non-secret var (e.g. `"WEBESPOKE_API_BASE_URL"`), never the
family prefix (e.g. `"WEBESPOKE_"` would match `WEBESPOKE_ADMIN_PASSWORD`).

**Why:** Everything matching `envPrefix` is exposed via `import.meta.env` and can
be inlined into the public client bundle at build time. An external (Cursor) push
once widened it to `WEBESPOKE_` to make one URL var readable in SSR — which would
have shipped the WeeBespoke admin password to every browser on the next publish.

**How to apply:** When merging externally-authored pushes, review vite config /
env changes for client-exposure risk before deploying. After a prod build, verify
with a grep of `dist/client/` for the secret's variable name. Server-only code
should read secrets via `process.env` (or the .env-file reader in
`webespoke-env.server.ts`), never via `import.meta.env`.
