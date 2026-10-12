/**
 * CONCEPT 4 — LIQUID METAL
 *
 * A smooth displaced sphere with a chrome/iridescent surface that slowly
 * breathes and morphs. The most contemporary of the four — the Linear /
 * Vercel / Apple register.
 *
 * Reads as: PREMIUM. Honest caveat: it is abstract. It says "expensive
 * software company", not "answers your phone".
 *
 * True chrome needs an environment to reflect. Rather than ship an HDR file,
 * this builds a small gradient cube texture in memory — charcoal below,
 * gold-tinted above, with a cool band — so the metal has something to pick up.
 * Costs nothing to download and looks far better than lights alone.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SceneCanvas, usePointer, noise3, GOLD, COOL } from "./shared";

/** Paints a vertical gradient into a cube map so the metal has reflections. */
function useGradientEnv() {
  const { gl } = useThree();
  return useMemo(() => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grd = ctx.createLinearGradient(0, 0, 0, size);
    grd.addColorStop(0, "#ffd98a"); // warm sky — becomes the gold sheen
    grd.addColorStop(0.42, "#4a6a92");
    grd.addColorStop(0.62, "#13243c");
    grd.addColorStop(1, "#02060e"); // dark floor
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);

    // a cool streak, so the surface has a second highlight to catch
    const streak = ctx.createLinearGradient(0, size * 0.3, size, size * 0.5);
    streak.addColorStop(0, "rgba(56,189,248,0)");
    streak.addColorStop(0.5, "rgba(56,189,248,0.55)");
    streak.addColorStop(1, "rgba(56,189,248,0)");
    ctx.fillStyle = streak;
    ctx.fillRect(0, size * 0.28, size, size * 0.2);

    const tex = new THREE.CubeTexture([canvas, canvas, canvas, canvas, canvas, canvas]);
    tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromCubemap(tex).texture;
    pmrem.dispose();
    return env;
  }, [gl]);
}

function Blob() {
  const mesh = useRef<THREE.Mesh>(null);
  const pointer = usePointer();
  const env = useGradientEnv();

  // High-detail icosahedron: smooth enough to displace without faceting.
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(2.5, 48), []);
  const base = useMemo(() => geometry.attributes.position.array.slice() as Float32Array, [geometry]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 0.42;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;

    // Breathe: amplitude swells and settles rather than running flat.
    const breathe = 0.16 + Math.sin(clock.elapsedTime * 0.55) * 0.055;

    for (let i = 0; i < arr.length; i += 3) {
      const x = base[i];
      const y = base[i + 1];
      const z = base[i + 2];
      const len = Math.sqrt(x * x + y * y + z * z);
      const nx = x / len;
      const ny = y / len;
      const nz = z / len;

      const d =
        noise3(nx * 1.6 + t, ny * 1.6 - t * 0.7, nz * 1.6 + t * 0.4) * breathe +
        noise3(nx * 3.4 - t * 0.9, ny * 3.4 + t * 0.5, nz * 3.4) * breathe * 0.4;

      const r = 2.5 + d;
      arr[i] = nx * r;
      arr[i + 1] = ny * r;
      arr[i + 2] = nz * r;
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    if (mesh.current) {
      mesh.current.rotation.y = clock.elapsedTime * 0.08 + pointer.current.x * 0.3;
      mesh.current.rotation.x = pointer.current.y * 0.18;
    }
  });

  return (
    <mesh ref={mesh} geometry={geometry}>
      <meshStandardMaterial
        color="#c9d6e8"
        metalness={1}
        roughness={0.14}
        envMap={env}
        envMapIntensity={1.5}
      />
    </mesh>
  );
}

/** A thin gold ring behind the blob gives it a horizon to reflect and reads
 *  as deliberate framing rather than a lone ball. */
function Ring() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = clock.elapsedTime * 0.06;
  });
  return (
    <mesh ref={ref} position={[0, 0, -1.6]} rotation={[Math.PI / 2.6, 0, 0]}>
      <torusGeometry args={[4.1, 0.012, 8, 128]} />
      <meshBasicMaterial color={GOLD} transparent opacity={0.5} />
    </mesh>
  );
}

export default function LiquidMetal() {
  return (
    <SceneCanvas offset={1.85}>
      <Blob />
      <Ring />
      {/* extra cool kicker so the chrome has a blue edge on the shadow side */}
      <pointLight position={[-6, 1, 2]} intensity={30} distance={20} color={COOL} />
    </SceneCanvas>
  );
}
