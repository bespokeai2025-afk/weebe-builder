import type { ImageProvider, ImageGenerateParams, ImageGenerateResult } from "../interface";

// TODO: implement — connect to OpenAI GPT-Image-1 API
// Docs: https://platform.openai.com/docs/api-reference/images
export class GPTImageAdapter implements ImageProvider {
  readonly name = "gpt_image";

  constructor(private readonly _apiKey: string) {}

  async generate(_params: ImageGenerateParams): Promise<ImageGenerateResult> {
    throw new Error("GPT Image provider not yet implemented.");
  }
}
