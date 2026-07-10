import { useId } from "react";
import type { CSSProperties } from "react";

/**
 * AvaLiveOrb — a premium, 3D-feeling animated "live AI energy sphere" for the
 * active Call Ava call screen. Built with CSS 3D transforms (a preserve-3d
 * orbit cage) + SVG gradients/energy flow + a shaded spherical core, so it
 * reads as a real 3D orb with depth and parallax — no raster, no WebGL, SSR-safe.
 *
 * State behaviour:
 *  - connecting → subtle, slow "loading" pulse
 *  - speaking   → stronger energy, brighter pulse, faster orbit
 *  - listening  → calmer, slower motion
 *  - ended      → fades + scales down softly
 */

export type AvaLiveOrbState = "connecting" | "speaking" | "listening" | "ended";
export type AvaLiveOrbSize = "sm" | "md" | "lg";

interface AvaLiveOrbProps {
  state?: AvaLiveOrbState;
  size?: AvaLiveOrbSize;
  className?: string;
  style?: CSSProperties;
}

const SIZE_MAP: Record<AvaLiveOrbSize, number> = { sm: 120, md: 170, lg: 220 };

/** Deterministic neural particles (no Math.random → SSR-hydration safe). */
const PARTICLES: Array<{ cx: number; cy: number; r: number; delay: number; fill: string }> = [
  { cx: 50, cy: 3, r: 0.9, delay: 0, fill: "#BAE6FD" },
  { cx: 82, cy: 14, r: 0.7, delay: 0.6, fill: "#38BDF8" },
  { cx: 96, cy: 46, r: 1.0, delay: 1.2, fill: "#22D3EE" },
  { cx: 88, cy: 80, r: 0.7, delay: 1.8, fill: "#38BDF8" },
  { cx: 58, cy: 96, r: 0.9, delay: 0.9, fill: "#BAE6FD" },
  { cx: 24, cy: 92, r: 0.7, delay: 2.2, fill: "#8B5CF6" },
  { cx: 5, cy: 60, r: 1.0, delay: 1.4, fill: "#22D3EE" },
  { cx: 9, cy: 24, r: 0.7, delay: 2.6, fill: "#8B5CF6" },
  { cx: 34, cy: 8, r: 0.8, delay: 0.3, fill: "#38BDF8" },
  { cx: 72, cy: 92, r: 0.8, delay: 1.6, fill: "#22D3EE" },
];

/** Faint neural connecting lines between a few particles. */
const LINKS: Array<[number, number, number, number]> = [
  [50, 3, 82, 14],
  [82, 14, 96, 46],
  [96, 46, 88, 80],
  [9, 24, 5, 60],
  [5, 60, 24, 92],
  [34, 8, 9, 24],
];

const RINGS = [
  { cls: "alo-r1", grad: "g1", sw: 0.8, dash: "2.5 5" },
  { cls: "alo-r2", grad: "g2", sw: 0.7, dash: "1.5 6" },
  { cls: "alo-r3", grad: "g3", sw: 0.9, dash: "3 4" },
  { cls: "alo-r4", grad: "g1", sw: 0.6, dash: "1 7" },
];

