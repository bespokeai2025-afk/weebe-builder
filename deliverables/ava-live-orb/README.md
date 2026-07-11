# Ava Live Call Orb — drop-in for www.webespokeai.com

The animated "Ava" call orb (the swirling blue → purple plasma ring shown while
Ava is on a call) lives in the WEBEE builder app. The public marketing site
**www.webespokeai.com is a separate Lovable-built project**, so the orb has to be
pasted into *that* project — it cannot be pushed there from the builder repo.

This folder is that ready-to-paste package.

## What's in the box

- **`AvaLiveOrb.tsx`** — the complete orb as a **single, self-contained file**.
  - Only dependency is **React**. No Tailwind, no CSS files, no `framer-motion`,
    `gsap`, `three` or WebGL. All styling and animation are inlined.
  - SSR-safe and reduced-motion aware.
  - Exports the `AvaLiveOrb` component **and** a `useAvaCallCadence` hook that
    reproduces the exact connecting → speaking ⇄ listening → ended cadence the
    builder app uses.

## How to add it to the Lovable project

1. **Copy the file in.** Put `AvaLiveOrb.tsx` somewhere sensible in the Lovable
   project, e.g. `src/components/AvaLiveOrb.tsx`.

2. **Render it on the "Call Ava" screen.** The simplest wiring uses the built-in
   cadence hook — pass `true` while the visitor's call is live, `false` once it
   ends:

   ```tsx
   import { AvaLiveOrb, useAvaCallCadence } from "@/components/AvaLiveOrb";

   function AvaCallScreen({ calling }: { calling: boolean }) {
     const liveState = useAvaCallCadence(calling);
     return <AvaLiveOrb state={liveState} size="lg" />;
   }
   ```

   - Set `calling` to `true` the moment the call is confirmed/placed.
   - Set `calling` to `false` when the visitor taps "End call" (or the call ends).
     The orb fades and scales down over ~0.5s, so keep it mounted for ~520ms after
     flipping `calling` to `false` before you unmount the screen.

3. **Or drive the state yourself.** If you'd rather control it manually, just pass
   one of the four states directly:

   ```tsx
   <AvaLiveOrb state="speaking" size="lg" />
   ```

### Props

| Prop        | Type                                                        | Default        |
| ----------- | ----------------------------------------------------------- | -------------- |
| `state`     | `"connecting" \| "speaking" \| "listening" \| "ended"`      | `"connecting"` |
| `size`      | `"sm" \| "md" \| "lg"` (130 / 190 / 240 px)                 | `"lg"`         |
| `className` | `string`                                                    | —              |
| `style`     | `CSSProperties`                                             | —              |

### State behaviour

- **connecting** — gentle, slow churn + soft glow (while the call is being placed)
- **speaking** — energetic: bigger displacement, faster churn, brighter glow
- **listening** — calmer, medium motion
- **ended** — fades out + scales down softly

## Notes / gotchas

- The real Ava call happens **over the phone (PSTN via Retell)**, so there is no
  in-browser audio to read. The speaking/listening loop is a convincing simulated
  cadence — this matches exactly what the builder app shows.
- The orb looks best on a dark background (the marketing "Call Ava" screen already
  is). It has its own coloured glow (`box-shadow`), so give it some breathing room.
- If the visitor has "reduce motion" enabled, the orb automatically renders the
  static displaced ring instead of animating — no extra work needed.
