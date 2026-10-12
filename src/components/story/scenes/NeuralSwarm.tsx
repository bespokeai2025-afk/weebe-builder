/**
 * Aura "Neural Swarm" adapted for WEBEE — hive / collective voice intelligence.
 *
 * ~9k additive points with curl-style flow + cursor lure + GSAP implode entry.
 * Bloom is faked with additive blending (no postprocessing dependency).
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { gsap } from "gsap";
import { SceneCanvas, prng, GOLD, COOL } from "./shared";
import { curlFlow } from "./curlFlow";

const COUNT = 9000;
const velScratch = new THREE.Vector3();
const gold = new THREE.Color(GOLD);
const cool = new THREE.Color(COOL);
const indigo = new THREE.Color("#6366f1");

function Swarm({ entryRef }: { entryRef: React.RefObject<{ t: number }> }) {
  const points = useRef<THREE.Points>(null);
  const sim = useRef(new Float32Array(COUNT * 3));
  const spawn = useRef(new Float32Array(COUNT * 3));
  const vel = useRef(new Float32Array(COUNT * 3));

  const { positions, colors } = useMemo(() => {
    const rand = prng(0x5a7a2e);
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    const sp = spawn.current;
    const sm = sim.current;

    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;
      const u = rand();
      const v = rand();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const r = 9 + rand() * 6;
      sp[i3] = Math.sin(phi) * Math.cos(theta) * r;
      sp[i3 + 1] = Math.sin(phi) * Math.sin(theta) * r * 0.65;
      sp[i3 + 2] = Math.cos(phi) * r * 0.5;

      sm[i3] = (rand() - 0.5) * 5;
      sm[i3 + 1] = (rand() - 0.5) * 3.2;
      sm[i3 + 2] = (rand() - 0.5) * 2.8;

      pos[i3] = sp[i3];
      pos[i3 + 1] = sp[i3 + 1];
      pos[i3 + 2] = sp[i3 + 2];

      const mix = rand();
      const c = gold.clone().lerp(mix < 0.55 ? cool : indigo, mix);
      col[i3] = c.r;
      col[i3 + 1] = c.g;
      col[i3 + 2] = c.b;
    }
    return { positions: pos, colors: col };
  }, []);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [positions, colors]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const entry = entryRef.current?.t ?? 1;
    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const sm = sim.current;
    const vels = vel.current;
    const sp = spawn.current;

    const mx = state.pointer.x * 4.2;
    const my = state.pointer.y * 2.4 + 0.2;
    const dt = Math.min(delta, 0.033);
    const e = THREE.MathUtils.smoothstep(entry, 0, 1);

    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;
      let x = sm[i3];
      let y = sm[i3 + 1];
      let z = sm[i3 + 2];

      curlFlow(x, y, z, t, velScratch);
      vels[i3] += velScratch.x * dt;
      vels[i3 + 1] += velScratch.y * dt;
      vels[i3 + 2] += velScratch.z * dt;

      const lx = mx - x;
      const ly = my - y;
      const lz = -z * 0.35;
      const dist = Math.sqrt(lx * lx + ly * ly + lz * lz) + 0.001;
      const pull = Math.exp(-dist * 0.55) * 0.12;
      vels[i3] += (lx / dist) * pull;
      vels[i3 + 1] += (ly / dist) * pull;
      vels[i3 + 2] += (lz / dist) * pull * 0.4;

      vels[i3] *= 0.94;
      vels[i3 + 1] *= 0.94;
      vels[i3 + 2] *= 0.94;

      x += vels[i3] * dt * 18;
      y += vels[i3 + 1] * dt * 18;
      z += vels[i3 + 2] * dt * 18;

      sm[i3] = x;
      sm[i3 + 1] = y;
      sm[i3 + 2] = z;

      arr[i3] = THREE.MathUtils.lerp(sp[i3], x, e);
      arr[i3 + 1] = THREE.MathUtils.lerp(sp[i3 + 1], y, e);
      arr[i3 + 2] = THREE.MathUtils.lerp(sp[i3 + 2], z, e);
    }

    posAttr.needsUpdate = true;
    if (points.current) {
      points.current.rotation.y = t * 0.04;
      points.current.rotation.z = Math.sin(t * 0.08) * 0.03;
    }
  });

  return (
    <points ref={points} geometry={geometry}>
      <pointsMaterial
        size={0.045}
        vertexColors
        transparent
        opacity={0.88}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}

function SwarmScene() {
  const entryRef = useRef({ t: 0 });

  useEffect(() => {
    gsap.to(entryRef.current, {
      t: 1,
      duration: 2.35,
      ease: "power3.out",
      delay: 0.15,
    });
  }, []);

  return <Swarm entryRef={entryRef} />;
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

export default function NeuralSwarm({ offset = 2.1 }: { offset?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const visible = useWrapVisible(wrapRef);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      <SceneCanvas offset={offset} frameloop={visible ? "always" : "never"}>
        <SwarmScene />
      </SceneCanvas>
    </div>
  );
}
