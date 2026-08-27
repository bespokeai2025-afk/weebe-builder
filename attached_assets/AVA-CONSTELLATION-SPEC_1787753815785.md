# Ava Constellation Visual — Complete Technical Specification

Source of truth: `src/components/AvaSignal.tsx` on webespokeai.com (1054 lines, unchanged).
Verbatim copies shipped alongside this document:

- `AvaSignal.original.tsx` — byte-for-byte copy of the live component
- `AvaSignal.portable.tsx` — identical rendering code, project imports replaced by props
- `avaAudioStub.ts` — drop-in replacement for the audio engine dependency

Nothing in the visual was redesigned, simplified or reinterpreted.

---

## 1. Files involved

| File | Role |
|---|---|
| `src/components/AvaSignal.tsx` | **The entire visual.** Canvas 2D renderer, all particle logic, core kernel, constellation lines. |
| `src/lib/avaAudio.ts` | Supplies `avaLevels.agent` / `avaLevels.mid` (0..1) from the live Retell/LiveKit remote AnalyserNode. Only 2 numbers are consumed. |
| `src/components/AvaCallModal.tsx` | Provides `step`, `agentSpeaking`, `bookingState` via context. Purely state, no drawing. |
| `src/components/AvaHeroExperience.tsx` | Mounts `<AvaSignal className="… w-[15rem] sm:w-[17rem] lg:w-[23rem] h-[17rem] sm:h-[19rem] lg:h-[25rem]" hovered dark />` |
| `src/index.css` | Optional atmosphere only (`.ava-spotlight` graphite haze, mobile navy hero). Not part of the canvas. |

## 2. Technology

- **React 18** function component + `useEffect`, `useRef`, `useState`.
- **HTML5 Canvas 2D** (`getContext("2d", { alpha: true })`). **No WebGL, no Three.js, no SVG, no particles.js, no shaders, no CSS particles, no images.**
- Rendering is fully procedural, redrawn every frame with `clearRect`.
- Markup is literally: `<div ref=wrap class="relative {className}" aria-hidden="true"><canvas class="block w-full h-full"/></div>`.
- Tailwind is used only for the wrapper sizing classes; any equivalent CSS works.

## 3. Component API

```tsx
<AvaSignal
  className="w-[23rem] h-[25rem]"   // wrapper size drives canvas size
  hovered={boolean}                  // desktop hover response
  dark={boolean}                     // true on navy backdrop, false on white
  step="idle|connecting|live|complete|error"
  agentSpeaking={boolean}
  bookingState="idle|processing|confirmed|failed"
/>
```

Internal phase mapping: `connecting` → connecting; `live` + speaking → speaking; `live` → listening; `complete`/`error` → ended; otherwise idle.

## 4. Canvas sizing, DPR, loop, lifecycle

```js
const rect = wrap.getBoundingClientRect();
w = max(1, rect.width); h = max(1, rect.height);
dpr = Math.min(window.devicePixelRatio || 1, 2);   // capped at 2
canvas.width  = Math.round(w * dpr);
canvas.height = Math.round(h * dpr);
canvas.style.width = w + "px"; canvas.style.height = h + "px";
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);            // draw in CSS pixels
```
- `ResizeObserver` on the wrapper re-runs `resize()`.
- Loop: `requestAnimationFrame(frame)`; `dt = Math.min(0.05, (now-last)/1000)` (50 ms clamp), accumulator `t`.
- `visibilitychange`: cancels the RAF when hidden, restarts and resets `last` when visible.
- Cleanup: `cancelAnimationFrame`, `ro.disconnect()`, remove the visibility listener. Effect deps: `[reduced, dark]` — particles are re-seeded only when those change.
- `prefers-reduced-motion: reduce` watched via `matchMedia`; drives `reduced`.

Geometry each frame:
```js
cx = w*0.5;  cy = h*0.5;
R  = Math.min(w,h) * 0.30;    // master radius unit — EVERYTHING scales from R
ox = R*0.04;  oy = -R*0.03;   // deliberate off-centre offset
```

## 5. Global easing / modulators

