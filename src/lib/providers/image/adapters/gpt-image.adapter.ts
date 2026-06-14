import type { ImageProvider, ImageGenerateParams, ImageGenerateResult } from "../interface";

export class GPTImageAdapter implements ImageProvider {
  readonly name = "gpt_image";

  constructor(private readonly apiKey: string = "") {}

  async generate(params: ImageGenerateParams): Promise<ImageGenerateResult> {
    const key = this.apiKey || process.env.OPENAI_API_KEY || "";
    if (!key) throw new Error("OpenAI API key not configured for GPT Image generation");

    const width  = params.width  ?? 1024;
    const height = params.height ?? 1024;
    const validSizes = ["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"] as const;
    const sizeStr = `${width}x${height}`;
    const size: typeof validSizes[number] = (validSizes as readonly string[]).includes(sizeStr)
      ? (sizeStr as typeof validSizes[number])
      : "1024x1024";

    const body: Record<string, unknown> = {
      model: "dall-e-3",
      prompt: params.prompt,
      n: 1,
      size,
      response_format: "url",
    };
    if (params.style) body.style = params.style === "photorealistic" ? "natural" : "vivid";

    const resp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenAI image generation error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return {
      images: (data.data ?? []).map((img: any) => ({
        url: img.url ?? "",
        b64: img.b64_json,
      })),
      revisedPrompt: data.data?.[0]?.revised_prompt,
    };
  }

  async healthCheck(): Promise<boolean> {
    const key = this.apiKey || process.env.OPENAI_API_KEY || "";
    if (!key) return false;
    try {
      const resp = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
