import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../interface";

// TODO: implement — connect to Google Veo API
// Docs: https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos
export class GoogleVeoAdapter implements VideoProvider {
  readonly name = "google_veo";

  constructor(private readonly _apiKey: string) {}

  async generate(_params: VideoGenerateParams): Promise<VideoGenerateResult> {
    throw new Error("Google Veo video provider not yet implemented.");
  }

  async pollStatus(_jobId: string): Promise<VideoGenerateResult> {
    throw new Error("Google Veo video provider not yet implemented.");
  }
}