```js
ease = (c, target, tau, dt) => c + (target-c)*(1 - Math.exp(-dt/tau));  // frame-rate independent
hover  → target 1 when hovered && idle; tau 0.14 rising / 0.22 falling
energy → target: connecting 0.45, listening 0.18, speaking 0.55, else 0; tau 0.35
green  → success blend; tau 0.16 rising / 0.5 falling
voice = (speaking ? min(1, avaLevels.agent) : 0);  mid = speaking ? avaLevels.mid : 0

breath = 1 + (sin(t*0.33)*0.55 + sin(t*0.19+1.7)*0.3 + sin(t*0.51+0.4)*0.15) * 0.03   // ≈0.97–1.03
speakPulse = speaking ? (sin(t*4.6)*0.5+0.5) * (0.35 + voice*0.65) : 0
coreScale  = 1 + voice*0.11 + speakPulse*0.045 + hover*0.025
spread     = breath * (1 + voice*0.1 + energy*0.02 + hover*0.075 - (listening?0.03:0) + success*0.04)
speedMul   = (reduced?0.16:1) * (1 + hover*0.12 + voice*0.18 + energy*0.12)
```

Ripples: one voice-onset ripple when `voice - prevVoice > 0.18` (advances `dt*0.9`, band width `1 - min(1, |rBase - front|*6)`, radius boost ×1.045). One hover ripple on hover-in (`dt*1.1`, `sin(p*PI)`, radius boost ×1.012).
Success: `bookingState === "confirmed"` → hold 1 for 2.2 s, linear fade over the next 3 s, then off.

## 6. Responsive / theming constants

```js
mobile = matchMedia("(max-width: 640px)").matches
LIFT   = dark ? (mobile ? 6 : 16) : 0
lift(l) = (mobile && dark) ? clamp(38, 78, 56 + (l-60)*0.42) : min(98, l + LIFT)
aBoost = dark ? (mobile ? 2.15 : 1.3) : 1     // global alpha multiplier
mScale = mobile ? 1.18 : 1                    // micro-star size multiplier
```

## 7. Spawn geometry (shared by both particle sets)

```js
ARM_BASE = [-0.75, 1.7, 3.9];  ARM_W = [0.34, 0.5, 0.62];
POCKETS = 4 × { a: rand(0,2π), r: rand(0.5,1.0), w: rand(0.16,0.3) };
pickArm = () => Math.random()<0.46 ? 0 : Math.random()<0.6 ? 1 : 2;
armAngle(r, arm) = Math.random()<0.16 ? rand(0,2π) : ARM_BASE[arm] + r*2.1 + rand(-ARM_W[arm], ARM_W[arm]);
reach   = arm===0 ? 1.62 : arm===1 ? 1.24 : 1.4;

// directional anisotropy — irregular, non-circular silhouette
A1,A2,A3 = rand(0,2π);  aniS = reduced ? 0.25 : 1;
stretch(ang,t) = 1 + 0.16*sin(ang   + A1 + t*0.045*aniS)
                   + 0.10*sin(ang*2 + A2 - t*0.031*aniS)
                   + 0.055*sin(ang*3 + A3 + t*0.019*aniS);
```

Position for every particle:
```js
rBase = p.r * (1 + sin(p.drift) * 0.05)          // 0.06 for micro-stars
ang   = p.a + rBase * p.spiral                    // spiral swirl
rr    = rBase * R * spread * stretch(ang,t) * (1 + p.react*voice*0.06)
x     = cx + ox + cos(ang) * rr
depth = sin(ang)
y     = cy + oy + depth * rr * p.tilt + p.yOff * R
```
Depth layers: `LAYER_SPEED = [1.7, 1.1, 0.6]`, `LAYER_ALPHA = [1, 0.94, 0.8]`; layer index from radius (`<0.34` / `<0.68` / else; micro uses `<0.36`).

## 8. Particle set A — "parts" (vortex)

Count `COUNT = reduced ? 150 : mobile ? 300 : 380`.

Kinds by roll `n`: `n<0.88` pinpoint (0), `<0.96` dot (1), `<0.99` short trail (2), else micro-spark (3).

Radius distribution (× reach): `roll<0.22 → pow(rand,0.5)*0.38+0.9` (sparse far field); `<0.52 → pow(rand,0.9)*0.38+0.52`; else `pow(rand,1.7)*0.5+0.1` (dense core).

