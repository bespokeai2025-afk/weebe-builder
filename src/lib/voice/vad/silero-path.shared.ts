/**
 * Resolve Silero VAD model path from env or well-known locations.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const CANDIDATE_RELATIVE = [
  "models/silero_vad.onnx",
  "vendor/silero_vad.onnx",
  "node_modules/@ricky0123/vad-node/dist/silero_vad.onnx",
  "node_modules/@ricky0123/vad-web/dist/silero_vad.onnx",
];

/** First existing Silero ONNX model path, or null. */
export function resolveSileroModelPath(explicit?: string | null): string | null {
  const fromArg = explicit?.trim();
  if (fromArg && existsSync(fromArg)) return fromArg;

  const fromEnv = process.env.SILERO_VAD_MODEL_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const cwd = process.cwd();
  for (const rel of CANDIDATE_RELATIVE) {
    const abs = resolve(cwd, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}
