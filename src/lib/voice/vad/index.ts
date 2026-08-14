/**
 * Voice activity detection — backend selection.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { EnergyVad, type EnergyVadOptions } from "./energy";
import { SileroVad, type SileroVadOptions } from "./silero";
import type { Vad } from "./types";

export { computeRms, EnergyVad, type EnergyVadOptions } from "./energy";
export { SileroVad, type SileroVadOptions } from "./silero";
export { Endpointer, type EndpointingOptions, type Vad, type VadEvent } from "./types";

/** Logged once per process so a misconfigured Silero setup is visible but not noisy. */
let fallbackReported = false;

/**
 * Create the best available detector.
 *
 * Silero is preferred when its runtime and model are present; otherwise the
 * adaptive energy detector is used. Both share the same endpointing, so turn
 * timing does not change with the backend.
 */
export async function createVad(options: SileroVadOptions & EnergyVadOptions = {}): Promise<Vad> {
  try {
    return await SileroVad.create(options);
  } catch (err) {
    if (!fallbackReported) {
      fallbackReported = true;
      console.log(
        `[vad] using energy detector (Silero unavailable: ${err instanceof Error ? err.message : String(err)})`,
      );
    }
    return new EnergyVad(options);
  }
}
