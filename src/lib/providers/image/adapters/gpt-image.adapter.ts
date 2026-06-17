import type { ImageProvider, ImageGenerateParams, ImageGenerateResult, ImageEditParams, ImageVariationParams } from "../interface";

export class GPTImageAdapter implements ImageProvider {
  readonly name = "gpt_image";

  constructor(private readonly apiKey: string = "") {}

  private key(): string {
    const k = this.apiKey || process.env.OPENAI_API_KEY || "";
    if (!k) throw new Error("OpenAI API key not configured for GPT Image generation");
    return k;
  }

  private resolveSize(width?: number, height?: number): "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792" {
    const validSizes = ["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"] as const;
    const sizeStr = `${width ?? 1024}x${height ?? 1024}`;
    return (validSizes as readonly string[]).includes(sizeStr)
      ? (sizeStr as typeof validSizes[number])
      : "1024x1024";
  }

  async generate(params: ImageGenerateParams): Promise<ImageGenerateResult> {
    const body: Record<string, unknown> = {
      model: "dall-e-3",
      prompt: params.prompt,
      n: 1,
      size: this.resolveSize(params.width, params.height),
      response_format: "url",
    };
    if (params.style) body.style = params.style === "photorealistic" ? "natural" : "vivid";

    const resp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenAI image generation error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return {
      images: (data.data ?? []).map((img: any) => ({ url: img.url ?? "", b64: img.b64_json })),
      revisedPrompt: data.data?.[0]?.revised_prompt,
    };
  }

  async edit(params: ImageEditParams): Promise<ImageGenerateResult> {
    const editPrompt = [
      params.editInstruction,
      params.originalPrompt ? `Based on concept: ${params.originalPrompt}` : "",
    ].filter(Boolean).join(". ");
    return this.generate({ prompt: editPrompt, width: params.width, height: params.height });
  }

  async createVariation(params: ImageVariationParams): Promise<ImageGenerateResult> {
    const hints = ["alternative approach", "different angle", "reimagined style", "fresh perspective", "new composition"];
    const hint = params.variationHint ?? hints[Math.floor(Math.random() * hints.length)];
    const variationPrompt = `${params.originalPrompt} — ${hint}, distinct visual treatment, same core subject`;
    return this.generate({ prompt: variationPrompt, width: params.width, height: params.height });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${this.key()}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
