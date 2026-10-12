/**
 * The hive field — the page's persistent 3D object.
 *
 * LOADING CONTRACT: this module is the ONLY one that imports three or
 * @react-three/fiber, and it is reached exclusively through React.lazy from
 * HiveHero.tsx. That keeps three out of the /v2 route chunk entirely, so it
 * never blocks first paint and never downloads on mobile or for
 * reduced-motion visitors.
 *
 * SSR: <Canvas> touches document, so this must never render on the server.
 * HiveHero guarantees that by mounting it only inside an effect.
 *
 * DETERMINISM: no Math.random anywhere. Cell positions come from a seeded
 * PRNG so the scene is identical on every load and every machine — the same
 * rule AvaOrb.tsx documents for SSR-hydration safety.
 */

import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const COOL = "#5b7a9e";
const GOLD = "#ffc940";

/** Mulberry32 — small, fast, deterministic. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Cell {
  /** home position — cells orbit this, they never drift away from it */
  home: THREE.Vector3;
  radius: number;
  /** phase offsets so nothing moves in lockstep */
  phase: number;
  speed: number;
  spin: THREE.Vector3;
  gold: boolean;
}

function buildCells(count: number): Cell[] {
  const rand = prng(0x5eed);
  const cells: Cell[] = [];
  for (let i = 0; i < count; i++) {
    // Golden-angle spiral gives an even, organic scatter with no clumping and
    // no visible grid — the brief's "irregular arrangement, not a honeycomb".
    const t = i / count;
    const angle = i * 2.399963229728653;
    const dist = 1.1 + Math.sqrt(t) * 4.3;
    const jitter = (rand() - 0.5) * 0.85;

    cells.push({
      home: new THREE.Vector3(
        Math.cos(angle) * dist + jitter,
        Math.sin(angle) * dist * 0.62 + (rand() - 0.5) * 0.7,
        -3.2 + rand() * 4.2,
      ),
      radius: 0.17 + rand() * 0.2,
      phase: rand() * Math.PI * 2,
      speed: 0.17 + rand() * 0.22,
      spin: new THREE.Vector3(rand() * 0.14, rand() * 0.2, rand() * 0.1),
      // A handful of gold cells carry the hierarchy. Too many and the page
      // reads as "everything is yellow", which is the thing to avoid.
      gold: i % 7 === 3,
    });
  }
  return cells;
}

function Scene({ count }: { count: number }) {
  const cells = useMemo(() => buildCells(count), [count]);
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<THREE.Mesh[]>([]);
  const lines = useRef<THREE.LineSegments>(null);
  const pointer = useRef(new THREE.Vector2(0, 0));
  const { viewport } = useThree();

  // Shared geometry/materials — 2 materials, so 2 state switches for the
  // whole field regardless of cell count.
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const matCool = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: COOL,
        flatShading: true,
        roughness: 0.45,
        metalness: 0.65,
        transparent: true,
        opacity: 0.92,
      }),
    [],
  );
  const matGold = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: GOLD,
        flatShading: true,
        roughness: 0.3,
        metalness: 0.5,
        emissive: new THREE.Color(GOLD),
        emissiveIntensity: 0.4,
      }),
    [],
  );

  /** Static topology: which cells are linked. Computed once from home
   *  positions, so the lattice never flickers as cells drift. */
  const pairs = useMemo(() => {
    const out: [number, number][] = [];
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        if (cells[i].home.distanceTo(cells[j].home) < 1.95) out.push([i, j]);
      }
    }
    return out;
  }, [cells]);

  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pairs.length * 6), 3));
    return g;
  }, [pairs.length]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Pointer is already normalised to -1..1 by R3F. Ease toward it so the
    // field feels weighted rather than twitchy.
    pointer.current.lerp(state.pointer, 0.055);
    const px = pointer.current.x * (viewport.width / 2);
    const py = pointer.current.y * (viewport.height / 2);

    for (let i = 0; i < cells.length; i++) {
      const m = meshes.current[i];
      if (!m) continue;
      const c = cells[i];

      // Idle drift — a slow figure-eight, never a loop that reads as a loop.
      const bx = Math.sin(t * c.speed + c.phase) * 0.22;
      const by = Math.cos(t * c.speed * 0.78 + c.phase) * 0.17;

      // Cursor influence: cells lean AWAY from the pointer, nearer cells more.
      // This conveys nothing — it is decoration, so no information is lost to
      // a visitor who never moves a mouse.
      const dx = c.home.x + bx - px;
      const dy = c.home.y + by - py;
      const d2 = dx * dx + dy * dy;
      const push = Math.min(1.5 / (d2 + 0.8), 0.85);

      m.position.set(
        c.home.x + bx + dx * push * 0.3,
        c.home.y + by + dy * push * 0.3,
        c.home.z + Math.sin(t * 0.3 + c.phase) * 0.12,
      );
      m.rotation.x += c.spin.x * 0.01;
      m.rotation.y += c.spin.y * 0.01;
      m.rotation.z += c.spin.z * 0.01;

      const s = c.radius * (1 + push * 0.22);
      m.scale.setScalar(s);
    }

    // Rebuild the lattice from the cells' live positions.
    if (lines.current) {
      const pos = lineGeo.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let k = 0; k < pairs.length; k++) {
        const a = meshes.current[pairs[k][0]];
        const b = meshes.current[pairs[k][1]];
        if (!a || !b) continue;
        arr[k * 6 + 0] = a.position.x;
        arr[k * 6 + 1] = a.position.y;
        arr[k * 6 + 2] = a.position.z;
        arr[k * 6 + 3] = b.position.x;
        arr[k * 6 + 4] = b.position.y;
        arr[k * 6 + 5] = b.position.z;
      }
      pos.needsUpdate = true;
    }

    // Whole-field parallax, very slight.
    if (group.current) {
      group.current.rotation.y = pointer.current.x * 0.085;
      group.current.rotation.x = -pointer.current.y * 0.055;
    }
  });

  return (
    <group ref={group}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 6, 8]} intensity={1.5} color="#cfe4ff" />
      <pointLight position={[-5, -2, 3]} intensity={38} distance={16} color={GOLD} />
      <pointLight position={[3, 3, -4]} intensity={22} distance={18} color="#38bdf8" />

      {cells.map((c, i) => (
        <mesh
          key={i}
          ref={(el) => {
            if (el) meshes.current[i] = el;
          }}
          geometry={geo}
          material={c.gold ? matGold : matCool}
          position={c.home}
        />
      ))}

      <lineSegments ref={lines} geometry={lineGeo}>
        <lineBasicMaterial color="#38bdf8" transparent opacity={0.17} />
      </lineSegments>
    </group>
  );
}

export default function HiveField({ count = 26 }: { count?: number }) {
  return (
    <Canvas
      // The canvas is decoration sitting behind the headline. The LCP element
      // is the <h1> text in front of it, which is both faster and more
      // reliable than making an image or canvas the LCP.
      aria-hidden="true"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 0, 8.5], fov: 46 }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      onCreated={({ gl }) => gl.setClearAlpha(0)}
    >
      <fog attach="fog" args={["#050e1e", 7, 16]} />
      <Scene count={count} />
    </Canvas>
  );
}
