# Webespoke AI — Homepage Navy Background System

Exact CSS values for reproducing the deep navy + two-tone blue/indigo sheen in another React application.

## Where the effect lives

| Layer | Selector | Role |
|---|---|---|
| Base hero surface | `.hero-bg` | Light/warm base on desktop; full navy on mobile |
| Right navy panel | `.hero-navy-right` | Desktop-only clipped navy panel behind Ava |
| Reusable navy surface | `.section-navy-premium` | The master navy + sheen recipe |
| Legacy navy surface | `.section-navy` | Used on Tech / Builder / Smart Dash / Enterprise |
| Hero grid lines | `.hero-grid` | Faint technical grid on the light side |

**Source file:** `src/index.css`

## CSS custom properties (variables)

These variables are defined in the `:root` block and drive every navy/blue value.

```css
--navy: 222 55% 11%;          /* Webespoke deep navy */
--navy-deep: 222 60% 7%;
--navy-soft: 222 40% 18%;
--electric: 217 91% 60%;      /* electric blue accent */
--electric-soft: 217 91% 68%;
```

## Main homepage background colour

On desktop the hero is a warm white surface. The navy only appears on the clipped right panel.

```css
background: linear-gradient(180deg, hsl(40 20% 99.2%) 0%, hsl(240 6% 98.4%) 100%);
```

On mobile the entire hero becomes navy using this override (`max-width: 1023px`):

```css
background:
  radial-gradient(760px 520px at 12% -12%, hsl(217 91% 60% / 0.34), transparent 62%),
  radial-gradient(660px 460px at 94% 6%, hsl(268 72% 52% / 0.26), transparent 58%),
  radial-gradient(700px 520px at 50% 108%, hsl(190 92% 46% / 0.20), transparent 60%),
  linear-gradient(170deg, hsl(222 62% 6%) 0%, hsl(222 56% 10%) 55%, hsl(230 52% 12%) 100%);
```

## Navy / dark blue colour values

| Token | HSL | Approx. Hex / Usage |
|---|---|---|
| `--navy` | `222 55% 11%` | `#0B1426` — primary deep navy |
| `--navy-deep` | `222 60% 7%` | `#070F1D` — darkest navy, gradient start |
| `--navy-soft` | `222 40% 18%` | `#1C2A3F` — lighter navy for borders/muted |
| hero mobile | `#050d20` | Phone-only opaque fallback base |

## Secondary indigo / blue-violet values

| Colour | HSL / Hex | Role |
|---|---|---|
| Electric blue | `217 91% 60%` / `#3B82F6` | primary blue accent / sheen |
| Cyan | `190 92% 46%` / `#0EA5E9` | bottom glow, cool contrast |
| Violet / indigo | `268 72% 52%` / `#7C3AED` | top-right purple/indigo sheen |

## Complete gradient declarations

### 1. `.section-navy-premium` (master recipe)

```css
background:
  radial-gradient(900px 520px at 12% -15%, hsl(217 91% 60% / 0.26), transparent 62%),
  radial-gradient(720px 460px at 92% 8%, hsl(268 72% 52% / 0.20), transparent 58%),
  radial-gradient(900px 520px at 50% 115%, hsl(190 92% 46% / 0.14), transparent 58%),
  linear-gradient(170deg, hsl(222 62% 6%) 0%, hsl(222 56% 10%) 55%, hsl(230 52% 12%) 100%);
color: hsl(0 0% 100%);
```

### 2. `.hero-navy-right` (desktop clipped panel)

```css
@apply section-navy-premium;
position: absolute;
inset: 0;
clip-path: polygon(61% 0, 100% 0, 100% 100%, 55% 100%);
-webkit-mask-image: none;
mask-image: none;
```

### 3. `.hero-bg` (desktop light base)

```css
background:
  radial-gradient(560px 480px at 74% 50%, hsl(220 10% 20% / 0.04), hsl(220 10% 20% / 0.018) 50%, transparent 78%),
  radial-gradient(860px 640px at 76% 52%, hsl(220 8% 24% / 0.018), transparent 74%),
  radial-gradient(900px 500px at 15% -10%, hsl(0 0% 0% / 0.022), transparent 58%),
  radial-gradient(700px 400px at 100% 0%, hsl(0 0% 0% / 0.018), transparent 55%),
  linear-gradient(180deg, hsl(40 20% 99.2%) 0%, hsl(240 6% 98.4%) 100%);
```

### 4. `.section-navy` (legacy product surface)

```css
background:
  radial-gradient(900px 500px at 15% -10%, hsl(217 91% 60% / 0.18), transparent 60%),
  radial-gradient(700px 460px at 95% 10%, hsl(280 70% 50% / 0.14), transparent 55%),
  radial-gradient(800px 500px at 50% 110%, hsl(217 91% 60% / 0.10), transparent 55%),
  linear-gradient(180deg, hsl(222 60% 7%) 0%, hsl(222 55% 11%) 100%);
color: hsl(0 0% 100%);
```

