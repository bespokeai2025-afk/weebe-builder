export interface ImageGenerateParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  style?: string;
  referenceUrl?: string;
  n?: number;
}

export interface ImageEditParams {
  originalPrompt: string;
  editInstruction: string;
  width?: number;
  height?: number;
}

export interface ImageVariationParams {
  originalPrompt: string;
  variationHint?: string;
  width?: number;
  height?: number;
}

export interface ImageGenerateResult {
  images: Array<{ url: string; b64?: string }>;
  revisedPrompt?: string;
}

export interface ImageProvider {
  readonly name: string;
  generate(params: ImageGenerateParams): Promise<ImageGenerateResult>;
  edit?(params: ImageEditParams): Promise<ImageGenerateResult>;
  createVariation?(params: ImageVariationParams): Promise<ImageGenerateResult>;
  healthCheck?(): Promise<boolean>;
}
