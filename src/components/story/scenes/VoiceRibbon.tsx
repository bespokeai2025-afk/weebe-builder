/**
 * CONCEPT 1 — VOICE RIBBON
 *
 * One continuous metallic ribbon undulating through the frame like a
 * visualised voice, gold at the near end bleeding to cool blue as it recedes.
 *
 * Reads as: VOICE. This is the most on-brand of the four for a voice-agent
 * product, and the least common treatment on the web.
 *
 * Built from a single BufferGeometry whose vertices are rewritten each frame —
 * no per-frame geometry allocation, no shader, no extra dependency.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SceneCanvas, usePointer, GOLD, COOL } from "./shared";

const SEGMENTS = 190; // along the ribbon
const RIBBON_W = 0.62;

function Ribbon() {
  const mesh = useRef<THREE.Mesh>(null);
  const pointer = usePointer();

  const { geometry, colors } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array(SEGMENTS * 2 * 3);
    const cols = new Float32Array(SEGMENTS * 2 * 3);
    const idx: number[] = [];

    for (let i = 0; i < SEGMENTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    g.setIndex(idx);

    // Colour ramp is static: gold at the head, cool at the tail.
    const gold = new THREE.Color(GOLD);
    const cool = new THREE.Color(COOL);
    for (let i = 0; i < SEGMENTS; i++) {
      const t = i / (SEGMENTS - 1);
      const c = gold.clone().lerp(cool, Math.pow(t, 0.75));
      for (const v of [0, 1]) {
        cols[(i * 2 + v) * 3 + 0] = c.r;
        cols[(i * 2 + v) * 3 + 1] = c.g;
        cols[(i * 2 + v) * 3 + 2] = c.b;
      }
    }
    return { geometry: g, colors: cols };
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;

    // Pointer gently changes the amplitude, so the ribbon "listens".
    const amp = 0.75 + pointer.current.y * 0.3;

    for (let i = 0; i < SEGMENTS; i++) {
      const u = i / (SEGMENTS - 1);
      const x = (u - 0.5) * 11;

      // Stacked sines of different frequency give a speech-like envelope
      // rather than a regular wave.
      const env = Math.sin(u * Math.PI) ** 0.7; // taper both ends
      const y =
        (Math.sin(x * 0.85 + t * 1.25) * 0.55 +
          Math.sin(x * 1.9 - t * 0.85) * 0.28 +
          Math.sin(x * 3.3 + t * 1.9) * 0.12) *
        amp *
        env;
      const z = Math.sin(x * 0.55 - t * 0.7) * 0.85 * env;

      // Twist the ribbon about its own axis so it catches light along its run.
      const twist = Math.sin(x * 0.6 + t * 0.9) * 0.9;
      const hw = RIBBON_W * env;
      const dy = Math.cos(twist) * hw;
      const dz = Math.sin(twist) * hw;

      arr[(i * 2 + 0) * 3 + 0] = x;
      arr[(i * 2 + 0) * 3 + 1] = y + dy;
      arr[(i * 2 + 0) * 3 + 2] = z + dz;

      arr[(i * 2 + 1) * 3 + 0] = x;
      arr[(i * 2 + 1) * 3 + 1] = y - dy;
      arr[(i * 2 + 1) * 3 + 2] = z - dz;
    }

    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    if (mesh.current) {
      mesh.current.rotation.y = -0.38 + pointer.current.x * 0.13;
      mesh.current.rotation.z = 0.1;
    }
  });

  return (
    <mesh ref={mesh} geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        side={THREE.DoubleSide}
        metalness={0.92}
        roughness={0.19}
        envMapIntensity={1}
      />
    </mesh>
  );
}

/** A second, thinner ribbon trailing behind gives depth without clutter. */
function EchoRibbon() {
  const mesh = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SEGMENTS * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < SEGMENTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    return g;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime - 0.55; // trails the main ribbon
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < SEGMENTS; i++) {
      const u = i / (SEGMENTS - 1);
      const x = (u - 0.5) * 11;
      const env = Math.sin(u * Math.PI) ** 0.7;
      const y =
        (Math.sin(x * 0.85 + t * 1.25) * 0.55 + Math.sin(x * 1.9 - t * 0.85) * 0.28) * env * 0.8;
      const z = Math.sin(x * 0.55 - t * 0.7) * 0.85 * env - 1.1;
      const hw = 0.16 * env;
      arr[(i * 2 + 0) * 3 + 0] = x;
      arr[(i * 2 + 0) * 3 + 1] = y + hw;
      arr[(i * 2 + 0) * 3 + 2] = z;
      arr[(i * 2 + 1) * 3 + 0] = x;
      arr[(i * 2 + 1) * 3 + 1] = y - hw;
      arr[(i * 2 + 1) * 3 + 2] = z;
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    if (mesh.current) mesh.current.rotation.y = -0.38;
  });

  return (
    <mesh ref={mesh} geometry={geometry}>
      <meshBasicMaterial color={COOL} transparent opacity={0.22} side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * `background` mode tunes the ribbon for use behind a headline rather than as
 * the subject: centred, dropped below the type, and pushed back in z so it
 * reads as atmosphere. The hero's own CSS mask fades its lower edge.
 */
export default function VoiceRibbon({
  background = false,
}: {
  background?: boolean;
}) {
  return (
    <SceneCanvas offset={background ? 0 : 1.6}>
      <group
        position={background ? [0, -1.45, -1.2] : [0, 0, 0]}
        rotation={background ? [0.12, 0, -0.045] : [0, 0, 0]}
      >
        <Ribbon />
        <EchoRibbon />
      </group>
    </SceneCanvas>
  );
}
