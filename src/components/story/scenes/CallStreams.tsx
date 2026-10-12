/**
 * CONCEPT 3 — CALL STREAMS
 *
 * Glowing nodes joined by curved paths, with gold pulses travelling along
 * them: calls routing through the system. Continuously in motion, so the page
 * feels alive rather than posed.
 *
 * Reads as: ROUTING / ALWAYS ON. The most literal of the four — a visitor can
 * guess what the product does from the picture alone.
 *
 * The paths are static TubeGeometry built once. Only the pulse meshes move,
 * sampled from the curve, so the per-frame cost is a handful of position
 * writes regardless of how complex the lattice looks.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SceneCanvas, usePointer, prng, GOLD, COOL } from "./shared";

const NODES = 13;
const PULSES_PER_PATH = 2;

function Network() {
  const group = useRef<THREE.Group>(null);
  const pointer = usePointer();

  const { nodes, curves } = useMemo(() => {
    const rand = prng(0xca11);
    const pts: THREE.Vector3[] = [];

    // Nodes on two loose rings at different depths — gives the lattice a
    // readable front/back without looking like a flat diagram.
    for (let i = 0; i < NODES; i++) {
      const ring = i % 2;
      const a = (i / NODES) * Math.PI * 2 + ring * 0.5;
      const r = ring ? 3.3 : 2.0;
      pts.push(
        new THREE.Vector3(
          Math.cos(a) * r + (rand() - 0.5) * 0.6,
          Math.sin(a) * r * 0.72 + (rand() - 0.5) * 0.6,
          (ring ? -1.5 : 0.9) + (rand() - 0.5) * 1.2,
        ),
      );
    }

    // Connect each node to its two nearest neighbours; bow each link outward
    // so paths arc rather than running straight.
    const cs: THREE.CatmullRomCurve3[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < pts.length; i++) {
      const order = pts
        .map((p, j) => ({ j, d: p.distanceTo(pts[i]) }))
        .filter((o) => o.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const o of order) {
        const key = i < o.j ? `${i}-${o.j}` : `${o.j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = pts[i];
        const b = pts[o.j];
        const mid = a.clone().add(b).multiplyScalar(0.5);
        mid.add(mid.clone().normalize().multiplyScalar(0.75));
        cs.push(new THREE.CatmullRomCurve3([a, mid, b]));
      }
    }
    return { nodes: pts, curves: cs };
  }, []);

  const tubes = useMemo(
    () => curves.map((c) => new THREE.TubeGeometry(c, 36, 0.012, 6, false)),
    [curves],
  );

  const pulses = useRef<THREE.Mesh[]>([]);
  const pulseSpec = useMemo(() => {
    const rand = prng(0x9d15e);
    const out: { curve: number; offset: number; speed: number }[] = [];
    curves.forEach((_, ci) => {
      for (let k = 0; k < PULSES_PER_PATH; k++) {
        out.push({ curve: ci, offset: rand(), speed: 0.1 + rand() * 0.16 });
      }
    });
    return out;
  }, [curves]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (group.current) {
      group.current.rotation.y = t * 0.055 + pointer.current.x * 0.2;
      group.current.rotation.x = pointer.current.y * 0.13;
    }
    pulseSpec.forEach((p, i) => {
      const m = pulses.current[i];
      if (!m) return;
      const u = (p.offset + t * p.speed) % 1;
      const pos = curves[p.curve].getPointAt(u);
      m.position.copy(pos);
      // fade in and out at the ends so pulses don't pop
      const fade = Math.sin(u * Math.PI);
      m.scale.setScalar(0.055 + fade * 0.075);
      (m.material as THREE.MeshBasicMaterial).opacity = fade;
    });
  });

  return (
    <group ref={group}>
      {tubes.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshBasicMaterial color={COOL} transparent opacity={0.3} />
        </mesh>
      ))}

      {nodes.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.085, 20, 20]} />
          <meshStandardMaterial
            color={COOL}
            emissive={COOL}
            emissiveIntensity={0.7}
            metalness={0.6}
            roughness={0.25}
          />
        </mesh>
      ))}

      {pulseSpec.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            if (el) pulses.current[i] = el;
          }}
        >
          <sphereGeometry args={[1, 12, 12]} />
          <meshBasicMaterial color={GOLD} transparent opacity={1} />
        </mesh>
      ))}
    </group>
  );
}

export default function CallStreams() {
  return (
    <SceneCanvas offset={1.8}>
      <Network />
    </SceneCanvas>
  );
}