const ORB_STYLES = `
  @keyframes avalive-orbit { from { transform: rotateX(16deg) rotateY(0deg); } to { transform: rotateX(16deg) rotateY(360deg); } }
  @keyframes avalive-flow { to { stroke-dashoffset: -200; } }
  @keyframes avalive-breathe { 0%, 100% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.05); } }
  @keyframes avalive-breathe-strong { 0%, 100% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.1); } }
  @keyframes avalive-glow { 0%, 100% { opacity: .5; } 50% { opacity: .85; } }
  @keyframes avalive-twinkle { 0%, 100% { opacity: .12; } 50% { opacity: .9; } }
  @keyframes avalive-spin { to { transform: rotate(360deg); } }

  .alo-root { position: relative; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; transition: opacity .5s ease, transform .5s ease; }
  .alo-root, .alo-root * { box-sizing: border-box; }
  .alo-layer { position: absolute; inset: 0; }

  .alo-purple { left: -8%; top: 50%; width: 62%; height: 82%; position: absolute; transform: translateY(-50%); border-radius: 50%; background: radial-gradient(circle at 32% 50%, rgba(124,58,237,0.30) 0%, rgba(124,58,237,0.07) 46%, transparent 70%); pointer-events: none; }
  .alo-glow { left: 50%; top: 50%; width: 92%; height: 92%; position: absolute; transform: translate(-50%, -50%); border-radius: 50%; background: radial-gradient(circle, rgba(56,189,248,0.45) 0%, rgba(56,189,248,0.12) 42%, transparent 70%); animation: avalive-glow 5s ease-in-out infinite; will-change: opacity; }

  .alo-scene { position: absolute; inset: 0; transform-style: preserve-3d; animation: avalive-orbit 18s linear infinite; will-change: transform; }
  .alo-ring { position: absolute; inset: 0; transform-style: preserve-3d; }
  .alo-ring svg { width: 100%; height: 100%; display: block; overflow: visible; }
  .alo-ring .flow { animation: avalive-flow 6s linear infinite; }
  .alo-r1 { transform: rotateX(72deg); }
  .alo-r2 { transform: rotateY(45deg) rotateX(72deg); }
  .alo-r3 { transform: rotateY(90deg) rotateX(72deg); }
  .alo-r4 { transform: rotateY(135deg) rotateX(72deg); }

  .alo-core { position: absolute; left: 50%; top: 50%; width: 46%; height: 46%; transform: translate(-50%, -50%); border-radius: 50%;
    background: radial-gradient(circle at 38% 30%, #12356a 0%, #061a3a 44%, #020817 100%);
    box-shadow: inset 0 0 22px rgba(2,8,23,0.9), inset -6px -9px 20px rgba(0,0,0,0.55), 0 0 34px rgba(56,189,248,0.28);
    animation: avalive-breathe 5.5s ease-in-out infinite; will-change: transform; }
  .alo-core-hi { position: absolute; left: 20%; top: 14%; width: 44%; height: 36%; border-radius: 50%; background: radial-gradient(circle, rgba(160,205,255,0.55) 0%, rgba(160,205,255,0) 70%); filter: blur(2px); }

  .alo-front { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .alo-front .flow { animation: avalive-flow 5s linear infinite; }
  .alo-front .spin { transform-box: fill-box; transform-origin: center; animation: avalive-spin 22s linear infinite; }
  .alo-front .twk { animation: avalive-twinkle 3.4s ease-in-out infinite; }

  /* connecting */
  .alo-root[data-state="connecting"] .alo-scene { animation-duration: 26s; }
  .alo-root[data-state="connecting"] .alo-core { animation-duration: 3s; }
  .alo-root[data-state="connecting"] .alo-glow { animation-duration: 2.4s; opacity: .5; }

  /* speaking */
  .alo-root[data-state="speaking"] .alo-scene { animation-duration: 9s; }
  .alo-root[data-state="speaking"] .alo-core { animation-name: avalive-breathe-strong; animation-duration: 1.7s; }
  .alo-root[data-state="speaking"] .alo-glow { animation-duration: 1.7s; opacity: .92; }
  .alo-root[data-state="speaking"] .alo-front .flow { animation-duration: 2.4s; }
  .alo-root[data-state="speaking"] .alo-ring .flow { animation-duration: 3s; }

  /* listening */
  .alo-root[data-state="listening"] .alo-scene { animation-duration: 22s; }
  .alo-root[data-state="listening"] .alo-core { animation-duration: 5s; }
  .alo-root[data-state="listening"] .alo-glow { animation-duration: 5s; }

  /* ended */
  .alo-root[data-state="ended"] { opacity: 0; transform: scale(.92); }

  @media (prefers-reduced-motion: reduce) {
    .alo-root .alo-scene, .alo-root .alo-core, .alo-root .alo-glow,
    .alo-root .flow, .alo-root .spin, .alo-root .twk { animation: none !important; }
    .alo-root .alo-glow { opacity: .7; }
    .alo-root .alo-scene { transform: rotateX(16deg) rotateY(24deg); }
  }
`;

