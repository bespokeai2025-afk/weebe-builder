import type { ImageProvider, ImageGenerateParams, ImageGenerateResult } from "../interface";

// TODO: implement — connect to Google Imagen 3 API
// Docs: https://cloud.google.com/vertex-ai/generative-ai/docs/image/overview
export class ImagenAdapter implements ImageProvider {
  readonly name = "imagen";

  constructor(private readonly _apiKey: string) {}

  async generate(_params: ImageGenerateParams): Promise<ImageGenerateResult> {
    throw new Error("Google Imagen provider not yet implemented.");
  }
}