```
s      rand(0.14,0.3), 14% reversed
tilt   rand(0.36,0.72)     yOff rand(-0.12,0.12)
size   kind3 rand(0.85,1.1) | kind1 rand(0.65,0.92) | else rand(0.4,0.78)
light  kind3 rand(68,80) | else rand(58,74)
alpha  kind0 rand(0.55,0.92) | else rand(0.6,0.95)
tw     rand(0,2π)   tws reduced rand(0.06,0.16) : rand(0.2,0.8)
react  pow(rand,1.5)   drift rand(0,2π)   driftS reduced rand(0.03,0.08) : rand(0.1,0.3)
spiral rand(0.5,1.15)
hue (desktop) <0.44 → 186–195 | <0.72 → 202–214 | <0.90 → 196–202 | else 248–258
hue (mobile)  <0.42 → 184–192 | <0.70 → 202–214 | <0.86 → 220–232 | else 248–268
```

Draw: `dScale = 0.55 + (depth+1)*0.4`; `tw = 0.6 + 0.4*sin(p.tw)`;
`a = alpha*tw*dScale*LAYER_ALPHA * (1 + hover*0.28 + energy*0.2 + success*0.5) * (1 + react*(voice*0.55 + mid*0.2))`, clamped to 1;
colour `hsla(hue 98% lift(light)% / min(1, a*aBoost))`.
- kind 3: radial gradient halo radius `size*1.25` at alpha `a*0.4`, plus solid dot `max(0.4, size*0.62)`.
- kind 2: tangent line length `size*2.3*(1+voice*0.2+hover*0.15)`, `lineWidth max(0.4, size*0.5)`, round caps.
- kinds 0/1: filled circle `max(0.35, size)`.

## 9. Particle set B — "micro" star field (the constellation stars)

Count `MICRO_COUNT = reduced ? 150 : mobile ? 360 : 430`. Total on desktop: **380 + 430 = 810 particles** (+ 11 nodes + 9 hover stars).

Zones: `pocket` chance 0.16; else `zone>0.78 → pow(rand,0.5)*0.42+0.9`; `zone>0.5 → pow(rand,0.85)*0.44+0.5`; else `pow(rand,1.7)*0.46+0.12`; all × reach.

Tiers by `tier = Math.random()`:
```
focal  tier>0.991 (~0.9%)  size rand(1.15,1.45)*mScale  light rand(84,96)  alpha rand(0.94,1)
anchor tier>0.965 (~3.5%)  size rand(0.95,1.18)*mScale  light rand(72,86)  alpha rand(0.88,1)
tier>0.8                   size rand(0.8,0.98)*mScale   light rand(62,78)  alpha rand(0.7,0.9)   (light tier uses tier>0.74)
tier>0.46                  size rand(0.62,0.82)*mScale
else (dominant, ~46%)      size rand(0.38,0.62)*mScale  light rand(56,70)  alpha rand(0.5,0.78)
```
Other fields: `s = rand(0.15,0.3) * (outer?0.6:1)`, `tilt rand(0.38,0.7)`, `yOff rand(-0.1,0.1)`, `tws reduced rand(0.08,0.2) : rand(0.35,1.1)`, `tws2 reduced rand(0.04,0.1) : rand(0.12,0.42)`, `react pow(rand,1.6)`, `driftS` as above, `spiral rand(0.6,1.3)`, `trail = !reduced && rand<0.02`, `glint = (focal||anchor) && rand<0.45`, `ecc`/`rot` seeded but **unused** in the final draw (points are round), `link = rand < (anchor||focal ? 0.95 : tier>0.62 ? 0.8 : 0.4)`.

Hues (desktop): `<0.36 → 184–194 | <0.6 → 202–213 | <0.8 → 192–200 | <0.88 → 206–218 | <0.94 → 196–204 | else 248–258`.
Hues (mobile): `<0.38 → 182–192 | <0.64 → 200–212 | <0.84 → 218–234 | else 246–268`.

Draw:
```js
microSpeed = speedMul * (1 + hover*0.08)
dScale  = 0.55 + (depth+1)*0.3
shimmer = (0.66 + 0.34*sin(tw)) * (0.82 + 0.18*sin(tw2*1.31 + 0.7))   // two independent twinkle waves
nearCore = max(0, 1 - rBase/0.55);   lit = 1 + max(0, 1 - rBase/0.4)*0.35
a = alpha*shimmer*dScale*lit*LAYER_ALPHA * (1 + hover*0.32 + energy*0.15 + success*0.45)
    * (1 + react*(voice*0.55 + mid*0.2) + nearCore*voice*0.3)
rad = clamp(0.32, 1.5, size * dScale * (1 + nearCore*voice*0.12))     // hard 1.5 px cap
colour = hsla(hue 98% lift(light)% / min(1, a*aBoost))
```
- `trail`: tangent line, length `rad*1.9`, width `max(0.35, rad*0.45)`.
- `focal`: tight radial halo `rad*1.35`, inner alpha `a*0.32`.
- always: filled circle radius `rad`.
- `glint`: cross flare, arm length `rad*(1.7 + shimmer*0.4)` horizontal / `×0.7` vertical, width `max(0.3, rad*0.24)`, alpha `min(1, a*0.34*aBoost)`, lightness `light+6`, butt caps.

