/**
 * Spotlight field — full-screen interactive hero.
 *
 * MECHANIC: a near-invisible field of points. The cursor acts as a torch —
 * points within a soft radius warm up, the hairline connections between them
 * draw in, and the nearest few turn gold. Everything settles back to dark as
 * the cursor moves on. Darkness = silence (a missed call); light = presence
 * triggering a response.
 *
 * VISUAL LANGUAGE: deliberately a constellation, not a honeycomb. The first
 * version used hexagon tiles in saturated cyan and yellow, which read as
 * literal bees and toy-like — the exact things the original brief ruled out.
 * Fine points and hairlines read as a network of intelligence; one warm
 * accent keeps it restrained.
 *
 * PERFORMANCE: no render loop. Lighting is recomputed only on pointermove,
 * written straight to element style (never React state), and only when a
 * value has actually changed. CSS transitions handle the fade.
 *
 * ISOLATION: react and lucide-react only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

const VB_W = 1600;
const VB_H = 900;
const POINT_COUNT = 420;
const LINK_DIST = 92;
const INNER_R = 60; // full warmth within this radius
const OUTER_R = 300; // fully dormant beyond this radius
const GOLD_R = 120; // only the nearest points turn gold

interface Pt {
  x: number;
  y: number;
  r: number;
}

/** Deterministic PRNG — no Math.random, so every load is identical. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Golden-angle spiral reaching the corners of the frame, with enough jitter
 *  that no spiral arms are visible — it should read as an organic scatter. */
function buildPoints(): Pt[] {
  const rand = prng(0x5eed);
  const rMax = Math.hypot(VB_W / 2, VB_H / 2) * 1.04;
  const pts: Pt[] = [];
  for (let i = 0; i < POINT_COUNT; i++) {
    const t = i / POINT_COUNT;
    const angle = i * 2.399963229728653;
    const dist = Math.sqrt(t) * rMax;
    pts.push({
      x: VB_W / 2 + Math.cos(angle) * dist + (rand() - 0.5) * 46,
      y: VB_H / 2 + Math.sin(angle) * dist * 0.82 + (rand() - 0.5) * 46,
      // Mostly tiny, a few slightly larger — varied scale is what makes a
      // field read as depth rather than as a uniform pattern.
      r: rand() < 0.1 ? 2.4 + rand() * 0.8 : 1.1 + rand() * 0.9,
    });
  }
  return pts;
}

function buildLinks(pts: Pt[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < LINK_DIST) out.push([i, j]);
    }
  }
  return out;
}

function clientToSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: -9999, y: -9999 };
  return pt.matrixTransform(ctm.inverse());
}

