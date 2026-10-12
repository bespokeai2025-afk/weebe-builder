/**
 * Backlit hex wall — the hero scene for /hive-glow.
 *
 * Reference: dark, solid hexagonal blocks with warm light leaking through the
 * gaps from BEHIND them. The premium read comes from material and light, not
 * from the hexagon shape — flat coloured hex tiles read as childish (tried and
 * rejected); dark extruded blocks with a bevel catching a backlight read as a
 * lit object.
 *
 * Structure (all inside one tilted group):
 *   backplane  — a shader plane behind the wall, glowing amber around the
 *                light position. This is what you see through the gaps.
 *   pointLight — sits between the plane and the blocks at the same position,
 *                so the block bevels catch a warm rim exactly where the glow is.
 *   blocks     — one instancedMesh of bevelled hex prisms. Blocks near the
 *                light ease forward slightly, so the wall reacts physically.
 *
 * The light follows the cursor (eased). Before the visitor moves, it drifts on
 * a slow path so the wall is alive on load.
 *
 * Mounted only via React.lazy from HiveGlow.tsx, desktop + fine pointer +
 * no reduced motion. Never server-rendered.
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const AMBER = new THREE.Color("#ffa726");
const R = 0.5; // hex circumradius (lattice)
const CELL = 0.87; // drawn size relative to lattice — the gap the light comes through
const COLS = 20;
const ROWS = 15;
// Depth pass (owner, 2026-10-10): deeper blocks, more relief between them and
// a stronger push under the cursor. Shape only — the approved lighting values
// below are unchanged.
const DEPTH = 0.9; // was 0.55
const RELIEF = 0.32; // max height offset between blocks (was 0.2)
const LIFT = 0.42; // push-forward under the cursor (was 0.28)
// The glowing backplane keeps the same clearance behind the deepest block as
// before (0.145), so the glow seen through the gaps looks the same.
const PLANE_Z = -(DEPTH / 2 + RELIEF + 0.145);

/** Deterministic PRNG — identical layout on every load. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pointy-top hexagon (vertices at 30°, 90°, …) to match the reference. */
function hexShape(r: number) {
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

const planeVertex = /* glsl */ `
varying vec2 vPos;
void main(){
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const planeFragment = /* glsl */ `
precision highp float;
uniform vec2  uLight;
uniform vec3  uAmber;
uniform float uPower;
varying vec2  vPos;
void main(){
  float d = distance(vPos, uLight);
  // Tight hot core + wide soft halo. Two falloffs rather than one is what
  // makes it read as a light source rather than a gradient.
  float core = exp(-(d * d) / 2.6);
  float halo = exp(-d / 4.2) * 0.55;
  vec3 col = uAmber * (core * 1.6 + halo) * uPower;
  // The very centre whitens slightly, like an overexposed bulb.
  col = mix(col, vec3(1.0, 0.92, 0.75), smoothstep(0.55, 1.0, core) * 0.35 * uPower);
  // A faint floor so the gaps far from the light are not dead black.
  col += uAmber * 0.018;
  gl_FragColor = vec4(col, 1.0);
}
`;

interface Cell {
  x: number;
  y: number;
  baseZ: number;
  phase: number;
}

function Wall() {
  const group = useRef<THREE.Group>(null);
  const plane = useRef<THREE.Mesh>(null);
  const blocks = useRef<THREE.InstancedMesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const { camera, gl, size } = useThree();
  // Landscape: wall to the right of the copy. Portrait (phones, upright
  // tablets): centred and lower, so it fills the background behind the text.
  const portrait = size.width / size.height < 1;

  const cells = useMemo<Cell[]>(() => {
    const rand = prng(0x4e1a);
    const w = Math.sqrt(3) * R;
    const h = 1.5 * R;
    const out: Cell[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        out.push({
          x: c * w + (r % 2) * (w / 2) - ((COLS - 1) * w) / 2,
          y: r * h - ((ROWS - 1) * h) / 2,
          // Uneven heights, like the reference — a flat wall looks like a texture.
          baseZ: (rand() - 0.5) * 2 * RELIEF,
          phase: rand() * Math.PI * 2,
        });
      }
    }
    return out;
  }, []);

  const geometry = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(hexShape(R * CELL), {
      depth: DEPTH,
      bevelEnabled: true,
      bevelThickness: 0.06, // was 0.045
      bevelSize: 0.05, // was 0.04
      bevelSegments: 3,
      curveSegments: 1,
    });
    g.translate(0, 0, -DEPTH / 2);
    return g;
  }, []);

  // White base: each block's real colour comes from instanceColor (set per
  // frame below), which multiplies this. That is what lets blocks near the
  // cursor turn gold while the rest stay charcoal.
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        metalness: 0.55,
        roughness: 0.36,
      }),
    [],
  );
  const DARK = useMemo(() => new THREE.Color("#15171c"), []);
  const WARM = useMemo(() => new THREE.Color("#9a6416"), []);
  const tint = useMemo(() => new THREE.Color(), []);
  const front = useRef<THREE.PointLight>(null);

  const uniforms = useMemo(
    () => ({
      uLight: { value: new THREE.Vector2(0, 0) },
      uAmber: { value: AMBER },
      // Starts fully lit: the static SVG underneath is already showing a lit
      // wall, so ramping up from dark read as the light switching off and on.
      uPower: { value: 1 },
    }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  // Pointer tracked on window (the canvas itself is pointer-events: none so it
  // never blocks the CTAs), converted to NDC relative to the canvas.
  const ndc = useRef(new THREE.Vector2());
  const moved = useRef(false);
  // Touch screens have no hover: a touch moves the light there, and after a
  // few seconds without touching it goes back to drifting on its own.
  const touchAt = useRef(0);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.type === "pointermove" && e.buttons === 0) return;
      const rect = gl.domElement.getBoundingClientRect();
      ndc.current.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      moved.current = true;
      touchAt.current = e.pointerType === "mouse" ? 0 : performance.now();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
    };
  }, [gl]);

  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const target = useRef(new THREE.Vector2(1.5, 0.5));
  const cur = useRef(new THREE.Vector2(1.5, 0.5));
  const z = useRef<Float32Array>(new Float32Array(COLS * ROWS));
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;


    if (moved.current && touchAt.current && performance.now() - touchAt.current > 4000) {
      moved.current = false; // touch went quiet: resume the idle drift
    }
    if (moved.current && plane.current && group.current) {
      raycaster.setFromCamera(ndc.current, camera);
      const hit = raycaster.intersectObject(plane.current, false)[0];
      if (hit) {
        const local = group.current.worldToLocal(hit.point.clone());
        target.current.set(local.x, local.y);
      }
    } else {
      // Idle drift: a slow wandering path so the wall is alive before anyone
      // moves the mouse.
      // On upright screens the visible area is narrow, so the drift path is
      // tighter (and taller) to keep the light on screen.
      if (portrait) target.current.set(Math.sin(t * 0.23) * 1.4, Math.cos(t * 0.17) * 2.6 + 0.4);
      else target.current.set(Math.sin(t * 0.23) * 3.2 + 1, Math.cos(t * 0.17) * 2);
    }

    cur.current.lerp(target.current, 0.07);
    uniforms.uLight.value.copy(cur.current);
    if (light.current) {
      light.current.position.set(cur.current.x, cur.current.y, -0.15);
      light.current.intensity = 16 * uniforms.uPower.value;
    }
    // A second warm light IN FRONT of the wall at the cursor: the rear light
    // only reaches the edges, this one puts a golden sheen on the faces.
    if (front.current) {
      front.current.position.set(cur.current.x, cur.current.y, 1.7);
      front.current.intensity = 13 * uniforms.uPower.value;
    }

    const zs = z.current;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const d = Math.hypot(c.x - cur.current.x, c.y - cur.current.y);
      // Blocks near the light ease forward a touch, as if pushed by it.
      const lift = Math.exp(-(d * d) / 3.5) * LIFT;
      const want = c.baseZ + lift + Math.sin(t * 0.4 + c.phase) * 0.025;
      zs[i] += (want - zs[i]) * 0.08;
      dummy.position.set(c.x, c.y, zs[i]);
      dummy.updateMatrix();
      blocks.current?.setMatrixAt(i, dummy.matrix);

      // Gold tint, wider and softer than the lift so a warm patch spreads
      // across several blocks around the cursor, fading to charcoal.
      const warmth = Math.exp(-(d * d) / 7) * uniforms.uPower.value;
      tint.copy(DARK).lerp(WARM, warmth);
      blocks.current?.setColorAt(i, tint);
    }
    if (blocks.current) {
      blocks.current.instanceMatrix.needsUpdate = true;
      if (blocks.current.instanceColor) blocks.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    // Tilted and pushed right, like the reference: the wall recedes away
    // from the copy rather than facing the camera flat.
    <group
      ref={group}
      position={portrait ? [0.4, -0.5, 0] : [3.1, -0.1, 0]}
      // Smaller on upright screens: more, smaller hexagons instead of a few huge ones.
      scale={portrait ? 0.72 : 1}
      rotation={portrait ? [0.18, -0.32, 0.04] : [0.14, -0.5, 0.04]}
    >
      <mesh ref={plane} position={[0, 0, PLANE_Z]}>
        <planeGeometry args={[40, 30]} />
        <shaderMaterial
          vertexShader={planeVertex}
          fragmentShader={planeFragment}
          uniforms={uniforms}
          toneMapped={false}
        />
      </mesh>

      <pointLight ref={light} color={AMBER} intensity={0} distance={9} decay={1.5} />
      <pointLight ref={front} color="#ffbe5c" intensity={0} distance={6.5} decay={1.8} />

      <instancedMesh
        ref={blocks}
        args={[geometry, material, cells.length]}
        frustumCulled={false}
      />
    </group>
  );
}

function useWrapVisible(ref: RefObject<HTMLDivElement | null>) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      rootMargin: "80px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return visible;
}

export default function HexBacklight({ onReady }: { onReady?: () => void } = {}) {
  const wrap = useRef<HTMLDivElement>(null);
  // Phones and tablets: cap the resolution and skip anti-aliasing. Their
  // screens are dense enough that it isn't visible, and it roughly halves the
  // GPU work (battery, heat, smooth scrolling).
  const [touch] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
  );
  const visible = useWrapVisible(wrap);
  // Cross-fade over the static SVG once the first frames have rendered, so
  // the handoff from still image to live wall is invisible.
  const [ready, setReady] = useState(false);

  return (
    <div ref={wrap} style={{ position: "absolute", inset: 0, opacity: ready ? 1 : 0, transition: "opacity 900ms ease" }}>
      <Canvas
        aria-hidden="true"
        dpr={touch ? [1, 1.5] : [1, 2]}
        frameloop={visible ? "always" : "never"}
        gl={{ antialias: !touch, powerPreference: touch ? "default" : "high-performance" }}
        camera={{ position: [0, 0, 9], fov: 40 }}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        onCreated={({ gl }) => {
          gl.setClearColor("#070504");
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              setReady(true);
              onReady?.();
            }),
          );
        }}
      >
        {/* Barely-there front light so the block faces are not pure black;
            the drama is all in the backlight. */}
        {/* Warm, low fill so the whole wall reads faintly even far from the
            cursor, instead of falling to pure black. */}
        <ambientLight intensity={0.1} color="#ffe2b0" />
        <directionalLight position={[-3, 4, 6]} intensity={0.45} color="#ffd9a0" />
        <Wall />
      </Canvas>
    </div>
  );
}
