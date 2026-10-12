/**
 * Aura "Bio-Loom" adapted for WEBEE — living voice threads / workflow weave.
 *
 * Growing lines with drawRange pulse, cursor repel, GSAP unfurl.
 * Colours: story gold + mint/emerald (organic future, WEBEE palette).
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { gsap } from "gsap";
import { SceneCanvas, prng, GOLD } from "./shared";

const VINES = 44;
const SEGMENTS = 28;
const mint = new THREE.Color("#6ee7b7");
const emerald = new THREE.Color("#34d399");
const gold = new THREE.Color(GOLD);

type Vine = {
  curve: THREE.CatmullRomCurve3;
  line: THREE.Line;
  phase: number;
  points: THREE.Vector3[];
};

function buildVines(): Vine[] {
  const rand = prng(0x1000);
  const out: Vine[] = [];

  for (let v = 0; v < VINES; v++) {
    const pts: THREE.Vector3[] = [];
    const angle = (v / VINES) * Math.PI * 2 + rand() * 0.4;
    const len = 2.2 + rand() * 2.8;
    for (let i = 0; i <= SEGMENTS; i++) {
      const u = i / SEGMENTS;
      const sway = Math.sin(u * 4.2 + v * 0.3) * 0.35 + Math.sin(u * 9.1 - v) * 0.12;
      pts.push(
        new THREE.Vector3(
          Math.cos(angle + sway * 0.25) * len * u,
          (u - 0.5) * 2.4 + sway,
          Math.sin(angle + sway * 0.25) * len * u * 0.55 + (rand() - 0.5) * 0.2,
        ),
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const samples = curve.getPoints(SEGMENTS * 2);
    const geo = new THREE.BufferGeometry().setFromPoints(samples);
    const col = gold.clone().lerp(v % 3 === 0 ? mint : emerald, 0.35 + rand() * 0.45);
    const mat = new THREE.LineBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.geometry.setDrawRange(0, 0);
    out.push({ curve, line, phase: rand() * 10, points: pts });
  }
  return out;
}

function Loom({ growRef }: { growRef: React.RefObject<{ t: number }> }) {
  const group = useRef<THREE.Group>(null);
  const vines = useMemo(() => buildVines(), []);

  useEffect(() => {
    return () => {
      for (const vine of vines) {
        vine.line.geometry.dispose();
        (vine.line.material as THREE.Material).dispose();
      }
    };
  }, [vines]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const master = growRef.current?.t ?? 1;
    const mx = state.pointer.x * 3.6;
    const my = state.pointer.y * 2.2;
    const repelR = 1.35;

    for (const vine of vines) {
      const pts = vine.points;
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i];
        const dx = p.x - mx;
        const dy = p.y - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < repelR * repelR) {
          const d = Math.sqrt(d2) + 0.001;
          const f = (1 - d / repelR) * 0.04;
          p.x += (dx / d) * f;
          p.y += (dy / d) * f;
        }
        p.y += Math.sin(t * 1.1 + vine.phase + i * 0.22) * 0.0009;
      }

      vine.curve.points = pts;
      const sampled = vine.curve.getPoints(SEGMENTS * 2);
      const pos = vine.line.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < sampled.length; i++) {
        arr[i * 3] = sampled[i].x;
        arr[i * 3 + 1] = sampled[i].y;
        arr[i * 3 + 2] = sampled[i].z;
      }
      pos.needsUpdate = true;

      const pulse = 0.55 + 0.45 * Math.sin(t * 1.35 + vine.phase);
      const grow = THREE.MathUtils.clamp(master * pulse, 0, 1);
      const count = Math.floor((arr.length / 3) * grow);
      vine.line.geometry.setDrawRange(0, count);

      const mat = vine.line.material as THREE.LineBasicMaterial;
      mat.opacity = 0.35 + grow * 0.55;
    }

    if (group.current) {
      group.current.rotation.y = t * 0.06;
      group.current.rotation.x = Math.sin(t * 0.11) * 0.04;
    }
  });

  return (
    <group ref={group}>
      {vines.map((v, i) => (
        <primitive key={i} object={v.line} />
      ))}
    </group>
  );
}

function LoomScene() {
  const growRef = useRef({ t: 0 });
  useEffect(() => {
    gsap.to(growRef.current, { t: 1, duration: 2.8, ease: "power2.out", delay: 0.1 });
  }, []);
  return <Loom growRef={growRef} />;
}

function useWrapVisible(ref: RefObject<HTMLDivElement | null>) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "80px", threshold: 0.02 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return visible;
}

export default function BioLoom({ offset = 2.0 }: { offset?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const visible = useWrapVisible(wrapRef);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      <SceneCanvas offset={offset} frameloop={visible ? "always" : "never"}>
        <LoomScene />
      </SceneCanvas>
    </div>
  );
}
