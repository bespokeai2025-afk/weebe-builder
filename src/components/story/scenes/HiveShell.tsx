/**
 * CONCEPT 2 — HIVE SHELL
 *
 * One large curved honeycomb dome, offset right, slowly rotating under a gold
 * rim light. Individual cells light up and fade as "calls" land on them.
 *
 * Reads as: HIVE / SCALE. This is the concept that gives gold an actual job —
 * a lit cell means a live call, a dormant cell is cool steel — instead of
 * scattering gold at random.
 *
 * Cells are hexagonal prisms placed on a sphere via Fibonacci distribution and
 * oriented along the surface normal, so the packing stays even with no poles
 * and no visible grid seams.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SceneCanvas, usePointer, prng, GOLD, COOL } from "./shared";

const CELLS = 150;
const RADIUS = 3.05;

export function Shell() {
  const group = useRef<THREE.Group>(null);
  const coolRef = useRef<THREE.InstancedMesh>(null);
  const goldRef = useRef<THREE.InstancedMesh>(null);
  const pointer = usePointer();

  // Fibonacci sphere, then keep only the hemisphere facing camera-ish so we
  // render a shell rather than a full ball — half the instances, same read.
  const cells = useMemo(() => {
    const rand = prng(0xbee);
    const out: { pos: THREE.Vector3; quat: THREE.Quaternion; phase: number; scale: number }[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < CELLS * 2; i++) {
      const y = 1 - (i / (CELLS * 2 - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      const n = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r);
      if (n.z < -0.15) continue; // drop the far side

      const quat = new THREE.Quaternion().setFromUnitVectors(up, n);
      out.push({
        pos: n.clone().multiplyScalar(RADIUS),
        quat,
        phase: rand() * 100,
        scale: 0.9 + rand() * 0.22,
      });
    }
    return out;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;

    if (group.current) {
      group.current.rotation.y = t * 0.105 + pointer.current.x * 0.22;
      group.current.rotation.x = -0.14 + pointer.current.y * 0.12;
      group.current.rotation.z = 0.12;
    }

    let ci = 0;
    let gi = 0;
    for (const c of cells) {
      // A slow travelling wave decides which cells are "live". Because it is a
      // function of position and time it reads as activity sweeping across the
      // hive rather than random twinkling.
      const live = Math.sin(t * 0.85 + c.phase * 0.6 + c.pos.x * 0.55 + c.pos.y * 0.4);
      const isGold = live > 0.82;

      dummy.position.copy(c.pos);
      dummy.quaternion.copy(c.quat);
      const lift = isGold ? 1 + (live - 0.82) * 1.6 : 1;
      dummy.scale.set(c.scale, c.scale * 0.42 * lift, c.scale);
      dummy.position.addScaledVector(c.pos.clone().normalize(), isGold ? (live - 0.82) * 0.9 : 0);
      dummy.updateMatrix();

      if (isGold) goldRef.current?.setMatrixAt(gi++, dummy.matrix);
      else coolRef.current?.setMatrixAt(ci++, dummy.matrix);
    }

    if (coolRef.current) {
      coolRef.current.count = ci;
      coolRef.current.instanceMatrix.needsUpdate = true;
    }
    if (goldRef.current) {
      goldRef.current.count = gi;
      goldRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={group}>
      <instancedMesh ref={coolRef} args={[undefined, undefined, cells.length]}>
        <cylinderGeometry args={[0.2, 0.2, 0.42, 6]} />
        <meshStandardMaterial color="#2d4560" metalness={0.85} roughness={0.36} />
      </instancedMesh>

      <instancedMesh ref={goldRef} args={[undefined, undefined, cells.length]}>
        <cylinderGeometry args={[0.2, 0.2, 0.42, 6]} />
        <meshStandardMaterial
          color={GOLD}
          emissive={GOLD}
          emissiveIntensity={0.85}
          metalness={0.7}
          roughness={0.22}
        />
      </instancedMesh>

      {/* Dark core so the shell reads as a solid object, not a cloud */}
      <mesh>
        <sphereGeometry args={[RADIUS - 0.26, 48, 48]} />
        <meshStandardMaterial color="#030a16" metalness={0.5} roughness={0.9} />
      </mesh>
    </group>
  );
}

export default function HiveShell() {
  return (
    <SceneCanvas offset={2.0}>
      <Shell />
    </SceneCanvas>
  );
}
