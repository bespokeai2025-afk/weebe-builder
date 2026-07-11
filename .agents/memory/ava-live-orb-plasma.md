---
name: Live "AI energy" visuals (plasma orb) technique
description: How to build premium animated/live UI visuals in WEBEE given no animation libraries are installed
---

# Live "AI energy" visuals in WEBEE (plasma orb technique)

**Constraint:** WEBEE has **no animation libraries installed** — `three`/`@react-three/fiber`,
`framer-motion`, and `gsap` are all absent. Any animated/"live" UI visual (e.g. the Call Ava
active-call orb, `src/components/landing/AvaLiveOrb.tsx`) must be **pure CSS + SVG**. Don't reach
for a motion lib; verify with the packager before assuming one exists.

**Technique that reads as a genuinely "live", constantly-reshaping energy visual** (used for the
plasma ring that matched the reference: hollow swirling blue→purple electric ring, smoky wisps):
- Animated SVG `feTurbulence` (`fractalNoise`) + `feDisplacementMap` applied to a group of stroked
  circles → the ring warps, breaks into arcs, and churns organically. Animate `baseFrequency` and
  the displacement `scale` for constant reshaping.
- A **`userSpaceOnUse` linear gradient** (blue↔purple) that the ring rotates *through* (CSS rotate
  on the `<g>`) → a shimmering color sweep, not a rigidly rotating gradient.
- CSS `breathe` (scale) + `box-shadow` halo for the pulse; a faint radial center-glow keeps the
  center hollow but with depth.

**Non-obvious gotchas:**
- **CSS cannot stop SMIL.** `prefers-reduced-motion` via CSS won't freeze `<animate>` elements. To
  respect it, conditionally **don't render** the `<animate>` children (a `matchMedia` hook, default
  motion-on) — the static displaced ring still looks good.
- **Drive intensity per state via React-rendered SMIL `dur`/`values`.** Passing different
  `feDisplacementMap` `scale` values + `dur` per state (connecting/speaking/listening/ended) makes
  "speaking" visibly reshape harder/faster. Displacement amount can't be changed with CSS, so this
  must come from the SVG attrs.
- SSR-safe: sanitize `useId()` output for all gradient/filter ids (multiple orbs won't collide);
  no `Math.random` (deterministic sparks); no `window` at render (only in effect).

**Verify visually via the mockup sandbox** (component is dependency-free): copy it into
`artifacts/mockup-sandbox/src/components/mockups/<folder>/`, add a small showcase rendering all
states, restart the "artifacts/mockup-sandbox: Component Preview Server" workflow, screenshot
`/__mockup/preview/<folder>/<Component>`, then delete the scratch files. A still can't show motion,
but confirms composition + that states differ + no render error.
