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
