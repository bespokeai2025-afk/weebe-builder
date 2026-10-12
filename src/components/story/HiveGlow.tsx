/**
 * /hive-glow — backlit hex wall hero, built from the owner's reference mock:
 * copy on the left, a wall of dark hexagonal blocks on the right, warm light
 * coming from BEHIND the wall and following the cursor.
 *
 * Progressive enhancement, same rules as the rest of the story pages:
 *   - the server renders StaticWall (an SVG of the same idea, lit from a fixed
 *     point) — that is also what phones and reduced-motion visitors keep;
 *   - the three.js wall mounts in an effect, only at >=900px with a fine
 *     pointer and no reduced-motion preference, via React.lazy so three.js is
 *     never in this route's chunk.
 *
 * ISOLATION: react, lucide-react and ./scenes only.
 */

import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { ArrowRight, Play, Menu, X } from "lucide-react";
import logoWebee from "@/assets/webee-logo-yellow.png";
import { HowItWorks, HotLeads, IndustryCards } from "./GlowSections";
import {
  BuilderSection,
  OutcomeSection,
  CallbackSection,
  TrustSection,
  FinalCta,
  Footer,
} from "./StoryPage";
import { SocialProof } from "./SocialProof";

const HexBacklight = lazy(() => import("./scenes/HexBacklight"));

/** If the 3D wall throws (WebGL lost, a stale chunk after a deploy, a driver
 *  bug), report it so the hero falls back to the still wall instead of going
 *  black. */
class WallBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The full page. Order follows the hero's promise:
 *   hero → how it works → hottest leads (the payoff) → try it yourself (the
 *   node demo) → what one call is worth → callback capture → proof → use
 *   cases → trust → final CTA.
 * The reused /v2 sections are wrapped in .st-theme-glow, which re-points the
 * story tokens at this page's near-black and warm borders — no duplicated
 * components, just a different token scope.
 */
/**
 * Carries the hero's cursor light down the page: a soft gold pool follows the
 * pointer behind the content, and cards near it catch the light on their
 * edge. Desktop + fine pointer + no reduced motion only; otherwise nothing
 * is attached and the page renders exactly as before. Card coordinates are
 * set per card (relative to its own box) rather than with fixed-attachment
 * backgrounds, which break inside transformed ancestors.
 */
function useCursorLight(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const ok = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    if (!ok.matches) return;
    const pool = root.querySelector<HTMLElement>(".st-cursor-glow");
    const cards = Array.from(
      root.querySelectorAll<HTMLElement>(".st-card, .st-metric, .st-panel, .st-lead, .st-gx-step"),
    );
    root.dataset.cursorLight = "on";

    const OFF = -10000;
    const REACH = 260; // px beyond a card's edge at which it starts to catch light
    let x = OFF;
    let y = OFF;
    let raf = 0;
    const paint = () => {
      raf = 0;
      const r = root.getBoundingClientRect();
      if (pool) {
        pool.style.transform = `translate3d(${x - r.left}px, ${y - r.top}px, 0)`;
        // Fade out as the pointer nears the hero, so the clipped top edge of
        // the pool never shows as a line where the sections begin.
        pool.style.opacity = String(Math.min(1, Math.max(0, (y - r.top) / 400)));
      }
      for (const el of cards) {
        const b = el.getBoundingClientRect();
        const near =
          x > b.left - REACH && x < b.right + REACH && y > b.top - REACH && y < b.bottom + REACH;
        if (near) {
          el.style.setProperty("--cx", `${x - b.left}px`);
          el.style.setProperty("--cy", `${y - b.top}px`);
          el.dataset.lit = "1";
        } else if (el.dataset.lit) {
          el.style.removeProperty("--cx");
          el.style.removeProperty("--cy");
          delete el.dataset.lit;
        }
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      schedule();
    };
    const onLeave = () => {
      x = OFF;
      y = OFF;
      schedule();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", schedule);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      delete root.dataset.cursorLight;
    };
  }, [ref]);
}

/**
 * Smooth, inertial wheel scrolling (Lenis), /hive-glow only. Loaded as its
 * own small chunk after first paint. Off with reduced motion; touch keeps
 * native scrolling (Lenis does not smooth touch by default). Lenis still
 * drives the real window scroll, so scroll listeners, the IntersectionObserver
 * frameloop gate and position: sticky all keep working.
 *
 * In-page links (#how, #build, the skip link) glide to their target, then
 * move keyboard focus there too, as a native anchor jump would.
 */
