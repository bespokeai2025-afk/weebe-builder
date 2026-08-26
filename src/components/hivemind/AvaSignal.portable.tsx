import { useEffect, useRef, useState } from "react";
import { getAvaLevels } from "./avaAudioStub";

type Phase = "idle" | "connecting" | "listening" | "speaking" | "ended";
type Hsl = { hue: number; saturation: number; lightness: number };

export type AvaSignalStep = "idle" | "connecting" | "live" | "complete" | "error";
export type AvaBookingState = "idle" | "processing" | "confirmed" | "failed";

export type AvaSignalProps = {
  className?: string;
  hovered?: boolean;
  dark?: boolean;
  step?: AvaSignalStep;
  agentSpeaking?: boolean;
  bookingState?: AvaBookingState;
};

type Particle = {
  a: number;
  r: number;
  arm: number;
  pocket: boolean;
  s: number;
  tilt: number;
  yOff: number;
  size: number;
  light: number;
  alpha: number;
  tw: number;
  tws: number;
  tw2: number;
  tws2: number;
  react: number;
  drift: number;
  driftS: number;
  spiral: number;
  hue: number;
  kind: 0 | 1 | 2 | 3;
  link: boolean;
  trail: boolean;
  focal: boolean;
  glint: boolean;
};

type Node = {
  r: number;
  a: number;
  s: number;
  tilt: number;
  yOff: number;
  size: number;
  hue: number;
};

type NodeLink = {
  a: number;
  b: number;
  ph: number;
  sp: number;
  bow: number;
};

type StarLink = {
  a: number;
  b: number;
  age: number;
  dur: number;
  bow: number;
  hue: number;
};

const TAU = Math.PI * 2;
const ARM_BASE = [-0.75, 1.7, 3.9];
const ARM_WIDTH = [0.34, 0.5, 0.62];
const LAYER_SPEED = [1.7, 1.1, 0.6];
const LAYER_ALPHA = [1, 0.94, 0.8];

