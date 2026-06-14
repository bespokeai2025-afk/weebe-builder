import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../interface";

// TODO: implement — connect to Runway Gen-3 API
// Docs: https://docs.dev.runwayml.com
export class RunwayAdapter implements VideoProvider {
  readonly name = "runway";

  constructor(private readonly _apiKey: string) {}

  async generate(_params: VideoGenerateParams): Promise<VideoGenerateResult> {
    throw new Error("Runway video provider not yet implemented.");
  }

  async pollStatus(_jobId: string): Promise<VideoGenerateResult> {
    throw new Error("Runway video provider not yet implemented.");
  }
}
