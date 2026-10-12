/**
 * Hero concept lab.
 *
 * Four 3D concepts in one identical composition — offset-right subject, text
 * in clear space on the left — so the comparison is about the CONCEPT and not
 * about differences in staging, lighting or type.
 *
 * Each scene is its own React.lazy chunk, so switching fetches only the one
 * you look at and three.js is never on the critical path.
 */

import { Suspense, lazy, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

const SCENES = [
  {
    id: "ribbon",
    name: "Voice ribbon",
    reads: "Reads as VOICE",
    note: "A single metallic ribbon undulating like a spoken waveform, gold at the near end bleeding to cool blue. Most on-brand for a voice product, and the least common treatment of the four.",
    load: () => import("./scenes/VoiceRibbon"),
  },
  {
    id: "shell",
    name: "Hive shell",
    reads: "Reads as HIVE / SCALE",
    note: "One large honeycomb dome. Cells light gold as calls land on them and settle back to steel — so gold finally means something instead of being scattered at random.",
    load: () => import("./scenes/HiveShell"),
  },
  {
    id: "streams",
    name: "Call streams",
    reads: "Reads as ROUTING / ALWAYS ON",
    note: "Gold pulses travelling along curved paths between glowing nodes. The most literal of the four — a visitor can guess what the product does from the picture alone.",
    load: () => import("./scenes/CallStreams"),
  },
  {
    id: "flow",
    name: "Flow surface (GLSL)",
    reads: "Reads as DEPTH / CRAFT",
    note: "Hand-written GLSL rather than a stock material: Fresnel rim, thin-film iridescence that shifts as the surface turns, a tracked specular glint, and colour driven by the surface’s own displacement. Scroll is wired through GSAP ScrollTrigger straight into a uniform. This is the Edolus stack — WebGL, GSAP, GLSL — and the ceiling is far above the stock-material scenes.",
    load: () => import("./scenes/FlowSurface"),
  },
  {
    id: "liquid",
    name: "Liquid metal",
    reads: "Reads as PREMIUM",
    note: "A chrome surface that breathes and morphs, reflecting a gold sky and a cool streak. The most striking of the four — but abstract. It says expensive software, not answers your phone.",
    load: () => import("./scenes/LiquidMetal"),
  },
  {
    id: "swarm",
    name: "Neural swarm",
    reads: "Reads as COLLECTIVE INTELLIGENCE",
    note: "~9,000 gold and cool particles flocking on a curl-noise field, pulled toward the cursor like a gravitational lure, imploding into formation on load via GSAP. Glow is faked with additive blending rather than a full postprocessing pipeline. The hive idea made literal as motion instead of as geometry.",
    load: () => import("./scenes/NeuralSwarm"),
  },
  {
    id: "loom",
    name: "Bio-loom",
    reads: "Reads as GROWTH / CONNECTION",
    note: "44 threads grow outward from a point via drawRange, pulsing in brightness and bending away from the cursor like something sensitive to touch. Reads as organic and connective — the workflow metaphor rendered as something that grows, rather than something that is drawn.",
    load: () => import("./scenes/BioLoom"),
  },
] as const;

type SceneId = (typeof SCENES)[number]["id"];

export function HeroLab() {
  const [active, setActive] = useState<SceneId>("ribbon");
  const [enhance, setEnhance] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 900px)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => setEnhance(wide.matches && !reduced.matches);
    decide();
    wide.addEventListener("change", decide);
    reduced.addEventListener("change", decide);
    return () => {
      wide.removeEventListener("change", decide);
      reduced.removeEventListener("change", decide);
    };
  }, []);

  const current = SCENES.find((s) => s.id === active)!;
  const Scene = lazy(current.load);

  return (
    <main className="webee-story lab">
      <div className="lab-stage">
        {enhance && (
          <Suspense fallback={null}>
            {/* key forces a clean remount so scenes never bleed into each other */}
            <Scene key={active} />
          </Suspense>
        )}

        {/* Offset-right composition: copy sits in clear space on the left. */}
        <div className="lab-copy">
          <div className="st-kicker">Autonomous voice agents</div>
          <h1 className="lab-h1">
            Every call
            <br />
            answered.
          </h1>
          <p className="st-lede" style={{ marginTop: 20, maxWidth: "34ch" }}>
            WEBEE picks up, qualifies the caller, books them in and writes it to your
            CRM — without anyone at the desk.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 30, flexWrap: "wrap" }}>
            <span className="st-btn st-btn--primary">
              Start free <ArrowRight size={16} aria-hidden="true" />
            </span>
            <span className="st-btn st-btn--ghost">Build one now</span>
          </div>
        </div>
      </div>

      {/* Switcher */}
      <div className="lab-bar">
        <div className="lab-tabs" role="tablist" aria-label="Hero concepts">
          {SCENES.map((s, i) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={active === s.id}
              className="lab-tab"
              data-active={active === s.id}
              onClick={() => setActive(s.id)}
            >
              <span className="lab-tab-num">{String(i + 1).padStart(2, "0")}</span>
              {s.name}
            </button>
          ))}
        </div>
        <div className="lab-note">
          <strong>{current.reads}</strong>
          <span>{current.note}</span>
        </div>
        {!enhance && (
          <p className="lab-warn">
            The 3D only runs at 900px+ with motion enabled. Widen the window to compare.
          </p>
        )}
      </div>
    </main>
  );
}
