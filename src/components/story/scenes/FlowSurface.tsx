/**
 * The GLSL hero surface.
 *
 * A high-resolution plane displaced and shaded entirely on the GPU: Fresnel
 * rim, thin-film iridescence, a tracked specular glint, and height-driven
 * base colour. Nothing here is a stock three.js material.
 *
 * Scroll is wired through GSAP ScrollTrigger, which writes to a uniform. The
 * uniform is mutated directly — scroll never touches React state, so there is
 * no re-render at any point during the scroll.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SceneCanvas } from "./shared";
import { flowFragment, flowVertex } from "./shaders/flow";

gsap.registerPlugin(ScrollTrigger);

const GOLD = new THREE.Color("#ffc940");
const COOL = new THREE.Color("#2f7fb8");
const DEEP = new THREE.Color("#04101f");

function Surface({ scrollTarget }: { scrollTarget?: string }) {
  const mesh = useRef<THREE.Mesh>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: 1.15 },
      // Flow rate. Low enough to feel deliberate rather than busy; the eye
      // reads direction long before it reads speed.
      uSpeed: { value: 0.42 },
      uScroll: { value: 0 },
      uOpacity: { value: 1 },
      uGold: { value: GOLD },
      uCool: { value: COOL },
      uDeep: { value: DEEP },
    }),
    [],
  );

  // 180x110 segments over a 16x9 plane: dense enough that the displacement
  // reads as a smooth surface rather than faceted, cheap enough to stay well
  // inside frame budget because all the work is on the GPU.
  const geometry = useMemo(() => new THREE.PlaneGeometry(16, 9, 180, 110), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // GSAP drives a single uniform. Tweening the uniform rather than a React
  // value is what keeps the scroll free of renders.
  useEffect(() => {
    if (!scrollTarget) return;
    const el = document.querySelector(scrollTarget);
    if (!el) return;

    const st = ScrollTrigger.create({
      trigger: el as HTMLElement,
      start: "top top",
      end: "bottom top",
      scrub: 0.6,
      onUpdate: (self) => {
        uniforms.uScroll.value = self.progress;
        // The surface flattens and recedes as the hero scrolls away, so it
        // hands over to the content below instead of competing with it.
        uniforms.uAmp.value = 1.15 - self.progress * 0.55;
        // Flow accelerates slightly as the hero leaves, so the surface feels
        // carried away rather than switched off.
        uniforms.uSpeed.value = 0.42 + self.progress * 0.3;
        uniforms.uOpacity.value = 1 - self.progress * 0.72;
      },
    });
    return () => st.kill();
  }, [scrollTarget, uniforms]);

  useFrame((state, delta) => {
    uniforms.uTime.value += delta;
    if (mesh.current) {
      // Very slight pointer parallax. Decorative only — it carries no
      // information, so nothing is lost without a mouse.
      const p = state.pointer;
      mesh.current.rotation.x = -0.72 + p.y * 0.045;
      mesh.current.rotation.z = p.x * 0.035;
    }
  });

  return (
    <mesh ref={mesh} geometry={geometry} rotation={[-0.72, 0, 0]} position={[0, -1.1, 0]}>
      <shaderMaterial
        vertexShader={flowVertex}
        fragmentShader={flowFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.NormalBlending}
      />
    </mesh>
  );
}

export default function FlowSurface({
  scrollTarget,
  offset = 0,
}: {
  scrollTarget?: string;
  offset?: number;
}) {
  return (
    <SceneCanvas offset={offset}>
      <Surface scrollTarget={scrollTarget} />
    </SceneCanvas>
  );
}
