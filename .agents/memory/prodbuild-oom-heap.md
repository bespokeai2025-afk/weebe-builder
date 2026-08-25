---
name: Prod build OOM with oversized Node heap
description: vite build silently killed mid-SSR when max-old-space-size matches total machine RAM
---
Rule: keep the build script's `--max-old-space-size` well below total machine RAM (4096 on the 8GB Replit box), because the dev server workflow already holds ~4GB.

**Why:** With `--max-old-space-size=8192` on an 8GB machine, `vite build` was OOM-killed by the kernel during the SSR phase — the workflow just showed FAILED with no error line, the log ended mid-deprecation-warnings, and `dist/server` stayed empty. Looks like a mysterious build failure but is memory pressure.

**How to apply:** If prodbuild FAILS with no error text and only one "built in" line (client done, SSR missing), suspect OOM first. Even with heap=4096, the SSR build OOMs if the dev server (Start application) is running and holding ~4-5GB — stop/kill the dev workflow first, run prodbuild, then restart dev. Also note: background/nohup/setsid processes do NOT survive between agent bash calls here — run long builds via the workflow with a long `workflow_timeout`, not detached shells.

Update Aug 2026: after the voice-gateway merge the SSR build OOMs at 4096MB even with
the dev server stopped; build script heap is now 5632MB (machine has 7GB — keep dev
server stopped during prodbuild or it OOMs again).

Update Aug 2026: the workspace TypeScript language server can retain ~2GB even after
the app workflow is stopped. If the 5632MB build still ends silently at SSR with the
dev server stopped, check available memory before blaming the source: temporarily stop
the mockup Vite workflow and terminate the stale project tsserver/language-server
processes, then rerun the existing build workflow. Restore paused previews afterwards.

**Why:** the build needs headroom beyond its Node heap; an oversized editor indexer caused
the same no-error SSR kill even after the normal dev-server safeguard was followed.

**How to apply:** use this only for the characteristic client-success/SSR-silent failure,
not a compiler error. Confirm memory is released before retrying rather than raising the
heap cap further.

Confirmed Aug 25, 2026: on the 7.8GB workspace, the merged voice build still OOMs at
4096MB with previews stopped; after terminating the stale TypeScript server, the existing
5632MB prodbuild workflow completes successfully.
