---
name: TanStack server fn dynamic import must be a string literal
description: Never dynamic-import server logic via a variable specifier inside a createServerFn handler — it works in dev but breaks the production Rollup build.
---

# createServerFn dynamic imports must use literal specifiers

Inside a `createServerFn(...).handler`, always write the dynamic import with a **string literal**:

```ts
const { doThing } = await import("@/lib/foo/foo.server");   // ✅
```

Never hoist the path into a variable/const and import that:

```ts
const SERVER = "@/lib/foo/foo.server";
const { doThing } = await import(SERVER);                    // ❌ breaks prod build
```

**Why:** `vite build` (Rollup) can only statically resolve a non-variable specifier. With a variable
specifier the `@/` alias (resolved at build time via tsConfigPaths) survives to runtime, and Node
cannot resolve `@/...` — every call throws in production. It *appears* to work in dev only because
Vite's SSR module runner resolves aliases per-request.

**How to apply:** any `await import(...)` in a server fn / SSR module takes a literal. If you want
to avoid repetition, repeat the literal in each handler rather than factoring it into a const.
