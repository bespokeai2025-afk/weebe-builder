---
name: HiveMind full-viewport backdrop collisions
description: Prevent decorative fixed viewport layers from being mistaken for HiveMind collision controls.
---

HiveMind's resting lower-right anchor must remain independent of collision reserves and saved positions from a prior coordinate system. The collision detector must also ignore full-viewport decorative layers and its own overlay.

**Why:** A `fixed inset-0` backdrop has bottom-right geometry like a floating control. Reserving its full height, or restoring a position calculated with those reserves, forces a correctly bottom-anchored HiveMind entity to clamp at the top of the screen.

**How to apply:** Treat the lower-right corner as the default; calculate bounds only to keep user drags visible. When that coordinate model changes, invalidate old saved offsets. Exclude known non-interactive overlays and any element whose measured rectangle covers the viewport, and keep a regression test for both an old offset and a full-screen rectangle.