export function AvaLiveOrb({ state = "connecting", size = "lg", className, style }: AvaLiveOrbProps) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const px = SIZE_MAP[size];

  const id = {
    g1: `${uid}-g1`,
    g2: `${uid}-g2`,
    g3: `${uid}-g3`,
    main: `${uid}-main`,
    comet: `${uid}-comet`,
  };

  const halo =
    state === "speaking"
      ? `0 0 ${Math.round(px * 0.55)}px rgba(56,189,248,0.5), ${-Math.round(px * 0.16)}px 0 ${Math.round(px * 0.42)}px rgba(124,58,237,0.24)`
      : state === "listening"
        ? `0 0 ${Math.round(px * 0.4)}px rgba(56,189,248,0.32), ${-Math.round(px * 0.14)}px 0 ${Math.round(px * 0.36)}px rgba(124,58,237,0.16)`
        : `0 0 ${Math.round(px * 0.34)}px rgba(56,189,248,0.28), ${-Math.round(px * 0.12)}px 0 ${Math.round(px * 0.32)}px rgba(124,58,237,0.14)`;

  return (
    <div
      className={`alo-root${className ? ` ${className}` : ""}`}
      data-state={state}
      style={{ width: px, height: px, perspective: `${Math.round(px * 4)}px`, boxShadow: halo, ...style }}
    >
      <style>{ORB_STYLES}</style>

      <div className="alo-purple" />
      <div className="alo-glow" />

      {/* 3D orbit cage */}
      <div className="alo-scene">
        {RINGS.map((ring) => (
          <div key={ring.cls} className={`alo-ring ${ring.cls}`}>
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <defs>
                <linearGradient id={`${id[ring.grad as "g1" | "g2" | "g3"]}-${ring.cls}`} x1="0%" y1="0%" x2="100%" y2="100%">
                  {ring.grad === "g1" && (<><stop offset="0%" stopColor="#22D3EE" /><stop offset="100%" stopColor="#38BDF8" /></>)}
                  {ring.grad === "g2" && (<><stop offset="0%" stopColor="#38BDF8" /><stop offset="100%" stopColor="#3B82F6" /></>)}
                  {ring.grad === "g3" && (<><stop offset="0%" stopColor="#3B82F6" /><stop offset="100%" stopColor="#8B5CF6" /></>)}
                </linearGradient>
              </defs>
              <circle
                className="flow"
                cx="50"
                cy="50"
                r="47"
                fill="none"
                stroke={`url(#${id[ring.grad as "g1" | "g2" | "g3"]}-${ring.cls})`}
                strokeWidth={ring.sw}
                strokeDasharray={ring.dash}
                strokeLinecap="round"
              />
            </svg>
          </div>
        ))}
      </div>

      {/* shaded spherical core */}
      <div className="alo-core">
        <div className="alo-core-hi" />
      </div>

      {/* front hero ring + neural particles */}
      <svg className="alo-front" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id={id.main} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22D3EE" />
            <stop offset="50%" stopColor="#7DD3FC" />
            <stop offset="100%" stopColor="#3B82F6" />
          </linearGradient>
          <linearGradient id={id.comet} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(224,242,254,0.95)" />
            <stop offset="100%" stopColor="rgba(34,211,238,0)" />
          </linearGradient>
        </defs>

        {/* neural links */}
        <g stroke="rgba(125,211,252,0.18)" strokeWidth="0.3">
          {LINKS.map((l, i) => (
            <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} />
          ))}
        </g>

        {/* prominent front ring */}
        <circle cx="50" cy="50" r="47" fill="none" stroke={`url(#${id.main})`} strokeWidth="1.1" opacity="0.9" />
        <circle className="flow" cx="50" cy="50" r="47" fill="none" stroke="#BAE6FD" strokeWidth="0.6" strokeDasharray="2 6" strokeLinecap="round" opacity="0.7" />
        <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(56,189,248,0.28)" strokeWidth="0.4" />

        {/* rotating comet arc */}
        <g className="spin">
          <circle cx="50" cy="50" r="44" fill="none" stroke={`url(#${id.comet})`} strokeWidth="1.6" strokeDasharray="34 240" strokeLinecap="round" />
        </g>

        {/* neural particles */}
        <g>
          {PARTICLES.map((p, i) => (
            <circle key={i} className="twk" cx={p.cx} cy={p.cy} r={p.r} fill={p.fill} style={{ animationDelay: `${p.delay}s` }} />
          ))}
        </g>
      </svg>
    </div>
  );
}
