---
name: TanStack Start useServerFn data wrapping
description: useServerFn-wrapped server functions require { data: input } wrapping at every call site — bare fn(input) silently passes undefined to inputValidator.
---

# TanStack Start useServerFn — `{ data: input }` wrapping required

## The Rule
Every call to a `useServerFn`-wrapped server function that passes input MUST wrap the input as `{ data: input }`:

```typescript
// WRONG — inputValidator receives undefined
await saveSiteFn({ id, url, keywords });

// CORRECT
await saveSiteFn({ data: { id, url, keywords } });
```

**Why:** In TanStack Start v1.167, the returned function signature is `(opts) => ...` and it reads `opts?.data` (source: `node_modules/@tanstack/start-client-core/dist/esm/createServerFn.js` line 46). Passing the input directly means `opts.data` is `undefined`, which then hits `inputValidator` as `undefined` → Zod throws `expected object, received undefined`.

**Functions with no input** (e.g. `await getSiteFn()`) are unaffected.

**GET functions with inputValidator** also fail — GET functions serialize input as URL search params, not JSON body. Convert any GET server function that has `inputValidator` to POST.

## Validator method name flipped by version
- Around v1.167–early 1.168: `.inputValidator()` was the only valid chain method — `.validator()` did not exist and crashed at runtime.
- As of `@tanstack/react-start` ~1.168.27 (July 2026): `.inputValidator()` still works but is **deprecated**; the build emits warnings recommending `.validator()`.
- **How to apply:** don't mass-rename — `.inputValidator()` warnings are cosmetic and safe. For new code on ≥1.168.27, prefer `.validator()`. Always check the installed version before assuming which name is valid.

## How to apply
- Any `useServerFn` call where you pass arguments: wrap as `{ data: { ... } }`.
- When defining new server functions with `inputValidator`, verify the call site uses `{ data: ... }`.
- When converting a GET function that needs validated input, change `method: "GET"` to `method: "POST"`.

## Files fixed in GrowthMindSEO.tsx
- `saveSiteFn`, `savePropFn`, `connectFn`, `syncGscFn`, `fetchQueryFn`, `aiRespFn`, `saveAiRecsFn`, `getAuthUrlFn` — all wrapped.
- `getGscAuthUrl` in `growthmind.seo.ts` converted from GET to POST.