## 10. Constellation lines (star-to-star)

```js
MAX_STAR_LINKS = reduced ? 5 : mobile ? 28 : 38;      // +3 while hover > 0.4
linkCands = indices of micro stars with link === true
spawn: every rand(0.08, 0.2) s, up to 3 new links per tick (skipped when reduced)
candidate distance window: R*0.06 < d < R*0.72 ; pick randomly among 4 nearest
life: dur = rand(1.8, 4.2) s ; env = min(1, min(t01, 1-t01) * 5)   // fade-in / hold / fade-out
bow: 40% rand(-0.02,0.02) (near-straight), else rand(-0.2,0.2)
hue: roll<0.52 → 192 ; <0.94 → 208 ; else 246
draw only while current distance <= R*0.8 ; near = 1 - d/(R*0.8)
alpha = min(0.62, env * (0.26 + near*0.2) * (mobile?1.5:1)
        * (1 + hover*0.3 + voice*0.65 + speakPulse*0.3 + energy*0.12 + success*0.4))
stroke: quadraticCurveTo with control point
        mx = (Ax+Bx)/2 - (By-Ay)*bow ; my = (Ay+By)/2 + (Bx-Ax)*bow
lineWidth 0.7, lineCap round
gradient stops: 0 → alpha 0 ; 0.34 → alpha ; 0.66 → alpha ; 1 → 0   (hsla hue 96% lift(56)%)
```

## 11. Neural node layer (near the core)

`NODE_COUNT = reduced ? 6 : mobile ? 8 : 11`; `r rand(0.2,0.66)`, `a = i/N*2π + rand(-0.3,0.3)`, `s rand(0.05,0.11)` (advanced at `speedMul*0.6`), `tilt rand(0.3,0.48)`, `yOff rand(-0.06,0.06)`, `size` 22% `rand(1.15,1.4)` else `rand(0.85,1.15)`, hue 62% 186–196 / then 204–214 / else 242–250.

Links: `MAX_LINKS = reduced ? 3 : mobile ? 4 : 6`, each `{ph rand(0,2π), sp reduced rand(0.04,0.09) : rand(0.14,0.3), bow rand(-0.22,0.22)}`; phase advances `sp*dt*(1+voice*0.35)`; `fade = min(1, max(0, sin(ph))^1.4 * 1.35)`, skipped below 0.03; drawn only if `dist <= R*0.8`; `alpha = min(0.3, fade*(0.12 + near*0.09)*(1 + hover*0.35 + voice*0.6 + speakPulse*0.25 + energy*0.15 + success*0.4))`; `lineWidth 0.65`; same 4-stop gradient at `hsla(hue 94% lift(50)%)`.

Node dots: `rad = size*0.44*(0.9 + (depth+1)*0.1)`, halo gradient `rad*0.5 → rad*1.6` at `a*0.2`, solid dot at `hsla(hue 98% lift(50 + voice*6)% / min(1, a*1.2))`, with `a = min(0.7, (0.3 + hover*0.12 + voice*0.2 + energy*0.06) * (0.6 + (depth+1)*0.22))`.

## 12. Central star (energy kernel) — the small bright core

Drawn **last**, with `ctx.globalCompositeOperation = dark ? "lighter" : "source-over"` (restored to `source-over` at the end of the frame). This is the only blend-mode change in the whole renderer. **No canvas `filter`/blur is ever used — all glow is radial gradients.**

```js
kx = cx + ox; ky = cy + oy;
kr = R * 0.082 * (1 + voice*0.07 + speakPulse*0.02 + hover*0.022);   // ~8.2% of R
IL = dark ? 100 : 62 ;  IS = dark ? 0 : 96 ;  IH = dark ? 0 : 196    // inner-white colour
hueMix(h) = h + (150-h)*green ;  satMix(s) = s - (s-78)*green        // emerald on booking
```

