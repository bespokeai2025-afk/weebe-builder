import * as THREE from "three";
import { noise3 } from "./shared";

const EPS = 0.09;

function field(x: number, y: number, z: number, t: number) {
  return (
    noise3(x * 0.38 + t * 0.22, y * 0.38 - t * 0.11, z * 0.38) * 1.1 +
    noise3(x * 0.72 - t * 0.17, y * 0.72 + t * 0.08, z * 0.72) * 0.55 +
    noise3(x * 1.35 + t * 0.09, y * 1.35, z * 1.35 - t * 0.05) * 0.22
  );
}

/** Cheap curl-noise-style velocity for flocking particles. */
export function curlFlow(
  x: number,
  y: number,
  z: number,
  t: number,
  out: THREE.Vector3,
) {
  const dx = (field(x + EPS, y, z, t) - field(x - EPS, y, z, t)) / (2 * EPS);
  const dy = (field(x, y + EPS, z, t) - field(x, y - EPS, z, t)) / (2 * EPS);
  const dz = (field(x, y, z + EPS, t) - field(x, y, z - EPS, t)) / (2 * EPS);
  out.set(dy - dz, dz - dx, dx - dy);
  out.multiplyScalar(0.42);
}
