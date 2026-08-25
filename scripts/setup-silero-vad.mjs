/**
 * Download Silero VAD v5 ONNX into models/silero_vad.onnx for WEBEE Native.
 *
 *   node scripts/setup-silero-vad.mjs
 *   bun add onnxruntime-node   # required runtime (~270 MB native)
 *
 * Then set SILERO_VAD_MODEL_PATH=models/silero_vad.onnx or rely on auto-discovery.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, "../models/silero_vad.onnx");

const SOURCES = [
  "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx",
  "https://huggingface.co/onnx-community/silero-vad/resolve/main/silero_vad.onnx",
];

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  let buf = null;
  for (const url of SOURCES) {
    try {
      console.log(`Fetching ${url} …`);
      buf = await download(url);
      if (buf.byteLength > 10_000) break;
      buf = null;
    } catch (err) {
      console.warn(`  failed: ${err.message}`);
    }
  }
  if (!buf) {
    console.error("Could not download Silero VAD model from any source.");
    process.exit(1);
  }
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, buf);
  console.log(`Wrote ${OUT} (${buf.byteLength} bytes)`);
  console.log("Add to .env: SILERO_VAD_MODEL_PATH=models/silero_vad.onnx");
  console.log("Install runtime: bun add onnxruntime-node");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