1. **Kernel haze** — elongated, not round: `translate(kx,ky)`, `rotate(-0.5 + sin(t*0.13)*0.12)`, `scale(1.5, 0.92)`, radial gradient radius `kr*2.1`, `hA = 0.1 + hover*0.035 + voice*0.08 + energy*0.03`; stops `hsla(191 100% 62% / hA)` → `hsla(206 98% 54% / hA*0.35)` at 0.55 → `hsla(230 92% 56% / 0)`.
2. **Five filaments** (never a circular orb):
```
{a:-0.42, off:0.10, len:1.55, wid:0.40, sp:0.31, ph:0.0, hue:189, lig:92, al:1.0}
{a: 0.85, off:0.22, len:1.12, wid:0.30, sp:0.23, ph:1.9, hue:196, lig:78, al:0.9}
{a: 2.05, off:0.34, len:0.86, wid:0.24, sp:0.41, ph:3.4, hue:203, lig:66, al:0.8}
{a:-1.62, off:0.18, len:0.70, wid:0.21, sp:0.27, ph:5.1, hue:186, lig:84, al:0.7}
{a: 2.75, off:0.46, len:0.58, wid:0.16, sp:0.35, ph:2.4, hue:246, lig:60, al:0.5}
```
per filament: `w1 = sin(t*sp+ph)`, `w2 = sin(t*sp*1.7 + ph*1.3)`, `beat = 0.5+0.5*sin(t*(2.2+i*0.9)+ph)`, `lift = voice*(0.35+beat*0.85) + speakPulse*0.12`, `pull = listening ? 0.86 : 1`; translate to `angle = a + w1*0.16`, `dist = kr*off*(1 + w2*0.22)*pull`; rotate `ang + 0.35 + w2*0.2`; scale `(len*(1 + w1*0.14 + lift*0.1)*pull, wid*(1 + w2*0.18))`; radial gradient radius `kr` with stops `0 → hsla(IH IS% IL% / a0)`, `0.28 → hsla(hue 100% min(96, lig+lift*8)% / a0*0.92)`, `0.68 → hsla(hue+12 98% lig-18% / a0*0.42)`, `1 → hsla(hue+26 94% 50% / 0)`, where `a0 = min(1, (al*(0.62+beat*0.2) + lift*0.3) * (listening?0.82:1))`.
3. **Two crossed ice-white slivers**: angles `-0.35` and `1.25` plus `sin(t*(0.4+i*0.3))*0.14`; scale `s = 1 + sin(t*(1.1+i*0.7))*0.12 + voice*0.08`, applied as `(i?0.62:0.95)*s, (i?0.16:0.22)*s`; offsets `(∓kr*0.06/0.12, ±kr*0.05/0.1)`; gradient `hsla(IH IS% IL% / min(1,(i?0.8:1)*(0.9+voice*0.1)+hover*0.06))` → `hsla(188 100% (dark?94:54)% / 0.7)` at 0.5 → `hsla(196 100% 70% / 0)`.
4. **Four escaping sparks**: `sp = 0.5 + i*0.23`, `cyc = (t*sp + i*0.41) % 1`, `angle = i*1.9 + sin(t*0.21+i)*0.9`, `d = kr*(0.9 + cyc*1.5)`, `alpha = sin(cyc*π)*(0.35 + voice*0.45 + hover*0.15)`, radius `max(0.35, kr*0.1*(1-cyc*0.4))` drawn as a radial gradient of `radius*2.4`.

## 13. Atmosphere layer (drawn first, before particles)

```js
hazeR = R * (1.35 + voice*0.04)
hazeA = (dark ? (mobile ? 0.11 : 0.028) : 0.018) + voice*0.01 + energy*0.005 + success*0.012
dark : hsla(198 90% 62% / hazeA) → hsla(210 85% 58% / hazeA*0.4) @0.5 → hsla(216 80% 56% / 0)
light: hsla(220 12% 26% / hazeA) → hsla(220 10% 28% / hazeA*0.45) @0.5 → hsla(220 10% 30% / 0)
```
There is **no ring, no enclosing arc, no container, no card, no oval mask, no background image**.

## 14. Interaction

