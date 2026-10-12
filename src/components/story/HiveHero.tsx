/**
 * Hero background.
 *
 * Currently the GLSL flow surface, used as atmosphere behind the headline.
 * the interim treatment while the commissioned hero object is produced — when
 * `public/models/hive-core.glb` lands, swap the lazy import below for
 * ./scenes/HeroModel and the static fallback for a still of the model.
 *
 * Progressive enhancement in the correct direction: the STATIC scene is what
 * the server renders and what hydrates. The 3D is an upgrade mounted only
 * inside an effect, only on a wide pointer-capable viewport, only when the
 * visitor has not asked for reduced motion.
 *
 * Deliberately NOT gated on useIsMobile(): that hook initialises to undefined
 * and returns false on the server AND on first client render, so branching on
 * it would hand every phone a WebGL context for at least one frame.
 */

import { Suspense, lazy, useEffect, useState } from "react";

const FlowSurface = lazy(() => import("./scenes/FlowSurface"));

export function HiveHero() {
  const [enhance, setEnhance] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 900px)");
    const fine = window.matchMedia("(pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const decide = () => setEnhance(wide.matches && fine.matches && !reduced.matches);
    decide();

    wide.addEventListener("change", decide);
    reduced.addEventListener("change", decide);
    return () => {
      wide.removeEventListener("change", decide);
      reduced.removeEventListener("change", decide);
    };
  }, []);

  return (
    <div className="st-hero-canvas" aria-hidden="true">
      <StaticRibbon />
      {enhance && (
        <Suspense fallback={null}>
          {/* GSAP ScrollTrigger watches the hero and scrubs the shader
              uniforms directly, so the surface flattens and fades as the
              section leaves rather than cutting out. */}
          <FlowSurface scrollTarget=".st-hero" offset={2.4} />
        </Suspense>
      )}
    </div>
  );
}

/**
 * The static hero. Not a placeholder — this is the real background for phones,
 * reduced-motion visitors, and anyone whose JS has not run. Same stacked-sine
 * envelope as the 3D ribbon, so the two read as the same object.
 */
function StaticRibbon() {
  const W = 1200;
  const H = 640;
  const MID = 430; // sits below the headline, matching the 3D version's drop

  // Three bands at decreasing opacity give depth without a second render pass.
  // `freqs` are whole numbers of cycles across the tile width — that is what
  // makes the path PERIODIC: at u=0 and u=1 every sin() term lands on the
  // same value, so two copies placed side by side meet with no seam, and a
  // CSS translateX(-W) loop repeats with no visible jump. `dur` is this
  // band's drift period in seconds; different per band gives parallax.
  const bands = [
    { amp: 1.0, phase: 0, w: 46, op: 0.5, freqs: [3, 7, 11] as const, dur: 34 },
    { amp: 0.78, phase: 0.9, w: 26, op: 0.28, freqs: [4, 9, 13] as const, dur: 48 },
    { amp: 0.6, phase: 1.9, w: 12, op: 0.16, freqs: [5, 10, 16] as const, dur: 61 },
  ];

  const wave = (amp: number, phase: number, thickness: number, freqs: readonly [number, number, number]) => {
    const top: string[] = [];
    const bottom: string[] = [];
    const N = 140;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const ang = u * Math.PI * 2;
      const x = u * W;
      const y =
        MID -
        (Math.sin(ang * freqs[0] + phase) * 62 +
          Math.sin(ang * freqs[1] - phase * 1.3) * 26 +
          Math.sin(ang * freqs[2] + phase * 0.6) * 11) *
          amp;
      // Thickness breathes at the same integer-cycle rate, so it is periodic
      // too — a tile with matching thickness at both ends.
      const t = thickness * (0.78 + 0.22 * Math.sin(ang * freqs[0] + phase));
      top.push(`${x.toFixed(1)},${(y - t).toFixed(1)}`);
      bottom.unshift(`${x.toFixed(1)},${(y + t).toFixed(1)}`);
    }
    return `M${top.join(" L")} L${bottom.join(" L")} Z`;
  };

  return (
    <svg
      className="st-hero-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      focusable="false"
    >
      <defs>
        <linearGradient id="st-ribbon-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffc940" />
          <stop offset="45%" stopColor="#8a9fc4" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      {bands.map((b, i) => {
        const d = wave(b.amp, b.phase, b.w, b.freqs);
        return (
          // Two copies, the second shifted by exactly one tile width. CSS
          // drifts the whole group left by -W and loops; because the path is
          // periodic the join between the two copies is invisible, and the
          // moment the loop resets is identical to the frame before it.
          <g key={i} className="st-wave-drift" style={{ animationDuration: `${b.dur}s` }}>
            <path d={d} fill="url(#st-ribbon-grad)" fillOpacity={b.op} />
            <path d={d} fill="url(#st-ribbon-grad)" fillOpacity={b.op} transform={`translate(${W}, 0)`} />
          </g>
        );
      })}
    </svg>
  );
}