function useSmoothScroll() {
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    let cancelled = false;
    let lenis: { destroy(): void; scrollTo(t: HTMLElement, o?: object): void } | null = null;

    const onClick = (e: MouseEvent) => {
      if (!lenis || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
      const id = a?.getAttribute("href")?.slice(1);
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      e.preventDefault();
      history.pushState(null, "", `#${id}`);
      lenis.scrollTo(target, { duration: 1.2 });
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    };

    import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      lenis = new Lenis({
        lerp: 0.085, // lower = floatier; 0.08-0.1 is the usual premium feel
        wheelMultiplier: 1,
        smoothWheel: true,
        allowNestedScroll: true, // inner scroll areas scroll themselves
        autoRaf: true,
      });
      document.addEventListener("click", onClick);
    });
    return () => {
      cancelled = true;
      document.removeEventListener("click", onClick);
      lenis?.destroy();
    };
  }, []);
}

export function HiveGlowPage() {
  const lit = useRef<HTMLDivElement>(null);
  useCursorLight(lit);
  useSmoothScroll();
  return (
    <>
      <a href="#main-content" className="st-skip">
        Skip to content
      </a>
      <HiveGlow />
      <div className="st-theme-glow" id="main-content" ref={lit}>
        <HowItWorks />
        <HotLeads />
        <BuilderSection />
        <OutcomeSection />
        <CallbackSection />
        {/* Hidden until real, permissioned quotes exist (audit #4). It reappears
            automatically once TESTIMONIALS in SocialProof.tsx is filled. */}
        <SocialProof showPlaceholders={false} />
        <IndustryCards />
        <TrustSection />
        {/* No icon, and no "No card required" line until that's confirmed. */}
        <FinalCta ctaLabel="Get Started" icon={false} fineprint={null} />
        <Footer />
        <div className="st-cursor-glow" aria-hidden="true" />
      </div>
    </>
  );
}

