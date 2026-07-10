import { useId } from "react";
import type { CSSProperties } from "react";

/**
 * AvaOrb — a sharp, premium, fully vector (SVG + CSS) animated orb used for the
 * floating "Call Ava" launcher and, optionally, inside the live Ava call modal.
 *
 * No raster images: everything is inline SVG with gradients + CSS keyframes, so
 * it stays crisp on retina / high-DPI screens and scales cleanly from the small
 * launcher size to the larger modal size.
 */

export type AvaOrbSize = "sm" | "lg" | number;
export type AvaOrbState = "idle" | "hover" | "speaking";

interface AvaOrbProps {
  size?: AvaOrbSize;
  state?: AvaOrbState;
  className?: string;
  style?: CSSProperties;
  /** Decorative by default — the launcher/button supplies the accessible label. */
  ariaHidden?: boolean;
}

const SIZE_MAP: Record<"sm" | "lg", number> = { sm: 66, lg: 168 };

/** Deterministic particle positions (no Math.random — SSR-hydration safe). */
const PARTICLES: Array<{ cx: number; cy: number; r: number; delay: number; fill: string }> = [
  { cx: 94, cy: 50, r: 0.9, delay: 0, fill: "#00D5FF" },
  { cx: 79, cy: 19, r: 0.8, delay: 0.5, fill: "#38BDF8" },
  { cx: 45, cy: 6, r: 1.0, delay: 1.1, fill: "#BAE6FD" },
  { cx: 13, cy: 25, r: 0.7, delay: 0.8, fill: "#38BDF8" },
  { cx: 5, cy: 55, r: 0.9, delay: 1.6, fill: "#00D5FF" },
  { cx: 21, cy: 84, r: 0.8, delay: 2.1, fill: "#BAE6FD" },
  { cx: 55, cy: 95, r: 1.0, delay: 1.3, fill: "#38BDF8" },
  { cx: 87, cy: 79, r: 0.7, delay: 2.6, fill: "#00D5FF" },
];

const ORB_STYLES = `
  @keyframes avaorb-spin { to { transform: rotate(360deg); } }
  @keyframes avaorb-spin-rev { to { transform: rotate(-360deg); } }
  @keyframes avaorb-glow { 0%, 100% { opacity: .6; transform: scale(1); } 50% { opacity: .92; transform: scale(1.06); } }
  @keyframes avaorb-twinkle { 0%, 100% { opacity: .12; } 50% { opacity: .85; } }

  .avaorb-svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .avaorb-svg .avaorb-rot { transform-box: fill-box; transform-origin: center; will-change: transform; }
  .avaorb-svg .avaorb-glow { transform-box: fill-box; transform-origin: center; will-change: opacity, transform; opacity: .72; }

  .avaorb-svg .avaorb-glow { animation: avaorb-glow 5s ease-in-out infinite; }
  .avaorb-svg .r-a { animation: avaorb-spin 16s linear infinite; }
  .avaorb-svg .r-b { animation: avaorb-spin-rev 22s linear infinite; }
  .avaorb-svg .r-c { animation: avaorb-spin 46s linear infinite; }
  .avaorb-svg .r-d { animation: avaorb-spin-rev 30s linear infinite; }
  .avaorb-svg .r-e { animation: avaorb-spin 20s linear infinite; }
  .avaorb-svg .r-f { animation: avaorb-spin-rev 26s linear infinite; }
  .avaorb-svg .avaorb-particles circle { animation: avaorb-twinkle 3.6s ease-in-out infinite; }

  .avaorb-svg[data-state="hover"] .avaorb-glow { opacity: .96; }
  .avaorb-svg[data-state="hover"] .r-a { animation-duration: 12s; }
  .avaorb-svg[data-state="hover"] .r-b { animation-duration: 16s; }
  .avaorb-svg[data-state="hover"] .r-e { animation-duration: 15s; }
  .avaorb-svg[data-state="hover"] .r-f { animation-duration: 19s; }

  .avaorb-svg[data-state="speaking"] .avaorb-glow { opacity: 1; animation-duration: 2s; }
  .avaorb-svg[data-state="speaking"] .r-a { animation-duration: 7s; }
  .avaorb-svg[data-state="speaking"] .r-b { animation-duration: 9s; }
  .avaorb-svg[data-state="speaking"] .r-c { animation-duration: 22s; }
  .avaorb-svg[data-state="speaking"] .r-d { animation-duration: 14s; }
  .avaorb-svg[data-state="speaking"] .r-e { animation-duration: 8s; }
  .avaorb-svg[data-state="speaking"] .r-f { animation-duration: 11s; }
  .avaorb-svg[data-state="speaking"] .avaorb-particles circle { animation-duration: 2s; }

  @media (prefers-reduced-motion: reduce) {
    .avaorb-svg .avaorb-rot,
    .avaorb-svg .avaorb-glow,
    .avaorb-svg .avaorb-particles circle { animation: none !important; }
    .avaorb-svg .avaorb-glow { opacity: .82; }
  }
`;

