export type AvaAudioLevels = {
  agent: number;
  mid: number;
};

/**
 * The dashboard does not currently expose an analyser node to the floating
 * entity. Keep the audio boundary compatible with the portable renderer so a
 * live analyser can be connected later without changing its drawing code.
 */
export const avaLevels: AvaAudioLevels = { agent: 0, mid: 0 };

export function getAvaLevels(): AvaAudioLevels {
  return avaLevels;
}

export function setAvaLevels(next: Partial<AvaAudioLevels>): void {
  if (typeof next.agent === "number") {
    avaLevels.agent = Math.max(0, Math.min(1, next.agent));
  }
  if (typeof next.mid === "number") {
    avaLevels.mid = Math.max(0, Math.min(1, next.mid));
  }
}