export function HiveReveal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  const warmRefs = useRef<(SVGCircleElement | null)[]>([]);
  const goldRefs = useRef<(SVGCircleElement | null)[]>([]);
  const lineRefs = useRef<(SVGLineElement | null)[]>([]);
  const [reduced, setReduced] = useState<boolean | null>(null);
  const [touched, setTouched] = useState(false);

  const pts = useMemo(() => buildPoints(), []);
  const links = useMemo(() => buildLinks(pts), [pts]);

  // Last written values, so a pointermove only touches elements whose value
  // actually changed — most of the field is far from the cursor at any time.
  const lastWarm = useRef<Float32Array>(new Float32Array(POINT_COUNT));
  const lastGold = useRef<Float32Array>(new Float32Array(POINT_COUNT));
  const lastLine = useRef<Float32Array>(new Float32Array(0));

  // Entrance: a slow fade outward from the centre. Opacity only — no scale
  // pop, which was part of what read as playful in the first version.
  const entrance = useMemo(() => {
    const maxDist = Math.hypot(VB_W / 2, VB_H / 2);
    return pts.map((p) => Math.round((Math.hypot(p.x - VB_W / 2, p.y - VB_H / 2) / maxDist) * 1100));
  }, [pts]);

  // A few points near the headline breathe until first touch.
  const breatheSet = useMemo(() => {
    const ranked = pts
      .map((p, i) => ({ i, d: Math.hypot(p.x - VB_W / 2, p.y - VB_H * 0.42) }))
      .sort((a, b) => a.d - b.d);
    return new Set(ranked.slice(0, 5).map((w) => w.i));
  }, [pts]);

  useEffect(() => {
    lastLine.current = new Float32Array(links.length);
  }, [links]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => setReduced(mq.matches);
    decide();
    mq.addEventListener("change", decide);
    return () => mq.removeEventListener("change", decide);
  }, []);

  const write = (el: Element | null, store: Float32Array, i: number, v: number) => {
    if (!el || Math.abs(store[i] - v) < 0.01) return;
    store[i] = v;
    (el as SVGElement).style.opacity = v.toFixed(3);
  };

  const applyLight = useCallback(
    (px: number, py: number) => {
      const warmth = new Float32Array(pts.length);
      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - px, pts[i].y - py);
        const w = 1 - smoothstep(INNER_R, OUTER_R, d);
        warmth[i] = w;
        write(warmRefs.current[i], lastWarm.current, i, w);
        write(goldRefs.current[i], lastGold.current, i, 1 - smoothstep(20, GOLD_R, d));
      }
      for (let i = 0; i < links.length; i++) {
        const [a, b] = links[i];
        // A line needs BOTH ends lit to show — min rather than max keeps the
        // network local to the torch instead of trailing long spokes.
        write(lineRefs.current[i], lastLine.current, i, Math.min(warmth[a], warmth[b]) * 0.7);
      }
    },
    [pts, links],
  );

  const resetLight = useCallback(() => {
    for (let i = 0; i < pts.length; i++) {
      write(warmRefs.current[i], lastWarm.current, i, 0);
      write(goldRefs.current[i], lastGold.current, i, 0);
    }
    for (let i = 0; i < links.length; i++) write(lineRefs.current[i], lastLine.current, i, 0);
    if (haloRef.current) haloRef.current.style.opacity = "0";
  }, [pts, links]);

  useEffect(() => {
    if (reduced === null) return;
    const svg = svgRef.current;
    if (!svg) return;

    if (reduced) {
      applyLight(VB_W / 2, VB_H * 0.42);
      return;
    }

    const onMove = (e: PointerEvent) => {
      setTouched(true);
      const p = clientToSvgPoint(svg, e.clientX, e.clientY);
      applyLight(p.x, p.y);
      const halo = haloRef.current;
      const container = containerRef.current;
      if (halo && container) {
        const rect = container.getBoundingClientRect();
        halo.style.transform = `translate3d(${e.clientX - rect.left}px, ${e.clientY - rect.top}px, 0)`;
        halo.style.opacity = "1";
      }
    };
    const onLeave = () => resetLight();

    svg.addEventListener("pointermove", onMove, { passive: true });
    svg.addEventListener("pointerleave", onLeave, { passive: true });
    svg.addEventListener("pointercancel", onLeave, { passive: true });
    return () => {
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerleave", onLeave);
      svg.removeEventListener("pointercancel", onLeave);
    };
  }, [reduced, applyLight, resetLight]);

  return (
    <div className="st-reveal-hero" ref={containerRef} data-touched={touched}>
      <svg
        ref={svgRef}
        className="st-reveal-svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <g>
          {links.map(([a, b], i) => (
            <line
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              x1={pts[a].x}
              y1={pts[a].y}
              x2={pts[b].x}
              y2={pts[b].y}
              className="st-reveal-line"
            />
          ))}
        </g>
        <g>
          {pts.map((p, i) => (
            <circle
              key={`d${i}`}
              cx={p.x}
              cy={p.y}
              r={p.r}
              className="st-reveal-dot-dim"
              style={{ animationDelay: `${entrance[i]}ms` }}
            />
          ))}
        </g>
        <g>
          {pts.map((p, i) => (
            <circle
              key={`w${i}`}
              ref={(el) => {
                warmRefs.current[i] = el;
              }}
              cx={p.x}
              cy={p.y}
              r={p.r * 1.15}
              className={breatheSet.has(i) ? "st-reveal-dot-warm st-reveal-dot-breathe" : "st-reveal-dot-warm"}
              style={breatheSet.has(i) ? { animationDelay: `${(i % 5) * 600}ms` } : undefined}
            />
          ))}
        </g>
        <g>
          {pts.map((p, i) => (
            <circle
              key={`g${i}`}
              ref={(el) => {
                goldRefs.current[i] = el;
              }}
              cx={p.x}
              cy={p.y}
              r={p.r * 1.3}
              className="st-reveal-dot-gold"
            />
          ))}
        </g>
      </svg>

      {reduced === false && <div ref={haloRef} className="st-reveal-halo" aria-hidden="true" />}
      <div className="st-reveal-grain" aria-hidden="true" />

      <div className="st-reveal-copy">
        <div className="st-reveal-kicker">Autonomous voice agents</div>
        <h1 className="st-reveal-h1">
          Every call
          <br />
          answered.
        </h1>
        <p className="st-reveal-lede">
          WEBEE picks up in a natural voice, qualifies the caller, books them into your diary
          and writes it to your CRM, with nobody at the desk.
        </p>
        <div className="st-reveal-ctas">
          <span className="st-btn st-btn--primary">
            Start free <ArrowRight size={16} aria-hidden="true" />
          </span>
          <span className="st-btn st-btn--ghost">See it work</span>
        </div>
      </div>

      {reduced === false && (
        <p className={`st-reveal-hint${touched ? " st-reveal-hint--gone" : ""}`} aria-hidden="true">
          Move to explore
        </p>
      )}
    </div>
  );
}
