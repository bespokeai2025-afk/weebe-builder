---
name: Production build — Node.js built-ins must be external
description: How to fix "X is not exported by __vite-browser-external" build errors caused by server-only modules leaking into the client bundle.
---

## The Problem

Server-only files that import Node.js built-ins (`child_process`, `util`, `fs`, `path`, `os`, `crypto`) can leak into the client Rollup bundle via the import chain:

```
React component → library file → server-fn file → dynamic import("./X.server")
```

Even with `/* @vite-ignore */` on the dynamic import, Rollup v4 still traces and bundles the target module into a code-split chunk for the client. When it does, it encounters `import { promisify } from "util"` — but `util` has been externalized to `__vite-browser-external` which doesn't export `promisify`, causing a hard build failure.

## The Fix

In `vite.config.ts`, under `vite.build.rollupOptions.external`, list all Node.js built-ins that any server-only file uses:

```ts
build: {
  rollupOptions: {
    external: [
      "child_process", "util", "fs/promises", "fs",
      "path", "os", "crypto", "stream", "http",
      "https", "net", "tls", "events", "buffer",
    ],
  },
},
```

This prevents Rollup from ever attempting to bundle browser stubs for these modules. The dynamic imports still work at runtime on the server — Node.js resolves them natively.

**Also add `/* @vite-ignore */`** to all dynamic imports of `.server` files from files that are in the client bundle chain. Belt + suspenders.

## The Secondary Error

`growthmind.video-studio.ts` had two dynamic imports referencing `./growthmind.ai-router.server` — a non-existent file. The actual file is `./model-router.server`. This caused the SSR build to fail with "Could not resolve".

**Why:** Old filename from a refactor; never caught in dev because `/* @vite-ignore */` suppressed Vite's analysis. Only surfaces during the production SSR build.

## Key Files

- `vite.config.ts` — `build.rollupOptions.external` list
- `src/lib/growthmind/video-assembly.server.ts` — the Node-only ffmpeg assembly service
- `src/lib/growthmind/video-job-poller.ts` — calls video-assembly via dynamic import
- `src/lib/growthmind/growthmind.video-studio.ts` — also calls video-assembly + model-router
