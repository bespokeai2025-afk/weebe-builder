import type { ImageProvider, ImageGenerateParams, ImageGenerateResult } from "./interface";
import { GPTImageAdapter } from "./adapters/gpt-image.adapter";
import { ImagenAdapter } from "./adapters/imagen.adapter";
import { withProviderTracking } from "@/lib/providers/instrumentation";

export type ImageProviderName = "gpt_image" | "imagen" | "stable_diff" | "midjourney" | "flux";

export type ImageConfig =
  | { provider: "gpt_image"; apiKey: string }
  | { provider: "imagen"; gcpProject?: string; accessToken?: string }
  | { provider: "stable_diff"; apiKey: string }
  | { provider: "midjourney"; apiKey: string }
  | { provider: "flux"; apiKey: string };

/**
 * Create an ImageProvider. When `workspaceId` is included in `config`,
 * every method call is automatically tracked in provider_usage.
 */
export function createImageProvider(
  config: ImageConfig & { workspaceId?: string },
): ImageProvider {
  let inner: ImageProvider;
  switch (config.provider) {
    case "gpt_image":
      inner = new GPTImageAdapter(config.apiKey);
      break;
    case "imagen":
      inner = new ImagenAdapter({ gcpProject: config.gcpProject, accessToken: config.accessToken });
      break;
    case "stable_diff":
      throw new Error("Stable Diffusion image provider not yet implemented.");
    case "midjourney":
      throw new Error("Midjourney image provider not yet implemented.");
    case "flux":
      throw new Error("Flux image provider not yet implemented.");
    default:
      throw new Error(`Unknown image provider: ${String((config as any).provider)}`);
  }

  if (!config.workspaceId) return inner;

  const { workspaceId, provider: providerName } = config;
  const track = <T>(fn: () => Promise<T>) =>
    withProviderTracking({ workspaceId, category: "image", providerName }, fn);

  return {
    name: inner.name,
    generate: (params: ImageGenerateParams): Promise<ImageGenerateResult> =>
      track(() => inner.generate(params)),
  };
}

/** @deprecated Use createImageProvider({ ..., workspaceId }) instead. */
export const createInstrumentedImageProvider = (
  config: ImageConfig & { workspaceId: string },
): ImageProvider => createImageProvider(config);
