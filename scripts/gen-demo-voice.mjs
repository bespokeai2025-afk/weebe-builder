// Renders the demo call lines with Cartesia into public/audio/demo.
// Usage: node scripts/gen-demo-voice.mjs   (needs CARTESIA_API_KEY in .env; costs ~300 characters of Cartesia credit)
// The marketing page only plays the saved files; it never calls Cartesia at runtime.
// The key is read from .env and never printed.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd(); // run from the repo root
const m = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^CARTESIA_API_KEY\s*=\s*"?([^"\r\n]+)/m);
if (!m) throw new Error("CARTESIA_API_KEY not found");
const KEY = m[1].trim();

const AVA = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"; // Jacqueline - Reassuring Agent
const CALLER = "86e30c1d-714b-4074-a1f2-1cb6b552fb49"; // Carson - Curious Conversationalist
const LINES = [
  [AVA, "Good afternoon, Harborview Dental, this is Ava. How can I help?"],
  [CALLER, "Hi! I'd like to book a consultation."],
  [AVA, "Of course. Have you visited us before?"],
  [CALLER, "No, first time. I'm looking at implants."],
  [AVA, "Perfect. I have Thursday at two thirty, or Friday morning."],
  [CALLER, "Thursday at two thirty works."],
  [AVA, "Booked. I've texted you the details. See you Thursday!"],
];

const out = path.join(root, "public/audio/demo");
for (let i = 0; i < LINES.length; i++) {
  const [voice, transcript] = LINES[i];
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: { "X-API-Key": KEY, "Cartesia-Version": "2024-11-13", "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: "sonic-2",
      transcript,
      voice: { mode: "id", id: voice },
      language: "en",
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    }),
  });
  if (!res.ok) {
    console.error(`turn-${i + 1}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(out, `turn-${i + 1}.mp3`), buf);
  console.log(`turn-${i + 1}.mp3  ${(buf.length / 1024).toFixed(1)} KB`);
}
