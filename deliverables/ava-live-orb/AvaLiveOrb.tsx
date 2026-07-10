/**
 * AvaLiveOrb — self-contained drop-in for the www.webespokeai.com marketing site.
 * =============================================================================
 * This is a single-file, dependency-free version of the "Ava" live-call orb used
 * on the WEBEE builder app. It has NO dependencies other than React itself:
 *   - all styles are inlined via a <style> tag (no Tailwind / CSS files needed)
 *   - all animation is pure SVG + CSS (no framer-motion / gsap / three / WebGL)
 *   - it is SSR-safe (no window at render time, deterministic — no Math.random)
 *
 * HOW TO USE IN THE LOVABLE PROJECT
 * ---------------------------------
 * 1. Copy this whole file into the Lovable project, e.g.
 *      src/components/AvaLiveOrb.tsx
 * 2. Render the orb on the "Call Ava" screen and pass it the current call state:
 *
 *      import { AvaLiveOrb, type AvaLiveOrbState } from "@/components/AvaLiveOrb";
 *      ...
 *      <AvaLiveOrb state={liveState} size="lg" />
 *
 * 3. To reproduce the exact "connecting → speaking ⇄ listening → ended" cadence
 *    that the builder app shows during a call, use the ready-made hook below:
 *
 *      import { AvaLiveOrb, useAvaCallCadence } from "@/components/AvaLiveOrb";
 *      ...
 *      // `calling` = true while the visitor's phone call is in progress
 *      const liveState = useAvaCallCadence(calling);
 *      <AvaLiveOrb state={liveState} size="lg" />
 *
 *    When the visitor ends the call, set `calling` to false to fade the orb out.
 *    (The real phone call happens over PSTN via Retell, so there is no in-browser
 *    audio signal — the cadence is a convincing simulated speaking/listening loop,
 *    exactly as the builder app does it.)
 *
 * STATES
 * ------
 *   connecting → gentle, slow churn + soft glow   (while the call is being placed)
 *   speaking   → energetic: bigger displacement, faster churn, brighter glow
 *   listening  → calmer, medium motion
 *   ended      → fades + scales down softly        (call finished)
 */

import { useId, useState, useEffect } from "react";
import type { CSSProperties } from "react";

export type AvaLiveOrbState = "connecting" | "speaking" | "listening" | "ended";
export type AvaLiveOrbSize = "sm" | "md" | "lg";

interface AvaLiveOrbProps {
  state?: AvaLiveOrbState;
  size?: AvaLiveOrbSize;
  className?: string;
  style?: CSSProperties;
}

const SIZE_MAP: Record<AvaLiveOrbSize, number> = { sm: 130, md: 190, lg: 240 };

interface StateCfg {
  /** turbulence baseFrequency animation duration (s) */
  freqDur: number;
  /** displacement scale [min, max] — how strongly the ring reshapes */
  disp: [number, number];
  /** displacement animation duration (s) */
  dispDur: number;
  /** color-sweep rotation duration (s) */
  rot: number;
  /** breathe scale peak + duration */
  bs: number;
  breatheDur: number;
}

const CFG: Record<AvaLiveOrbState, StateCfg> = {
  connecting: { freqDur: 20, disp: [12, 22], dispDur: 7, rot: 44, bs: 1.02, breatheDur: 5 },
  speaking: { freqDur: 10, disp: [24, 44], dispDur: 3, rot: 20, bs: 1.06, breatheDur: 2 },
  listening: { freqDur: 17, disp: [15, 28], dispDur: 5.5, rot: 32, bs: 1.03, breatheDur: 4.5 },
  ended: { freqDur: 22, disp: [8, 14], dispDur: 8, rot: 44, bs: 1, breatheDur: 6 },
};

/** Deterministic sparks scattered around the ring (no Math.random → SSR-safe). */
const SPARKS: Array<{ cx: number; cy: number; r: number; delay: number; fill: string }> = [
  { cx: 150, cy: 58, r: 0.9, delay: 0, fill: "#bae6fd" },
  { cx: 178, cy: 104, r: 0.8, delay: 0.5, fill: "#38bdf8" },
  { cx: 150, cy: 152, r: 1.0, delay: 1.0, fill: "#22d3ee" },
  { cx: 104, cy: 180, r: 0.8, delay: 1.5, fill: "#7dd3fc" },
  { cx: 52, cy: 152, r: 0.9, delay: 0.8, fill: "#c084fc" },
  { cx: 24, cy: 106, r: 0.8, delay: 2.0, fill: "#a855f7" },
  { cx: 48, cy: 54, r: 1.0, delay: 1.3, fill: "#bae6fd" },
  { cx: 100, cy: 22, r: 0.8, delay: 0.3, fill: "#38bdf8" },
];