export function HiveGlow() {
  const [enhance, setEnhance] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [wallReady, setWallReady] = useState(false);

  // Safety net: on desktop the still wall is hidden at startup so the live
  // one can fade in out of the dark. If the live wall hasn't drawn within 6s
  // (slow network, GPU trouble), show the still wall rather than an empty
  // hero. If the live wall arrives later it still fades in on top.
  useEffect(() => {
    if (!enhance || wallReady) return;
    const t = setTimeout(() => setFallback(true), 6000);
    return () => clearTimeout(t);
  }, [enhance, wallReady]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    // The live wall runs on every device (owner, 2026-10-10: "3D everywhere"),
    // with a lighter render on touch screens (see HexBacklight). It is skipped
    // only for reduced motion, Data Saver, or no WebGL (blocked, old GPU,
    // hardware acceleration off) — those keep the still wall. CSS hides the
    // still wall at startup so the hero opens on black and the live wall fades
    // in; data-wall="fallback" brings it back.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const saveData = !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      ?.saveData;
    const canvas = document.createElement("canvas");
    const webgl = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    if (!webgl || saveData) setFallback(true);
    const decide = () => setEnhance(webgl && !saveData && !reduced.matches);
    decide();
    reduced.addEventListener("change", decide);
    return () => reduced.removeEventListener("change", decide);
  }, []);

  return (
    <div className="st-glow" data-wall={fallback ? "fallback" : undefined}>
      <div className="st-glow-scene" aria-hidden="true">
        <StaticWall />
        {enhance && (
          <WallBoundary onError={() => setFallback(true)}>
            <Suspense fallback={null}>
              <HexBacklight onReady={() => setWallReady(true)} />
            </Suspense>
          </WallBoundary>
        )}
      </div>
      {/* Left-side fade so the copy always sits on near-black, whatever the
          light is doing on the wall. */}
      <div className="st-glow-fade" aria-hidden="true" />

      <header className="st-glow-nav st-enter" style={{ "--d": "80ms" } as CSSProperties}>
        <div className="st-glow-brand">
          <img src={logoWebee} alt="" width={26} height={26} />
          <span>WEBEE</span>
        </div>
        <nav aria-label="Primary" className="st-glow-links">
          <a href="#product">Product</a>
          <a href="#how">How it works</a>
          <a href="/pricing">Pricing</a>
          <a href="/docs">Resources</a>
        </nav>
        <div className="st-glow-nav-right">
          <a href="/signup" className="st-glow-btn st-glow-btn--primary st-glow-btn--sm">
            Get Started
          </a>
          {/* Phones: the links above are hidden under 760px, so this menu is
              the only way to reach them (audit #2). */}
          <button
            type="button"
            className="st-glow-menu"
            aria-expanded={menuOpen}
            aria-controls="glow-mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
        {menuOpen && (
          <nav id="glow-mobile-nav" aria-label="Mobile" className="st-glow-mobile">
            {[
              ["#product", "Product"],
              ["#how", "How it works"],
              ["/pricing", "Pricing"],
              ["/docs", "Resources"],
            ].map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)}>
                {label}
              </a>
            ))}
          </nav>
        )}
      </header>

      {/* Startup sequence, timed against the backlight fading up (~1.4s):
          nav → pill → each headline line rises out of its own mask → lede
          sharpens in → CTAs. The --d delays live here so the order is
          readable in one place; the motion itself is CSS (see "STARTUP
          SEQUENCE" in story.css) and is skipped entirely under reduced
          motion, where everything is simply present. */}
      <div className="st-glow-copy">
        <div className="st-glow-pill st-enter" style={{ "--d": "260ms" } as CSSProperties}>
          AI receptionist platform
        </div>
        <h1 className="st-glow-h1">
          <span className="st-line">
            <span style={{ "--d": "420ms" } as CSSProperties}>No lead</span>
          </span>{" "}
          {/* ^ The lines are visually separate blocks, but without this space
              screen readers, search engines and copy-paste read "No leadwill"
              (audit #1). No visual effect. */}
          <span className="st-line">
            <span style={{ "--d": "560ms" } as CSSProperties}>
              will be <em className="st-glow-em">missed.</em>
            </span>
          </span>
        </h1>
        <p className="st-glow-lede st-enter st-enter--soft" style={{ "--d": "900ms" } as CSSProperties}>
          AI calls, qualifies and gives you your 10 hottest leads.
        </p>
        <div className="st-glow-ctas st-enter" style={{ "--d": "1080ms" } as CSSProperties}>
          <a href="/signup" className="st-glow-btn st-glow-btn--primary">
            Get Started <ArrowRight size={16} aria-hidden="true" />
          </a>
          <a href="#build" className="st-glow-btn st-glow-btn--ghost">
            <Play size={14} aria-hidden="true" /> Try the demo
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * The static version: the same pointy-top hex wall in SVG, lit by a fixed
 * radial glow behind it. Not a placeholder — it is the real hero for phones,
 * reduced motion, and the first paint before the 3D loads.
 */
function StaticWall() {
  const cells = useMemo(() => {
    const R = 46;
    const w = Math.sqrt(3) * R;
    const h = 1.5 * R;
    const out: string[] = [];
    for (let r = -1; r < 15; r++) {
      for (let c = -1; c < 14; c++) {
        const cx = 620 + c * w + (((r % 2) + 2) % 2) * (w / 2);
        const cy = r * h;
        const pts: string[] = [];
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + (i * Math.PI) / 3;
          pts.push(`${(cx + Math.cos(a) * R * 0.86).toFixed(1)},${(cy + Math.sin(a) * R * 0.86).toFixed(1)}`);
        }
        out.push(pts.join(" "));
      }
    }
    return out;
  }, []);

  return (
    <svg className="st-glow-static" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <radialGradient id="st-glow-back" cx="68%" cy="48%" r="38%">
          <stop offset="0%" stopColor="#ffd28a" />
          <stop offset="25%" stopColor="#ffa726" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#b35f00" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#070504" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="st-glow-warm" cx="68%" cy="48%" r="30%">
          <stop offset="0%" stopColor="#c9861f" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#7a4c0e" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="st-glow-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a1d24" />
          <stop offset="100%" stopColor="#08090c" />
        </linearGradient>
      </defs>
      <rect width="1600" height="900" fill="#070504" />
      <rect width="1600" height="900" fill="url(#st-glow-back)" />
      {cells.map((p, i) => (
        <polygon key={i} points={p} fill="url(#st-glow-face)" stroke="#3a2a14" strokeWidth="1" />
      ))}
      {/* Gold wash over the faces around the light, matching the live wall's
          per-block tint so the static version isn't just black tiles. */}
      <rect width="1600" height="900" fill="url(#st-glow-warm)" style={{ mixBlendMode: "screen" }} />
    </svg>
  );
}
