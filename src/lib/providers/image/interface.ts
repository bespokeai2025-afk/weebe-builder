export interface ImageGenerateParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  style?: string;
  referenceUrl?: string;
  n?: number;
}

export interface ImageGenerateResult {
  images: Array<{ url: string; b64?: string }>;
  revisedPrompt?: string;
}

export interface ImageProvider {
  readonly name: string;
  generate(params: ImageGenerateParams): Promise<ImageGenerateResult>;
  healthCheck?(): Promise<boolean>;
}