const ORB_STYLES = `
  @keyframes alo-rot { to { transform: rotate(360deg); } }
  @keyframes alo-rot-rev { to { transform: rotate(-360deg); } }
  @keyframes alo-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(var(--alo-bs, 1.04)); } }
  @keyframes alo-glow { 0%, 100% { opacity: .3; } 50% { opacity: .72; } }
  @keyframes alo-flow { to { stroke-dashoffset: -300; } }
  @keyframes alo-tw { 0%, 100% { opacity: .12; } 50% { opacity: .95; } }

  .alo-root { position: relative; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; transition: opacity .5s ease, transform .5s ease, box-shadow .5s ease; }
  .alo-root, .alo-root * { box-sizing: border-box; }

  .alo-amb { position: absolute; border-radius: 50%; pointer-events: none; }
  .alo-amb-p { left: -12%; top: -8%; width: 74%; height: 74%; background: radial-gradient(circle, rgba(168,85,247,0.34) 0%, rgba(168,85,247,0) 68%); }
  .alo-amb-b { right: -12%; bottom: -8%; width: 76%; height: 76%; background: radial-gradient(circle, rgba(56,189,248,0.30) 0%, rgba(56,189,248,0) 68%); }

  .alo-svg { position: relative; width: 100%; height: 100%; display: block; overflow: visible; will-change: transform, filter; }
  .alo-ring, .alo-wisp, .alo-dash { transform-box: fill-box; transform-origin: center; }

  /* motion (disabled when prefers-reduced-motion) */
  .alo-root.is-live .alo-svg { animation: alo-breathe var(--alo-breathe-dur, 4s) ease-in-out infinite; }
  .alo-root.is-live .alo-ring { animation: alo-rot var(--alo-rot-dur, 36s) linear infinite; }
  .alo-root.is-live .alo-wisp { animation: alo-rot-rev calc(var(--alo-rot-dur, 36s) * 1.7) linear infinite; }
  .alo-root.is-live .alo-centerglow { animation: alo-glow var(--alo-breathe-dur, 4s) ease-in-out infinite; }
  .alo-root.is-live .alo-dash { animation: alo-flow 5s linear infinite; }
  .alo-root.is-live .alo-spark { animation: alo-tw 3.2s ease-in-out infinite; }

  /* per-state brightness / saturation */
  .alo-root[data-state="connecting"] .alo-svg { filter: brightness(.95) saturate(1); }
  .alo-root[data-state="speaking"] .alo-svg { filter: brightness(1.16) saturate(1.28); }
  .alo-root[data-state="listening"] .alo-svg { filter: brightness(1.05) saturate(1.12); }
  .alo-root[data-state="ended"] .alo-svg { filter: brightness(.8) saturate(.85); }

  .alo-root[data-state="ended"] { opacity: 0; transform: scale(.9); }
`;