const FILAMENTS = [
  { a: -0.42, off: 0.1, len: 1.55, wid: 0.4, sp: 0.31, ph: 0, hue: 189, lig: 92, al: 1 },
  { a: 0.85, off: 0.22, len: 1.12, wid: 0.3, sp: 0.23, ph: 1.9, hue: 196, lig: 78, al: 0.9 },
  { a: 2.05, off: 0.34, len: 0.86, wid: 0.24, sp: 0.41, ph: 3.4, hue: 203, lig: 66, al: 0.8 },
  { a: -1.62, off: 0.18, len: 0.7, wid: 0.21, sp: 0.27, ph: 5.1, hue: 186, lig: 84, al: 0.7 },
  { a: 2.75, off: 0.46, len: 0.58, wid: 0.16, sp: 0.35, ph: 2.4, hue: 246, lig: 60, al: 0.5 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function ease(current: number, target: number, tau: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function phaseFor(step: AvaSignalStep, speaking: boolean): Phase {
  if (step === "connecting") return "connecting";
  if (step === "live" && speaking) return "speaking";
  if (step === "live") return "listening";
  if (step === "complete" || step === "error") return "ended";
  return "idle";
}

function hueRange(roll: number, mobile: boolean): Hsl {
  if (mobile) {
    if (roll < 0.42) return { hue: rand(184, 192), saturation: 98, lightness: rand(58, 74) };
    if (roll < 0.7) return { hue: rand(202, 214), saturation: 98, lightness: rand(58, 74) };
    if (roll < 0.86) return { hue: rand(220, 232), saturation: 98, lightness: rand(58, 74) };
    return { hue: rand(248, 268), saturation: 98, lightness: rand(58, 74) };
  }
  if (roll < 0.44) return { hue: rand(186, 195), saturation: 98, lightness: rand(58, 74) };
  if (roll < 0.72) return { hue: rand(202, 214), saturation: 98, lightness: rand(58, 74) };
  if (roll < 0.9) return { hue: rand(196, 202), saturation: 98, lightness: rand(58, 74) };
  return { hue: rand(248, 258), saturation: 98, lightness: rand(58, 74) };
}

function pickArm(): number {
  const roll = Math.random();
  return roll < 0.46 ? 0 : roll < 0.784 ? 1 : 2;
}

function armAngle(radius: number, arm: number): number {
  if (Math.random() < 0.16) return rand(0, TAU);
  return ARM_BASE[arm] + radius * 2.1 + rand(-ARM_WIDTH[arm], ARM_WIDTH[arm]);
}

function stretch(angle: number, t: number, anisotropy: [number, number, number], strength: number): number {
  return (
    1 +
    0.16 * Math.sin(angle + anisotropy[0] + t * 0.045 * strength) +
    0.1 * Math.sin(angle * 2 + anisotropy[1] - t * 0.031 * strength) +
    0.055 * Math.sin(angle * 3 + anisotropy[2] + t * 0.019 * strength)
  );
}

function makePart(reduced: boolean, mobile: boolean): Particle {
  const n = Math.random();
  const kind: Particle["kind"] = n < 0.88 ? 0 : n < 0.96 ? 1 : n < 0.99 ? 2 : 3;
  const arm = pickArm();
  const roll = Math.random();
  const radius =
    (roll < 0.22
      ? Math.pow(Math.random(), 0.5) * 0.38 + 0.9
      : roll < 0.52
        ? Math.pow(Math.random(), 0.9) * 0.38 + 0.52
        : Math.pow(Math.random(), 1.7) * 0.5 + 0.1) *
    (arm === 0 ? 1.62 : arm === 1 ? 1.24 : 1.4);
  const color = hueRange(Math.random(), mobile);
  return {
    a: armAngle(radius, arm),
    r: radius,
    arm,
    pocket: false,
    s: rand(0.14, 0.3) * (Math.random() < 0.14 ? -1 : 1),
    tilt: rand(0.36, 0.72),
    yOff: rand(-0.12, 0.12),
    size: kind === 3 ? rand(0.85, 1.1) : kind === 1 ? rand(0.65, 0.92) : rand(0.4, 0.78),
    light: kind === 3 ? rand(68, 80) : color.lightness,
    alpha: kind === 0 ? rand(0.55, 0.92) : rand(0.6, 0.95),
    tw: rand(0, TAU),
    tws: reduced ? rand(0.06, 0.16) : rand(0.2, 0.8),
    tw2: rand(0, TAU),
    tws2: reduced ? rand(0.04, 0.1) : rand(0.12, 0.42),
    react: Math.pow(Math.random(), 1.5),
    drift: rand(0, TAU),
    driftS: reduced ? rand(0.03, 0.08) : rand(0.1, 0.3),
    spiral: rand(0.5, 1.15),
    hue: color.hue,
    kind,
    link: false,
    trail: false,
    focal: false,
    glint: false,
  };
}

function makeMicro(reduced: boolean, mobile: boolean): Particle {
  const pocket = Math.random() < 0.16;
  const arm = pickArm();
  const zone = Math.random();
  const reach = arm === 0 ? 1.62 : arm === 1 ? 1.24 : 1.4;
  const radial = pocket
    ? rand(0.5, 1)
    : zone > 0.78
      ? Math.pow(Math.random(), 0.5) * 0.42 + 0.9
      : zone > 0.5
        ? Math.pow(Math.random(), 0.85) * 0.44 + 0.5
        : Math.pow(Math.random(), 1.7) * 0.46 + 0.12;
  const tier = Math.random();
  const focal = tier > 0.991;
  const anchor = tier > 0.965;
  const color = hueRange(Math.random(), mobile);
  return {
    a: pocket ? rand(0, TAU) : armAngle(radial, arm),
    r: radial * reach,
    arm,
    pocket,
    s: rand(0.15, 0.3) * (radial > 0.9 ? 0.6 : 1),
    tilt: rand(0.38, 0.7),
    yOff: rand(-0.1, 0.1),
    size: focal ? rand(1.15, 1.45) : anchor ? rand(0.95, 1.18) : tier > 0.8 ? rand(0.8, 0.98) : tier > 0.46 ? rand(0.62, 0.82) : rand(0.38, 0.62),
    light: focal ? rand(84, 96) : anchor ? rand(72, 86) : tier > 0.8 ? rand(62, 78) : rand(56, 70),
    alpha: focal ? rand(0.94, 1) : anchor ? rand(0.88, 1) : tier > 0.8 ? rand(0.7, 0.9) : tier > 0.46 ? rand(0.62, 0.82) : rand(0.5, 0.78),
    tw: rand(0, TAU),
    tws: reduced ? rand(0.08, 0.2) : rand(0.35, 1.1),
    tw2: rand(0, TAU),
    tws2: reduced ? rand(0.04, 0.1) : rand(0.12, 0.42),
    react: Math.pow(Math.random(), 1.6),
    drift: rand(0, TAU),
    driftS: reduced ? rand(0.03, 0.08) : rand(0.1, 0.3),
    spiral: rand(0.6, 1.3),
    hue: color.hue,
    kind: 0,
    link: anchor || focal ? true : tier > 0.62 ? Math.random() < 0.8 : Math.random() < 0.4,
    trail: !reduced && Math.random() < 0.02,
    focal,
    glint: (focal || anchor) && Math.random() < 0.45,
  };
}

function makeNodes(reduced: boolean, mobile: boolean): Node[] {
  const count = reduced ? 6 : mobile ? 8 : 11;
  return Array.from({ length: count }, (_, i) => ({
    r: rand(0.2, 0.66),
    a: (i / count) * TAU + rand(-0.3, 0.3),
    s: rand(0.05, 0.11),
    tilt: rand(0.3, 0.48),
    yOff: rand(-0.06, 0.06),
    size: Math.random() < 0.22 ? rand(1.15, 1.4) : rand(0.85, 1.15),
    hue: Math.random() < 0.62 ? rand(186, 196) : Math.random() < 0.5 ? rand(204, 214) : rand(242, 250),
  }));
}

function makeNodeLinks(reduced: boolean, mobile: boolean, nodes: Node[]): NodeLink[] {
  const count = reduced ? 3 : mobile ? 4 : 6;
  return Array.from({ length: count }, (_, i) => ({
    a: i % nodes.length,
    b: (i + 1 + Math.floor(Math.random() * Math.max(1, nodes.length - 1))) % nodes.length,
    ph: rand(0, TAU),
    sp: reduced ? rand(0.04, 0.09) : rand(0.14, 0.3),
    bow: rand(-0.22, 0.22),
  }));
}

function hsla(hue: number, saturation: number, lightness: number, alpha: number): string {
  return `hsla(${hue} ${saturation}% ${clamp(lightness, 0, 100)}% / ${clamp(alpha, 0, 1)})`;
}

function lightFor(light: number, dark: boolean, mobile: boolean): number {
  if (!dark) return Math.min(98, light);
  if (mobile) return clamp(38, 78, 56 + (light - 60) * 0.42);
  return Math.min(98, light + 16);
}

function layerFor(radius: number, micro: boolean): number {
  if (micro) return radius < 0.36 ? 0 : radius < 0.68 ? 1 : 2;
  return radius < 0.34 ? 0 : radius < 0.68 ? 1 : 2;
}

export function AvaSignal({
  className = "",
  hovered = false,
  dark = true,
  step = "idle",
  agentSpeaking = false,
  bookingState = "idle",
}: AvaSignalProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedRef = useRef(false);
  const propsRef = useRef({ hovered, dark, step, agentSpeaking, bookingState });
  const [reduced, setReduced] = useState(false);

  propsRef.current = { hovered, dark, step, agentSpeaking, bookingState };
  reducedRef.current = reduced;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let mobile = window.matchMedia("(max-width: 640px)").matches;
    let width = 1;
    let height = 1;
    let animationFrame = 0;
    let running = true;
    let last = performance.now();
    let t = 0;
    let hoverValue = 0;
    let energyValue = 0;
    let greenValue = 0;
    let previousVoice = 0;
    let hoverWasActive = false;
    let hoverRipple = 2;
    let voiceRipple = 2;
    let successAge = Number.POSITIVE_INFINITY;
    let previousBooking = propsRef.current.bookingState;
    let linkAccumulator = 0;
    let nextLinkIn = rand(0.08, 0.2);
    let anisotropy: [number, number, number] = [rand(0, TAU), rand(0, TAU), rand(0, TAU)];
    let parts: Particle[] = [];
    let microStars: Particle[] = [];
    let nodes: Node[] = [];
    let nodeLinks: NodeLink[] = [];
    let starLinks: StarLink[] = [];
    let microPositions: Array<{ x: number; y: number; z: number; rBase: number }> = [];

    function resize() {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      mobile = window.matchMedia("(max-width: 640px)").matches;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const seed = () => {
      const isReduced = reducedRef.current;
      parts = Array.from({ length: isReduced ? 150 : mobile ? 300 : 380 }, () => makePart(isReduced, mobile));
      microStars = Array.from({ length: isReduced ? 150 : mobile ? 360 : 430 }, () => makeMicro(isReduced, mobile));
      nodes = makeNodes(isReduced, mobile);
      nodeLinks = makeNodeLinks(isReduced, mobile, nodes);
      starLinks = [];
      microPositions = [];
      anisotropy = [rand(0, TAU), rand(0, TAU), rand(0, TAU)];
    };

    function position(
      particle: Particle,
      radius: number,
      spread: number,
      now: number,
      voice: number,
      micro: boolean,
      ripple: number,
    ) {
      const rBase = particle.r * (1 + Math.sin(particle.drift) * (micro ? 0.06 : 0.05));
      const angle = particle.a + rBase * particle.spiral;
      const rr =
        rBase *
        radius *
        spread *
        stretch(angle, now, anisotropy, reducedRef.current ? 0.25 : 1) *
        (1 + particle.react * voice * 0.06) *
        (1 + ripple * 0.012);
      const x = width * 0.5 + radius * 0.04 + Math.cos(angle) * rr;
      const z = Math.sin(angle);
      const y = height * 0.5 - radius * 0.03 + z * rr * particle.tilt + particle.yOff * radius;
      return { x, y, z, rBase };
    }

    function drawGradientDot(x: number, y: number, radius: number, color: string, alpha: number) {
      if (![x, y, radius].every(Number.isFinite)) return;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(0.1, radius));
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, color.replace(/\/ [^)]+\)/, "/ 0)"));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.1, radius), 0, TAU);
      ctx.fill();
      void alpha;
    }

    function drawParticles(
      particleSet: Particle[],
      radius: number,
      spread: number,
      now: number,
      voice: number,
      mid: number,
      hoverAmount: number,
      energy: number,
      success: number,
      isMicro: boolean,
      aBoost: number,
      positions?: Array<{ x: number; y: number; z: number; rBase: number }>,
    ) {
      particleSet.forEach((particle, index) => {
        const p = position(
          particle,
          radius,
          spread,
          now,
          voice,
          isMicro,
          isMicro ? hoverRipple : voiceRipple,
        );
        if (positions) positions[index] = p;
        const depth = p.z;
        const layer = layerFor(particle.r, isMicro);
        const layerAlpha = LAYER_ALPHA[layer];
        if (!isMicro) {
          const twinkle = 0.6 + 0.4 * Math.sin(particle.tw + now * particle.tws);
          const alpha = clamp(
            particle.alpha *
              twinkle *
              (0.55 + (depth + 1) * 0.4) *
              layerAlpha *
              (1 + hoverAmount * 0.28 + energy * 0.2 + success * 0.5) *
              (1 + particle.react * (voice * 0.55 + mid * 0.2)) *
              aBoost,
            0,
            1,
          );
          const hue = particle.hue + Math.sin(now * 0.0002 + particle.a) * 1.5;
          const color = hsla(hue, 98, lightFor(particle.light, dark, mobile), alpha);
          if (particle.kind === 3) {
            drawGradientDot(p.x, p.y, particle.size * 1.25, hsla(hue, 98, lightFor(particle.light, dark, mobile), alpha * 0.4), alpha);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(0.4, particle.size * 0.62), 0, TAU);
            ctx.fill();
          } else if (particle.kind === 2) {
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(0.4, particle.size * 0.5);
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(
              p.x - Math.sin(particle.a) * particle.size * 2.3 * (1 + voice * 0.2 + hoverAmount * 0.15),
              p.y + Math.cos(particle.a) * particle.size * 2.3 * (1 + voice * 0.2 + hoverAmount * 0.15),
            );
            ctx.stroke();
          } else {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(0.35, particle.size), 0, TAU);
            ctx.fill();
          }
        } else {
          const shimmer =
            (0.66 + 0.34 * Math.sin(particle.tw + now * particle.tws)) *
            (0.82 + 0.18 * Math.sin((particle.tw2 + now * particle.tws2) * 1.31 + 0.7));
          const nearCore = Math.max(0, 1 - p.rBase / 0.55);
          const lit = 1 + Math.max(0, 1 - p.rBase / 0.4) * 0.35;
          const alpha = clamp(
            particle.alpha *
              shimmer *
              (0.55 + (depth + 1) * 0.3) *
              lit *
              layerAlpha *
              (1 + hoverAmount * 0.32 + energy * 0.15 + success * 0.45) *
              (1 + particle.react * (voice * 0.55 + mid * 0.2) + nearCore * voice * 0.3) *
              aBoost,
            0,
            1,
          );
          const rad = clamp(
            0.32,
            1.5,
            particle.size * (0.55 + (depth + 1) * 0.3) * (1 + nearCore * voice * 0.12) * (mobile ? 1.18 : 1),
          );
          const hue = particle.hue + Math.sin(now * 0.00016 + particle.a) * 1.2;
          const light = lightFor(particle.light, dark, mobile);
          if (particle.focal) {
            drawGradientDot(p.x, p.y, rad * 1.35, hsla(hue, 98, light, alpha * 0.32), alpha);
          }
          if (particle.trail) {
            ctx.strokeStyle = hsla(hue, 98, light, alpha);
            ctx.lineWidth = Math.max(0.35, rad * 0.45);
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - Math.sin(particle.a) * rad * 1.9, p.y + Math.cos(particle.a) * rad * 1.9);
            ctx.stroke();
          }
          ctx.fillStyle = hsla(hue, 98, light, alpha);
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad, 0, TAU);
          ctx.fill();
          if (particle.glint) {
            const glintAlpha = clamp(alpha * 0.34 * aBoost, 0, 1);
            ctx.strokeStyle = hsla(hue, 98, light + 6, glintAlpha);
            ctx.lineWidth = Math.max(0.3, rad * 0.24);
            ctx.lineCap = "butt";
            ctx.beginPath();
            ctx.moveTo(p.x - rad * (1.7 + shimmer * 0.4), p.y);
            ctx.lineTo(p.x + rad * (1.7 + shimmer * 0.4), p.y);
            ctx.moveTo(p.x, p.y - rad * (1.7 + shimmer * 0.4) * 0.7);
            ctx.lineTo(p.x, p.y + rad * (1.7 + shimmer * 0.4) * 0.7);
            ctx.stroke();
          }
        }
      });
    }

    function drawStarLinks(
      radius: number,
      hoverAmount: number,
      voice: number,
      speakPulse: number,
      energy: number,
      success: number,
      dt: number,
      isReduced: boolean,
    ) {
      if (!isReduced) {
        linkAccumulator += dt;
        nextLinkIn -= dt;
        if (nextLinkIn <= 0) {
          const maxLinks = (mobile ? 28 : 38) + (hoverAmount > 0.4 ? 3 : 0);
          const candidates = microStars
            .map((star, index) => ({ star, index }))
            .filter(({ star }) => star.link);
          for (let count = 0; count < 3 && starLinks.length < maxLinks && candidates.length > 1; count += 1) {
            const source = candidates[Math.floor(Math.random() * candidates.length)];
            const nearest = candidates
              .filter((candidate) => candidate.index !== source.index)
              .map((candidate) => {
                const a = microPositions[source.index];
                const b = microPositions[candidate.index];
                return { candidate, distance: Math.hypot(a.x - b.x, a.y - b.y) };
              })
              .filter(({ distance }) => distance > radius * 0.06 && distance < radius * 0.72)
              .sort((a, b) => a.distance - b.distance)
              .slice(0, 4);
            if (nearest.length === 0) continue;
            const target = nearest[Math.floor(Math.random() * nearest.length)].candidate;
            if (starLinks.some((link) => (link.a === source.index && link.b === target.index) || (link.a === target.index && link.b === source.index))) continue;
            starLinks.push({
              a: source.index,
              b: target.index,
              age: 0,
              dur: rand(1.8, 4.2),
              bow: Math.random() < 0.4 ? rand(-0.02, 0.02) : rand(-0.2, 0.2),
              hue: Math.random() < 0.52 ? 192 : Math.random() < 0.875 ? 208 : 246,
            });
          }
          nextLinkIn = rand(0.08, 0.2);
          linkAccumulator = 0;
        }
      }
      const maxLinks = (isReduced ? 5 : mobile ? 28 : 38) + (hoverAmount > 0.4 ? 3 : 0);
      starLinks = starLinks.filter((link) => {
        link.age += dt;
        return link.age < link.dur && link.a < microPositions.length && link.b < microPositions.length;
      }).slice(-maxLinks);
      starLinks.forEach((link) => {
        const a = microPositions[link.a];
        const b = microPositions[link.b];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > radius * 0.8) return;
        const life = link.age / link.dur;
        const envelope = Math.min(1, Math.min(life, 1 - life) * 5);
        const near = 1 - distance / (radius * 0.8);
        const alpha = Math.min(
          0.62,
          envelope * (0.26 + near * 0.2) * (mobile ? 1.5 : 1) *
            (1 + hoverAmount * 0.3 + voice * 0.65 + speakPulse * 0.3 + energy * 0.12 + success * 0.4),
        );
        const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        gradient.addColorStop(0, hsla(link.hue, 96, lightFor(56, dark, mobile), 0));
        gradient.addColorStop(0.34, hsla(link.hue, 96, lightFor(56, dark, mobile), alpha));
        gradient.addColorStop(0.66, hsla(link.hue, 96, lightFor(56, dark, mobile), alpha));
        gradient.addColorStop(1, hsla(link.hue, 96, lightFor(56, dark, mobile), 0));
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 0.7;
        ctx.lineCap = "round";
        const mx = (a.x + b.x) / 2 - (b.y - a.y) * link.bow;
        const my = (a.y + b.y) / 2 + (b.x - a.x) * link.bow;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
        ctx.stroke();
      });
    }

    function drawNodes(
      radius: number,
      spread: number,
      now: number,
      voice: number,
      hoverAmount: number,
      speakPulse: number,
      energy: number,
      success: number,
      speedMul: number,
      dt: number,
    ) {
      const positions = nodes.map((node) => {
        node.a += node.s * speedMul * 0.6 * dt;
        const rBase = node.r * (1 + Math.sin(now * 0.0002 + node.a) * 0.025);
        const rr = rBase * radius * spread;
        const x = width * 0.5 + radius * 0.04 + Math.cos(node.a) * rr;
        const z = Math.sin(node.a);
        const y = height * 0.5 - radius * 0.03 + z * rr * node.tilt + node.yOff * radius;
        return { x, y, z, rBase };
      });
      nodeLinks.forEach((link) => {
        link.ph += link.sp * speedMul * dt * (1 + voice * 0.35);
        const fade = Math.min(1, Math.pow(Math.max(0, Math.sin(link.ph)), 1.4) * 1.35);
        if (fade < 0.03) return;
        const a = positions[link.a];
        const b = positions[link.b];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > radius * 0.8) return;
        const near = 1 - distance / (radius * 0.8);
        const alpha = Math.min(
          0.3,
          fade * (0.12 + near * 0.09) * (1 + hoverAmount * 0.35 + voice * 0.6 + speakPulse * 0.25 + energy * 0.15 + success * 0.4),
        );
        const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        gradient.addColorStop(0, hsla(204, 94, lightFor(50, dark, mobile), 0));
        gradient.addColorStop(0.4, hsla(204, 94, lightFor(50, dark, mobile), alpha));
        gradient.addColorStop(0.6, hsla(204, 94, lightFor(50, dark, mobile), alpha));
        gradient.addColorStop(1, hsla(204, 94, lightFor(50, dark, mobile), 0));
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 0.65;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(
          (a.x + b.x) / 2 - (b.y - a.y) * link.bow,
          (a.y + b.y) / 2 + (b.x - a.x) * link.bow,
          b.x,
          b.y,
        );
        ctx.stroke();
      });
      positions.forEach((node, i) => {
        const a = Math.min(
          0.7,
          (0.3 + hoverAmount * 0.12 + voice * 0.2 + energy * 0.06) * (0.6 + (node.z + 1) * 0.22),
        );
        const rad = node.size * 0.44 * (0.9 + (node.z + 1) * 0.1);
        drawGradientDot(node.x, node.y, rad * 1.6, hsla(node.hue, 98, lightFor(50, dark, mobile), a * 0.2), a);
        ctx.fillStyle = hsla(node.hue, 98, lightFor(50 + voice * 6, dark, mobile), Math.min(1, a * 1.2));
        ctx.beginPath();
        ctx.arc(node.x, node.y, rad, 0, TAU);
        ctx.fill();
        void i;
      });
    }

    function drawKernel(
      radius: number,
      now: number,
      voice: number,
      speakPulse: number,
      hoverAmount: number,
      energy: number,
      listening: boolean,
      success: number,
    ) {
      const kx = width * 0.5 + radius * 0.04;
      const ky = height * 0.5 - radius * 0.03;
      const kr = radius * 0.082 * (1 + voice * 0.07 + speakPulse * 0.02 + hoverAmount * 0.022);
      const green = success;
      const mixHue = (hue: number) => hue + (150 - hue) * green;
      const mixSat = (saturation: number) => saturation - (saturation - 78) * green;
      ctx.save();
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";

      ctx.translate(kx, ky);
      ctx.rotate(-0.5 + Math.sin(now * 0.00013) * 0.12);
      ctx.scale(1.5, 0.92);
      const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, kr * 2.1);
      const hazeAlpha = 0.1 + hoverAmount * 0.035 + voice * 0.08 + energy * 0.03;
      haze.addColorStop(0, hsla(191, 100, 62, hazeAlpha));
      haze.addColorStop(0.55, hsla(206, 98, 54, hazeAlpha * 0.35));
      haze.addColorStop(1, hsla(230, 92, 56, 0));
      ctx.fillStyle = haze;
      ctx.beginPath();
      ctx.arc(0, 0, kr * 2.1, 0, TAU);
      ctx.fill();
      ctx.restore();

      FILAMENTS.forEach((filament, i) => {
        const w1 = Math.sin(now * 0.001 * filament.sp + filament.ph);
        const w2 = Math.sin(now * 0.001 * filament.sp * 1.7 + filament.ph * 1.3);
        const beat = 0.5 + 0.5 * Math.sin(now * 0.001 * (2.2 + i * 0.9) + filament.ph);
        const lift = voice * (0.35 + beat * 0.85) + speakPulse * 0.12;
        const pull = listening ? 0.86 : 1;
        const angle = filament.a + w1 * 0.16;
        const distance = kr * filament.off * (1 + w2 * 0.22) * pull;
        const alpha = Math.min(1, (filament.al * (0.62 + beat * 0.2) + lift * 0.3) * (listening ? 0.82 : 1));
        ctx.save();
        ctx.translate(kx + Math.cos(angle) * distance, ky + Math.sin(angle) * distance);
        ctx.rotate(angle + 0.35 + w2 * 0.2);
        ctx.scale(filament.len * (1 + w1 * 0.14 + lift * 0.1) * pull, filament.wid * (1 + w2 * 0.18));
        const filamentGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, kr);
        filamentGradient.addColorStop(0, hsla(mixHue(0), mixSat(0), 100, alpha));
        filamentGradient.addColorStop(0.28, hsla(mixHue(filament.hue), 100, Math.min(96, filament.lig + lift * 8), alpha * 0.92));
        filamentGradient.addColorStop(0.68, hsla(mixHue(filament.hue + 12), 98, filament.lig - 18, alpha * 0.42));
        filamentGradient.addColorStop(1, hsla(mixHue(filament.hue + 26), 94, 50, 0));
        ctx.fillStyle = filamentGradient;
        ctx.beginPath();
        ctx.ellipse(0, 0, kr, kr * 0.32, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      });

      [-0.35, 1.25].forEach((baseAngle, i) => {
        const angle = baseAngle + Math.sin(now * (0.0004 + i * 0.0003)) * 0.14;
        const scale = 1 + Math.sin(now * (0.0011 + i * 0.0007)) * 0.12 + voice * 0.08;
        const length = (i ? 0.62 : 0.95) * scale * kr * 2.1;
        const widthValue = (i ? 0.16 : 0.22) * scale * kr;
        const ox = i ? kr * 0.06 : -kr * 0.06;
        const oy = i ? -kr * 0.05 : kr * 0.05;
        ctx.save();
        ctx.translate(kx + ox, ky + oy);
        ctx.rotate(angle);
        const sliver = ctx.createLinearGradient(-length, 0, length, 0);
        sliver.addColorStop(0, hsla(0, 0, 100, Math.min(1, (i ? 0.8 : 1) * (0.9 + voice * 0.1) + hoverAmount * 0.06)));
        sliver.addColorStop(0.5, hsla(188, 100, dark ? 94 : 54, 0.7));
        sliver.addColorStop(1, hsla(196, 100, 70, 0));
        ctx.fillStyle = sliver;
        ctx.fillRect(-length, -widthValue * 0.5, length * 2, widthValue);
        ctx.restore();
      });

      for (let i = 0; i < 4; i += 1) {
        const cycle = (now * 0.0005 * (0.5 + i * 0.23) + i * 0.41) % 1;
        const angle = i * 1.9 + Math.sin(now * 0.00021 + i) * 0.9;
        const distance = kr * (0.9 + cycle * 1.5);
        const sparkRadius = Math.max(0.35, kr * 0.1 * (1 - cycle * 0.4));
        const alpha = Math.sin(cycle * Math.PI) * (0.35 + voice * 0.45 + hoverAmount * 0.15);
        drawGradientDot(
          kx + Math.cos(angle) * distance,
          ky + Math.sin(angle) * distance,
          sparkRadius * 2.4,
          hsla(194, 98, 78, alpha),
          alpha,
        );
      }
      ctx.globalCompositeOperation = "source-over";
    }

    function drawFrame(now: number) {
      if (!running) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      t += dt;
      const current = propsRef.current;
      const phase = phaseFor(current.step, current.agentSpeaking);
      const isReduced = reducedRef.current;
      const levels = getAvaLevels();
      const voice = phase === "speaking" ? clamp(levels.agent, 0, 1) : 0;
      const mid = phase === "speaking" ? clamp(levels.mid, 0, 1) : 0;
      if (current.bookingState === "confirmed" && previousBooking !== "confirmed") successAge = 0;
      previousBooking = current.bookingState;
      if (Number.isFinite(successAge)) successAge += dt;
      const success = Number.isFinite(successAge)
        ? successAge < 2.2 ? 1 : successAge < 5.2 ? 1 - (successAge - 2.2) / 3 : 0
        : 0;
      const hoverTarget = current.hovered && phase === "idle" ? 1 : 0;
      const energyTarget = phase === "connecting" ? 0.45 : phase === "listening" ? 0.18 : phase === "speaking" ? 0.55 : 0;
      hoverValue = ease(hoverValue, hoverTarget, hoverTarget > hoverValue ? 0.14 : 0.22, dt);
      energyValue = ease(energyValue, energyTarget, 0.35, dt);
      greenValue = ease(greenValue, success, success > greenValue ? 0.16 : 0.5, dt);
      if (voice - previousVoice > 0.18 && !isReduced) voiceRipple = 0;
      if (current.hovered && !hoverWasActive && !isReduced) hoverRipple = 0;
      voiceRipple = Math.min(2, voiceRipple + dt * 0.9);
      hoverRipple = Math.min(2, hoverRipple + dt * 1.1);
      hoverWasActive = current.hovered;
      previousVoice = voice;

      const breath = isReduced
        ? 1
        : 1 + (Math.sin(t * 0.33) * 0.55 + Math.sin(t * 0.19 + 1.7) * 0.3 + Math.sin(t * 0.51 + 0.4) * 0.15) * 0.03;
      const speakPulse = phase === "speaking" ? (Math.sin(t * 4.6) * 0.5 + 0.5) * (0.35 + voice * 0.65) : 0;
      const spread =
        breath *
        (1 + voice * 0.1 + energyValue * 0.02 + hoverValue * 0.075 - (phase === "listening" ? 0.03 : 0) + greenValue * 0.04);
      const speedMul = (isReduced ? 0.16 : 1) * (1 + hoverValue * 0.12 + voice * 0.18 + energyValue * 0.12);
      const radius = Math.min(width, height) * 0.3;
      const hazeRadius = radius * (1.35 + voice * 0.04);
      const hazeAlpha = (dark ? (mobile ? 0.11 : 0.028) : 0.018) + voice * 0.01 + energyValue * 0.005 + greenValue * 0.012;
      const centerX = width * 0.5 + radius * 0.04;
      const centerY = height * 0.5 - radius * 0.03;

      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      const atmosphere = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, hazeRadius);
      atmosphere.addColorStop(0, hsla(dark ? 198 : 220, dark ? 90 : 12, dark ? 62 : 26, hazeAlpha));
      atmosphere.addColorStop(0.5, hsla(dark ? 210 : 220, dark ? 85 : 10, dark ? 58 : 28, hazeAlpha * 0.4));
      atmosphere.addColorStop(1, hsla(dark ? 216 : 220, dark ? 80 : 10, dark ? 56 : 30, 0));
      ctx.fillStyle = atmosphere;
      ctx.beginPath();
      ctx.arc(centerX, centerY, hazeRadius, 0, TAU);
      ctx.fill();

      parts.forEach((particle) => {
        particle.drift += particle.driftS * speedMul * dt * LAYER_SPEED[layerFor(particle.r, false)];
      });
      microStars.forEach((particle) => {
        particle.drift += particle.driftS * speedMul * dt * LAYER_SPEED[layerFor(particle.r, true)];
      });
      microPositions = new Array(microStars.length);
      const aBoost = dark ? (mobile ? 2.15 : 1.3) : 1;
      drawParticles(parts, radius, spread, t, voice, mid, hoverValue, energyValue, greenValue, false, aBoost);
      drawParticles(microStars, radius, spread, t, voice, mid, hoverValue, energyValue, greenValue, true, aBoost, microPositions);
      drawStarLinks(radius, hoverValue, voice, speakPulse, energyValue, greenValue, dt, isReduced);
      drawNodes(radius, spread, t, voice, hoverValue, speakPulse, energyValue, greenValue, speedMul, dt);
      if (hoverValue > 0.01) {
        for (let i = 0; i < 9; i += 1) {
          const angle = i * 0.71 + t * 0.04;
          const distance = radius * (0.86 + (i % 3) * 0.13);
          const x = centerX + Math.cos(angle) * distance;
          const y = centerY + Math.sin(angle) * distance * 0.62;
          const alpha = clamp(hoverValue * 0.72 * (0.55 + 0.45 * Math.sin(i + t * 1.7)) * aBoost, 0, 1);
          ctx.fillStyle = hsla(i % 3 === 0 ? 192 : i % 3 === 1 ? 208 : 246, 98, lightFor(62, dark, mobile), alpha);
          ctx.beginPath();
          ctx.arc(x, y, rand(0.4, 0.85), 0, TAU);
          ctx.fill();
        }
      }
      drawKernel(radius, t, voice, speakPulse, hoverValue, energyValue, phase === "listening", greenValue);
      animationFrame = window.requestAnimationFrame(drawFrame);
    }

    function start() {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      running = true;
      last = performance.now();
      animationFrame = window.requestAnimationFrame(drawFrame);
    }

    function onVisibilityChange() {
      if (document.hidden) {
        running = false;
        window.cancelAnimationFrame(animationFrame);
        return;
      }
      start();
    }

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    setReduced(motionQuery.matches);
    motionQuery.addEventListener?.("change", onMotionChange);
    resize();
    seed();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrap);
    document.addEventListener("visibilitychange", onVisibilityChange);
    start();

    return () => {
      running = false;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      motionQuery.removeEventListener?.("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [dark, reduced]);

  return (
    <div ref={wrapRef} className={`relative ${className}`} aria-hidden="true">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}