Only a boolean `hovered` prop (the parent hero sets it on mouseenter/focus). There is **no mouse-position tracking or pointer parallax**. Hover effects: +28/32% particle alpha, +7.5% spread, +12% swirl speed, +8% micro-star speed, one 1.2% orbit ripple, +3 constellation links, and **9 hover-only outer pinpoints**:
`{a rand(0,2π), r rand(0.86,1.12), tilt rand(0.42,0.68), yOff rand(-0.05,0.05), sp rand(0.03,0.09)±, size rand(0.4,0.85), hue 60% 192 / 208 / 246}` drawn at `hsla(hue 98% lift(62)% / min(1, hover*0.72*tw*aBoost))`, `tw = 0.55 + 0.45*sin(s.tw + t*1.7)`.

## 15. Reduced motion

`reduced` lowers counts (150/150/6/3/5), sets `speedMul` base to 0.16, freezes `breath` to 1, disables morph, trails, ripples, success pulse and constellation spawning, and slows all twinkle/drift rates.

## 16. Optional surrounding CSS (not required by the canvas)

```css
.ava-spotlight::before { /* graphite depth, light backgrounds only */
  content:""; position:absolute; left:50%; top:48%; width:30rem; height:26rem;
  transform:translate(-50%,-50%); border-radius:50%; pointer-events:none;
  background:radial-gradient(closest-side, hsl(220 10% 22% / .035), hsl(220 10% 22% / .014) 55%, transparent 82%);
  filter:blur(22px);
}
@media (max-width:1023px){ /* electric glow behind Ava on navy */
  .ava-spotlight::after{ content:""; position:absolute; left:50%; top:46%; width:26rem; height:26rem;
    transform:translate(-50%,-50%); border-radius:50%;
    background:radial-gradient(closest-side, hsl(192 96% 52% / .30), hsl(214 90% 55% / .14) 48%, hsl(252 80% 58% / .08) 70%, transparent 84%);
    filter:blur(34px); }
}
```

---

# PORTABLE IMPLEMENTATION SPEC

Everything needed to recreate the identical visual in any React app, with no access to this project.

**1. Copy two files into the target app**

- `AvaSignal.portable.tsx` → e.g. `src/components/AvaSignal.tsx`
- `avaAudioStub.ts` → same folder, imported as `./avaAudioStub`

They are the live rendering code verbatim; the only change is that `step`, `agentSpeaking` and `bookingState` arrive as props instead of from a call-modal context, and the audio engine is a stub.

**2. Dependencies**

React 18+ only. No canvas library, no animation library, no Tailwind requirement (the `className` prop just needs to give the wrapper a width and height). TypeScript optional — strip the types for plain JS.

**3. Usage**

```tsx
<AvaSignal
  className="w-[15rem] h-[17rem] sm:w-[17rem] sm:h-[19rem] lg:w-[23rem] lg:h-[25rem]"
  dark            // true on a dark navy backdrop, omit on white
  hovered={hovered}
/>
```
The wrapper element must have non-zero width/height; the canvas fills it and `R = min(w,h)*0.30`. On the live site the wrapper is `23rem × 25rem` on desktop, `15rem × 17rem` on mobile — a deliberately non-square box, and the cluster is allowed to reach beyond the visible area.

**4. Making it audio-reactive (optional)**

Feed `avaLevels.agent` (0..1 smoothed loudness) and `avaLevels.mid` (0..1) each frame from any `AnalyserNode`, and pass `step="live"` + `agentSpeaking` while the voice is active. With the stub left as-is the visual runs perfectly in its idle/hover state — voice terms simply evaluate to 0.

**5. Success state (optional)**

Pass `bookingState="confirmed"` to trigger the one-off emerald/mint pulse (holds 2.2 s, eases back to cyan over 3 s).

**6. Non-negotiables to preserve identity**

- Canvas 2D, `dpr` capped at 2, `setTransform(dpr,…)` so all constants are CSS pixels.
- `R = Math.min(w,h)*0.30` with offsets `ox = R*0.04`, `oy = -R*0.03`.
- Desktop counts 380 vortex + 430 micro-stars + 11 nodes; micro-star radius hard-capped at 1.5 px.
- Hues confined to 182–234 cyan/blue plus a 246–268 violet accent; saturation 96–98%.
- Constellation lines: `lineWidth 0.7`, max 38, distance window `R*0.06 … R*0.72`, transparent-ended 4-stop gradients, life 1.8–4.2 s.
- Central star: `kr = R*0.082`, five asymmetric filaments + two crossed white slivers + four escaping sparks, `globalCompositeOperation = "lighter"` on dark only.
- No blur filters on the canvas, no rings, no container shapes, no masks, no images.