export function AvaLiveOrb({ state = "connecting", size = "lg", className, style }: AvaLiveOrbProps) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const px = SIZE_MAP[size];
  const cfg = CFG[state];

  // Respect prefers-reduced-motion. Default = motion on (SSR + first paint),
  // switched off only if the user asks for reduced motion.
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);
  const motion = !reduced;

  const id = {
    grad: `${uid}-grad`,
    core: `${uid}-core`,
    plasma: `${uid}-plasma`,
    wisp: `${uid}-wisp`,
  };

  const r = (n: number) => Math.round(n);
  const halo =
    state === "speaking"
      ? `0 0 ${r(px * 0.5)}px rgba(56,189,248,0.5), 0 0 ${r(px * 0.42)}px rgba(139,92,246,0.42)`
      : state === "listening"
        ? `0 0 ${r(px * 0.4)}px rgba(56,189,248,0.36), 0 0 ${r(px * 0.34)}px rgba(139,92,246,0.3)`
        : state === "ended"
          ? "none"
          : `0 0 ${r(px * 0.36)}px rgba(56,189,248,0.32), 0 0 ${r(px * 0.3)}px rgba(139,92,246,0.26)`;

  const rootStyle = {
    width: px,
    height: px,
    boxShadow: halo,
    "--alo-bs": cfg.bs,
    "--alo-rot-dur": `${cfg.rot}s`,
    "--alo-breathe-dur": `${cfg.breatheDur}s`,
    ...style,
  } as CSSProperties;

  return (
    <div
      className={`alo-root${motion ? " is-live" : ""}${className ? ` ${className}` : ""}`}
      data-state={state}
      style={rootStyle}
    >
      <style>{ORB_STYLES}</style>

      <div className="alo-amb alo-amb-p" />
      <div className="alo-amb alo-amb-b" />

      <svg className="alo-svg" viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <linearGradient
            id={id.grad}
            gradientUnits="userSpaceOnUse"
            x1="52"
            y1="44"
            x2="150"
            y2="156"
          >
            <stop offset="0%" stopColor="#d8b4fe" />
            <stop offset="22%" stopColor="#a855f7" />
            <stop offset="50%" stopColor="#6366f1" />
            <stop offset="74%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>

          <radialGradient id={id.core}>
            <stop offset="0%" stopColor="rgba(56,189,248,0.28)" />
            <stop offset="55%" stopColor="rgba(124,58,237,0.12)" />
            <stop offset="100%" stopColor="rgba(2,8,23,0)" />
          </radialGradient>

          {/* Plasma: churning turbulence displaces the ring so it reshapes live. */}
          <filter
            id={id.plasma}
            x="-60%"
            y="-60%"
            width="220%"
            height="220%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves={2} seed={4} result="n">
              {motion && (
                <animate
                  attributeName="baseFrequency"
                  dur={`${cfg.freqDur}s`}
                  values="0.009 0.015;0.021 0.031;0.009 0.015"
                  repeatCount="indefinite"
                />
              )}
            </feTurbulence>
            <feDisplacementMap
              in="SourceGraphic"
              in2="n"
              scale={cfg.disp[0]}
              xChannelSelector="R"
              yChannelSelector="G"
              result="d"
            >
              {motion && (
                <animate
                  attributeName="scale"
                  dur={`${cfg.dispDur}s`}
                  values={`${cfg.disp[0]};${cfg.disp[1]};${cfg.disp[0]}`}
                  repeatCount="indefinite"
                />
              )}
            </feDisplacementMap>
            <feGaussianBlur in="d" stdDeviation="2.1" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="d" />
            </feMerge>
          </filter>

          {/* Wisp: broader, softer turbulence → smoky trails around the ring. */}
          <filter id={id.wisp} x="-90%" y="-90%" width="280%" height="280%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.018 0.028" numOctaves={2} seed={9} result="n">
              {motion && (
                <animate
                  attributeName="baseFrequency"
                  dur={`${cfg.freqDur * 1.4}s`}
                  values="0.014 0.022;0.026 0.036;0.014 0.022"
                  repeatCount="indefinite"
                />
              )}
            </feTurbulence>
            <feDisplacementMap
              in="SourceGraphic"
              in2="n"
              scale={cfg.disp[1] * 1.5}
              xChannelSelector="R"
              yChannelSelector="G"
              result="d"
            />
            <feGaussianBlur in="d" stdDeviation="4" />
          </filter>
        </defs>

        {/* faint hollow-center glow */}
        <circle className="alo-centerglow" cx="100" cy="100" r="50" fill={`url(#${id.core})`} />

        {/* smoky wisps (behind) */}
        <g className="alo-wisp" filter={`url(#${id.wisp})`} opacity="0.55">
          <circle cx="100" cy="100" r="72" fill="none" stroke={`url(#${id.grad})`} strokeWidth="10" opacity="0.32" />
          <circle cx="100" cy="100" r="84" fill="none" stroke="#7c3aed" strokeWidth="6" opacity="0.18" />
        </g>

        {/* main plasma ring (churns + rotates through the color sweep) */}
        <g className="alo-ring" filter={`url(#${id.plasma})`}>
          <circle cx="100" cy="100" r="66" fill="none" stroke={`url(#${id.grad})`} strokeWidth="5" />
          <circle cx="100" cy="100" r="60" fill="none" stroke={`url(#${id.grad})`} strokeWidth="2" opacity="0.6" />
          <circle cx="100" cy="100" r="73" fill="none" stroke="#c084fc" strokeWidth="2" opacity="0.5" />
          <circle
            className="alo-dash"
            cx="100"
            cy="100"
            r="66"
            fill="none"
            stroke="#e0f2fe"
            strokeWidth="1.3"
            strokeDasharray="3 7"
            strokeLinecap="round"
            opacity="0.85"
          />
        </g>

        {/* twinkling sparks */}
        <g>
          {SPARKS.map((s, i) => (
            <circle
              key={i}
              className="alo-spark"
              cx={s.cx}
              cy={s.cy}
              r={s.r}
              fill={s.fill}
              style={{ animationDelay: `${s.delay}s` }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

/**
 * useAvaCallCadence — drives the orb through a convincing live-call cadence.
 *
 * The real "Call Ava" phone call is placed over PSTN (via Retell), so there is
 * no in-browser audio signal to read. This hook reproduces the exact cadence the
 * WEBEE builder app uses on its own Call Ava screen:
 *
 *   connecting  (2.4s)  →  speaking (3.8s) ⇄ listening (3.0s)  … repeating …
 *   → "ended" when `calling` flips to false (so the orb can fade out).
 *
 * Pass `true` while the call is live and `false` once it finishes/hangs up.
 */
export function useAvaCallCadence(calling: boolean): AvaLiveOrbState {
  const [state, setState] = useState<AvaLiveOrbState>("connecting");

  // Reset to "connecting" on each new call; mark "ended" when the call stops.
  useEffect(() => {
    if (calling) {
      setState("connecting");
      const t = setTimeout(() => setState("speaking"), 2400);
      return () => clearTimeout(t);
    }
    setState("ended");
  }, [calling]);

  // Alternate speaking ⇄ listening while the call is live.
  useEffect(() => {
    if (!calling || state === "connecting" || state === "ended") return;
    const dur = state === "speaking" ? 3800 : 3000;
    const t = setTimeout(
      () => setState((s) => (s === "speaking" ? "listening" : "speaking")),
      dur,
    );
    return () => clearTimeout(t);
  }, [calling, state]);

  return state;
}
