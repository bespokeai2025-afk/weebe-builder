import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "./interface";
import { GoogleVeoAdapter } from "./adapters/google-veo.adapter";
import { RunwayAdapter } from "./adapters/runway.adapter";
import { withProviderTracking } from "@/lib/providers/instrumentation";

export type VideoProviderName = "google_veo" | "runway" | "sora" | "pika";

export type VideoConfig =
  | { provider: "google_veo"; gcpProject?: string; accessToken?: string }
  | { provider: "runway"; apiKey: string }
  | { provider: "sora"; apiKey: string }
  | { provider: "pika"; apiKey: string };

/**
 * Create a VideoProvider. When `workspaceId` is included in `config`,
 * every method call is automatically tracked in provider_usage.
 */
export function createVideoProvider(
  config: VideoConfig & { workspaceId?: string },
): VideoProvider {
  let inner: VideoProvider;
  switch (config.provider) {
    case "google_veo":
      inner = new GoogleVeoAdapter({ gcpProject: config.gcpProject, accessToken: config.accessToken });
      break;
    case "runway":
      inner = new RunwayAdapter(config.apiKey);
      break;
    case "sora":
      throw new Error("OpenAI Sora video provider not yet implemented.");
    case "pika":
      throw new Error("Pika video provider not yet implemented.");
    default:
      throw new Error(`Unknown video provider: ${String((config as any).provider)}`);
  }

  if (!config.workspaceId) return inner;

  const { workspaceId, provider: providerName } = config;

  return {
    name: inner.name,
    generate: (params: VideoGenerateParams): Promise<VideoGenerateResult> =>
      withProviderTracking(
        { workspaceId, category: "video", providerName, unitsConsumed: 1, unitType: "video" },
        () => inner.generate(params),
      ),
    pollStatus: (jobId: string): Promise<VideoGenerateResult> =>
      withProviderTracking(
        { workspaceId, category: "video", providerName },
        () => inner.pollStatus(jobId),
      ),
  };
}

/** @deprecated Use createVideoProvider({ ..., workspaceId }) instead. */
export const createInstrumentedVideoProvider = (
  config: VideoConfig & { workspaceId: string },
): VideoProvider => createVideoProvider(config);
