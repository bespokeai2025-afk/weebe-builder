// ── Subtitle file generation — shared (client-safe, pure) ────────────────────
// Turns the project's free-text subtitles into timed .srt / .vtt cue files.
// Timing is estimated from word count (reading pace) since there is no
// alignment engine — cues run sequentially and are clamped to sane durations.

export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

const MS_PER_WORD = 350;
const MIN_CUE_MS = 1500;
const MAX_CUE_MS = 7000;
const MAX_CUE_CHARS = 90;

/** Split subtitle text into cue-sized chunks (by line, then sentence, then length). */
function splitIntoChunks(text: string): string[] {
  const lines = text
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const line of lines) {
    const sentences = line.match(/[^.!?]+[.!?]*/g) ?? [line];
    let current = "";
    for (const raw of sentences) {
      const s = raw.trim();
      if (!s) continue;
      if (current && (current.length + s.length + 1) > MAX_CUE_CHARS) {
        chunks.push(current);
        current = s;
      } else {
        current = current ? `${current} ${s}` : s;
      }
      // Hard-split any single over-long sentence on word boundaries.
      while (current.length > MAX_CUE_CHARS) {
        const cut = current.lastIndexOf(" ", MAX_CUE_CHARS);
        const idx = cut > 20 ? cut : MAX_CUE_CHARS;
        chunks.push(current.slice(0, idx).trim());
        current = current.slice(idx).trim();
      }
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

/** Build sequential timed cues from free text. */
export function buildSubtitleCues(text: string): SubtitleCue[] {
  const chunks = splitIntoChunks(text);
  const cues: SubtitleCue[] = [];
  let t = 0;
  for (const chunk of chunks) {
    const words = chunk.split(/\s+/).filter(Boolean).length;
    const dur = Math.min(MAX_CUE_MS, Math.max(MIN_CUE_MS, words * MS_PER_WORD));
    cues.push({ startMs: t, endMs: t + dur, text: chunk });
    t += dur;
  }
  return cues;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

function formatTimestamp(ms: number, sep: "," | "."): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rem = Math.floor(ms % 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(rem, 3)}`;
}

/** SubRip (.srt) file contents. */
export function formatSrt(cues: SubtitleCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${formatTimestamp(c.startMs, ",")} --> ${formatTimestamp(c.endMs, ",")}\n${c.text}`)
    .join("\n\n") + "\n";
}

/** WebVTT (.vtt) file contents. */
export function formatVtt(cues: SubtitleCue[]): string {
  const body = cues
    .map((c) => `${formatTimestamp(c.startMs, ".")} --> ${formatTimestamp(c.endMs, ".")}\n${c.text}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}
