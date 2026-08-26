---
name: HiveMind full-viewport backdrop collisions
description: Prevent decorative fixed viewport layers from being mistaken for HiveMind collision controls.
---

HiveMind's collision detector must ignore full-viewport decorative layers as well as its own overlay.

**Why:** A `fixed inset-0` backdrop has bottom-right geometry like a floating control. Reserving its full height forces a correctly bottom-anchored HiveMind wrapper to clamp at the top of the screen.

**How to apply:** When adding or changing collision detection, exclude known non-interactive overlays and any element whose measured rectangle covers the viewport. Keep a regression test for a full-screen rectangle alongside real right-rail and bottom-control cases.