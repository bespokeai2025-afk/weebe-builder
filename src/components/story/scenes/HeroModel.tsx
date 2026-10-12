/**
 * Loads the commissioned hero object and stages it.
 *
 * Drop the delivered file at `public/models/hive-core.glb` and it appears —
 * no code change needed. Until that file exists this renders nothing and the
 * caller falls back to the procedural scene, so the page is never broken by a
 * missing asset.
 *
 * GLTFLoader ships inside the `three` package (three/addons), so this adds no
 * new dependency.
 *
 * IF THE DELIVERED FILE IS DRACO-COMPRESSED the brief asks for it, and the
 * decoder has to be served locally — see DRACO_PATH below.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { SceneCanvas, usePointer, GOLD, COOL } from "./shared";

export const MODEL_URL = "/models/hive-core.glb";

/**
 * Draco decoder location. The three package ships the decoder files at
 * node_modules/three/examples/jsm/libs/draco/ — copy that folder to
 * public/draco/ once, and compressed models load. If the model is not
 * Draco-compressed this is simply never used.
 */
const DRACO_PATH = "/draco/";

/** Probe for the file before mounting a loader that would throw on 404. */
export function useModelAvailable(url = MODEL_URL) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch(url, { method: "HEAD" })
      .then((r) => live && setOk(r.ok))
      .catch(() => live && setOk(false));
    return () => {
      live = false;
    };
  }, [url]);
  return ok;
}

function Model({ url }: { url: string }) {
  const pointer = usePointer();
  const root = useRef<THREE.Group>(null);

  const gltf = useLoader(GLTFLoader, url, (loader) => {
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
    (loader as GLTFLoader).setDRACOLoader(draco);
  });

  // Normalise whatever the artist delivered: centre it on its own bounding box
  // and scale it to a known size, so the staging does not depend on them having
  // matched the pivot and scale spec exactly.
  const scene = useMemo(() => {
    const s = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(s);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    s.position.sub(centre);

    const longest = Math.max(size.x, size.y, size.z) || 1;
    const target = 5.2; // fills the hero frame at the shared camera distance
    s.scale.setScalar(target / longest);

    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      m.receiveShadow = false;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat && "envMapIntensity" in mat) mat.envMapIntensity = 1.35;
    });
    return s;
  }, [gltf]);

  useFrame(({ clock }) => {
    if (!root.current) return;
    // Slow, deliberate rotation. Anything faster reads as a product
    // configurator rather than a hero.
    root.current.rotation.y = clock.elapsedTime * 0.12 + pointer.current.x * 0.3;
    root.current.rotation.x = -0.06 + pointer.current.y * 0.12;
  });

  return (
    <group ref={root}>
      <primitive object={scene} />
    </group>
  );
}

export default function HeroModel({ url = MODEL_URL }: { url?: string }) {
  return (
    <SceneCanvas offset={1.9}>
      <Model url={url} />
      {/* A gold kicker behind the object separates it from the ground — the
          single biggest contributor to an object reading as expensive. */}
      <pointLight position={[5, 1.5, -5]} intensity={42} distance={20} color={GOLD} />
      <pointLight position={[-5, -2, 3]} intensity={20} distance={18} color={COOL} />
    </SceneCanvas>
  );
}