export function AvaOrb({ size = "sm", state = "idle", className, style, ariaHidden = true }: AvaOrbProps) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const px = typeof size === "number" ? size : SIZE_MAP[size];

  const id = {
    core: `${uid}-core`,
    glow: `${uid}-glow`,
    s1: `${uid}-s1`,
    s2: `${uid}-s2`,
    s3: `${uid}-s3`,
    hi: `${uid}-hi`,
  };

  const scale = state === "hover" ? 1.05 : state === "speaking" ? 1.03 : 1;
  const halo =
    state === "speaking"
      ? `0 0 ${Math.round(px * 0.72)}px rgba(56,189,248,0.55), 0 0 ${Math.round(px * 0.3)}px rgba(0,213,255,0.42)`
      : state === "hover"
        ? `0 0 ${Math.round(px * 0.6)}px rgba(56,189,248,0.42)`
        : `0 0 ${Math.round(px * 0.46)}px rgba(56,189,248,0.3)`;

  return (
    <span
      className={className}
      style={{
        display: "inline-block",
        width: px,
        height: px,
        borderRadius: "50%",
        background: "radial-gradient(circle at 50% 42%, #0a2a57 0%, #061936 46%, #020817 100%)",
        boxShadow: halo,
        transform: `scale(${scale})`,
        transition: "transform .3s ease, box-shadow .3s ease",
        ...style,
      }}
    >
      <style>{ORB_STYLES}</style>
      <svg className="avaorb-svg" data-state={state} viewBox="0 0 100 100" aria-hidden={ariaHidden}>
        <defs>
          <radialGradient id={id.core} cx="50%" cy="40%" r="65%">
            <stop offset="0%" stopColor="#0d3168" />
            <stop offset="45%" stopColor="#061936" />
            <stop offset="100%" stopColor="#020817" />
          </radialGradient>
          <radialGradient id={id.glow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(56,189,248,0.5)" />
            <stop offset="42%" stopColor="rgba(56,189,248,0.16)" />
            <stop offset="100%" stopColor="rgba(56,189,248,0)" />
          </radialGradient>
          <radialGradient id={id.hi} cx="50%" cy="34%" r="42%">
            <stop offset="0%" stopColor="rgba(186,230,253,0.35)" />
            <stop offset="100%" stopColor="rgba(186,230,253,0)" />
          </radialGradient>
          <linearGradient id={id.s1} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00D5FF" />
            <stop offset="100%" stopColor="#38BDF8" />
          </linearGradient>
          <linearGradient id={id.s2} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1E90FF" />
            <stop offset="100%" stopColor="#00D5FF" />
          </linearGradient>
          <linearGradient id={id.s3} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#BAE6FD" />
          </linearGradient>
        </defs>

        {/* soft centre glow */}
        <circle className="avaorb-glow" cx="50" cy="50" r="40" fill={`url(#${id.glow})`} />

        {/* dark navy centre + subtle top highlight + rim */}
        <circle cx="50" cy="50" r="24" fill={`url(#${id.core})`} />
        <circle cx="50" cy="50" r="24" fill={`url(#${id.hi})`} />
        <circle cx="50" cy="50" r="24" fill="none" stroke="rgba(56,189,248,0.28)" strokeWidth="0.5" />

        {/* outer fine dotted ring */}
        <g className="avaorb-rot r-c">
          <circle cx="50" cy="50" r="47" fill="none" stroke="rgba(186,230,253,0.34)" strokeWidth="0.5" strokeDasharray="1.5 4.5" />
        </g>

        {/* bright comet-arc rings */}
        <g className="avaorb-rot r-a">
          <circle cx="50" cy="50" r="40" fill="none" stroke={`url(#${id.s1})`} strokeWidth="1.1" strokeDasharray="44 210" strokeLinecap="round" />
        </g>
        <g className="avaorb-rot r-b">
          <circle cx="50" cy="50" r="34" fill="none" stroke={`url(#${id.s2})`} strokeWidth="1.4" strokeDasharray="22 170" strokeLinecap="round" />
        </g>
        <g className="avaorb-rot r-d">
          <circle cx="50" cy="50" r="29" fill="none" stroke={`url(#${id.s3})`} strokeWidth="0.7" strokeDasharray="9 13" />
        </g>

        {/* orbit / wave paths */}
        <g className="avaorb-rot r-e">
          <ellipse cx="50" cy="50" rx="44" ry="17" fill="none" stroke="rgba(0,213,255,0.28)" strokeWidth="0.5" />
        </g>
        <g className="avaorb-rot r-f">
          <ellipse cx="50" cy="50" rx="17" ry="44" fill="none" stroke="rgba(30,144,255,0.22)" strokeWidth="0.5" />
        </g>

        {/* subtle particles */}
        <g className="avaorb-particles">
          {PARTICLES.map((p, i) => (
            <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.fill} style={{ animationDelay: `${p.delay}s` }} />
          ))}
        </g>
      </svg>
    </span>
  );
}
