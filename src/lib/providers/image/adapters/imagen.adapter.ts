import type { ImageProvider, ImageGenerateParams, ImageGenerateResult } from "../interface";

/**
 * Google Imagen 3 via Vertex AI REST API.
 * Requires GCP service account JSON (base64) and project ID stored in credentials.
 * Docs: https://cloud.google.com/vertex-ai/generative-ai/docs/image/overview
 */
export class ImagenAdapter implements ImageProvider {
  readonly name = "imagen";

  constructor(private readonly config: { serviceAccountJson?: string; gcpProject?: string; accessToken?: string }) {}

  async generate(params: ImageGenerateParams): Promise<ImageGenerateResult> {
    const { gcpProject, accessToken } = this.config;
    if (!gcpProject || !accessToken) {
      throw new Error("Google Imagen requires a GCP project ID and OAuth access token");
    }

    const location = "us-central1";
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${gcpProject}/locations/${location}/publishers/google/models/imagegeneration@006:predict`;

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ prompt: params.prompt }],
        parameters: {
          sampleCount: params.n ?? 1,
          aspectRatio: params.width && params.height
            ? `${params.width}:${params.height}`
            : "1:1",
        },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Google Imagen error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    const images = (data.predictions ?? []).map((p: any) => ({
      b64: p.bytesBase64Encoded,
      url: p.bytesBase64Encoded
        ? `data:image/png;base64,${p.bytesBase64Encoded}`
        : "",
    }));

    return { images };
  }

  async healthCheck(): Promise<boolean> {
    const { gcpProject, accessToken } = this.config;
    if (!gcpProject || !accessToken) return false;
    try {
      const resp = await fetch(
        `https://us-central1-aiplatform.googleapis.com/v1/projects/${gcpProject}/locations/us-central1/publishers/google/models`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return resp.ok;
    } catch {
      return false;
    }
  }
}
