/**
 * Shared rig for the four hero-concept scenes.
 *
 * Every concept is framed identically — same camera, same lighting, same
 * offset-right composition — so when you compare them you are judging the
 * CONCEPT and not an accidental difference in staging.
 *
 * Lighting recipe (this is most of why an object on a dark page looks
 * expensive rather than flat):
 *   key   — hard, upper-left, cool white. Defines the form.
 *   rim   — gold, from behind-right. Separates the object from the background
 *           and is the single biggest contributor to a premium read.
 *   fill  — dim cyan, lower-left. Stops the shadow side going dead black.
 */

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

export const GOLD = "#ffc940";
export const COOL = "#38bdf8";
export const BG = "#050e1e";

/** Pointer eased in a ref — never state, so this never re-renders React. */
export function usePointer() {
  const p = useRef(new THREE.Vector2());
  const target = useRef(new THREE.Vector2());
  useFrame(({ pointer }) => {
    target.current.set(pointer.x, pointer.y);
    p.current.lerp(target.current, 0.05);
  });
  return p;
}

export function Rig({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ambientLight intensity={0.28} />
      {/* key */}
      <directionalLight position={[-6, 7, 6]} intensity={2.2} color="#dCEBFF" />
      {/* gold rim from behind-right */}
      <directionalLight position={[7, 2, -6]} intensity={3.1} color={GOLD} />
      {/* cool fill */}
      <pointLight position={[-5, -4, 4]} intensity={26} distance={22} color={COOL} />
      {children}
    </>
  );
}

/**
 * All four scenes mount through this so the frame, DPR policy, clear alpha and
 * fog are identical. `offset` pushes the subject right of centre, leaving the
 * left half as clear space for the headline.
 */
export function SceneCanvas({
  children,
  offset = 1.9,
  frameloop = "always",
}: {
  children: React.ReactNode;
  offset?: number;
  /** "never" stops R3F's render loop entirely — pass this when a wrapper has
   *  determined (e.g. via IntersectionObserver) that the canvas is offscreen,
   *  so idle scenes cost nothing. Defaults to "always" to match every scene
   *  that doesn't opt in. */
  frameloop?: "always" | "demand" | "never";
}) {
  return (
    <Canvas
      aria-hidden="true"
      dpr={[1, 2]}
      frameloop={frameloop}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 0, 9], fov: 42 }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      onCreated={({ gl }) => gl.setClearAlpha(0)}
    >
      <fog attach="fog" args={[BG, 9, 22]} />
      <group position={[offset, 0, 0]}>
        <Rig>{children}</Rig>
      </group>
    </Canvas>
  );
}

/** Deterministic PRNG — no Math.random, so every load is identical. */
export function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap value noise — enough for organic displacement, no dependency. */
export function noise3(x: number, y: number, z: number) {
  return (
    Math.sin(x * 1.7 + y * 0.9) * 0.5 +
    Math.sin(y * 1.3 - z * 1.1) * 0.3 +
    Math.sin(z * 1.9 + x * 0.7) * 0.2
  );
}