## Opacity, blur, filter & blend-mode values

The navy sheen is achieved with low-opacity radial gradients. There are NO blend modes used on the background itself.

| Property | Value |
|---|---|
| Electric radial opacity | `0.26 / 0.18 / 0.14 / 0.10 / 0.34` |
| Violet radial opacity | `0.20 / 0.14 / 0.26` |
| Cyan radial opacity | `0.20 / 0.14` |
| Ava spotlight blur | `filter: blur(22px); filter: blur(28px);` |
| Mobile Ava glow blur | `filter: blur(34px);` |
| Glass card backdrop | `backdrop-filter: blur(14px) saturate(140%);` |
| Background blend mode | None on the background layers. Mobile override explicitly sets `mix-blend-mode: normal;` |

## Gradient positioning

The master navy surface stacks gradients in this order (first = top):

| # | Gradient | Position / Purpose |
|---|---|---|
| 1 | `hsl(217 91% 60% / 0.26)` | Top-left electric sheen at `12% -15%`, 900×520px |
| 2 | `hsl(268 72% 52% / 0.20)` | Top-right violet sheen at `92% 8%`, 720×460px |
| 3 | `hsl(190 92% 46% / 0.14)` | Bottom-center cyan glow at `50% 115%`, 900×520px |
| 4 | `linear-gradient(170deg, ...)` | Base diagonal: `222 62% 6% -> 222 56% 10% -> 230 52% 12%` |

## Pseudo-element / layer implementation

The hero uses three absolute layers inside the section:

```html
<section class="hero-bg">
  <div class="absolute inset-0 hero-grid" />
  <div class="absolute inset-0 hero-navy-right" />
  ...content...
</section>
```

- `.hero-grid` is a faint technical grid masked to fade out before the navy panel.
- `.hero-navy-right` clips the master navy surface to the right 39% of the hero using `polygon(61% 0, 100% 0, 100% 100%, 55% 100%)`.

## Copy-paste CSS implementation for Replit

Drop the following into a global CSS file. It recreates the full navy background system without any project-specific dependencies.

```css
:root {
  --navy: 222 55% 11%;
  --navy-deep: 222 60% 7%;
  --navy-soft: 222 40% 18%;
  --electric: 217 91% 60%;
  --electric-soft: 217 91% 68%;
}

/* Master navy surface — drop this on any root wrapper */
.webee-navy-bg {
  position: relative;
  background:
    radial-gradient(900px 520px at 12% -15%, hsl(217 91% 60% / 0.26), transparent 62%),
    radial-gradient(720px 460px at 92% 8%, hsl(268 72% 52% / 0.20), transparent 58%),
    radial-gradient(900px 520px at 50% 115%, hsl(190 92% 46% / 0.14), transparent 58%),
    linear-gradient(170deg, hsl(222 62% 6%) 0%, hsl(222 56% 10%) 55%, hsl(230 52% 12%) 100%);
  color: hsl(0 0% 100%);
  min-height: 100vh;
}

/* Optional: clipped desktop hero panel */
.webee-navy-hero-panel {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(900px 520px at 12% -15%, hsl(217 91% 60% / 0.26), transparent 62%),
    radial-gradient(720px 460px at 92% 8%, hsl(268 72% 52% / 0.20), transparent 58%),
    radial-gradient(900px 520px at 50% 115%, hsl(190 92% 46% / 0.14), transparent 58%),
    linear-gradient(170deg, hsl(222 62% 6%) 0%, hsl(222 56% 10%) 55%, hsl(230 52% 12%) 100%);
  clip-path: polygon(61% 0, 100% 0, 100% 100%, 55% 100%);
  -webkit-mask-image: none;
  mask-image: none;
  pointer-events: none;
}

/* Optional: faint technical grid overlay */
.webee-navy-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(hsl(215 14% 38% / 0.07) 1px, transparent 1px),
    linear-gradient(90deg, hsl(215 14% 38% / 0.07) 1px, transparent 1px);
  background-size: 44px 44px;
}
```

## Responsive behaviour summary

- **Desktop (>= 1024px):** hero is warm white on the left, clipped navy panel on the right. Graphite Ava spotlight is hidden so Ava sits cleanly on the navy.
- **Tablet/Mobile (< 1023px):** `.hero-navy-right` is `display: none`. The `.hero-bg` override paints the entire hero navy with electric/violet/cyan radial sheens.
- **Phone (< 767px):** an even stricter override removes all radial glows, spotlights, and masks, leaving only a clean opaque linear gradient: `#0a1733 -> #050d20 -> #071229 -> #130d32`.

## Important notes

- No WebGL, images, SVG patterns, or blend modes are used. The entire effect is pure stacked CSS gradients.
- The HSL values are written exactly as they appear in `src/index.css`.
- For the Ava constellation visual that sits on top of this background, see the separate `AvaSignal.tsx` specification.
