import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../interface";

/**
 * Google Veo via Vertex AI REST API.
 * Docs: https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos
 * Requires GCP project ID + OAuth access token stored in provider credentials.
 */
export class GoogleVeoAdapter implements VideoProvider {
  readonly name = "google_veo";

  constructor(private readonly config: { gcpProject?: string; accessToken?: string }) {}

  async generate(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const { gcpProject, accessToken } = this.config;
    if (!gcpProject || !accessToken) {
      throw new Error("Google Veo requires a GCP project ID and OAuth access token");
    }

    const location = "us-central1";
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${gcpProject}/locations/${location}/publishers/google/models/veo-2.0-generate-001:predictLongRunning`;

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{
          prompt: params.prompt,
          image: params.referenceUrl ? { gcsUri: params.referenceUrl } : undefined,
        }],
        parameters: {
          aspectRatio: params.aspectRatio ?? "16:9",
          durationSeconds: params.durationSeconds ?? 5,
          sampleCount: 1,
        },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Google Veo error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return {
      jobId: data.name ?? `veo_${Date.now()}`,
      status: "pending",
      estimatedSeconds: 60,
    };
  }

  async pollStatus(jobId: string): Promise<VideoGenerateResult> {
    const { gcpProject, accessToken } = this.config;
    if (!gcpProject || !accessToken) throw new Error("Google Veo credentials not configured");

    const resp = await fetch(
      `https://us-central1-aiplatform.googleapis.com/v1/${jobId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Google Veo poll error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    const done = data.done === true;
    const videos: string[] = data.response?.videos ?? [];

    return {
      jobId,
      status: done ? (data.error ? "failed" : "completed") : "processing",
      videoUrl: videos[0],
    };
  }

  async healthCheck(): Promise<boolean> {
    const { gcpProject, accessToken } = this.config;
    if (!gcpProject || !accessToken) return false;
    try {
      const resp = await fetch(
        `https://us-central1-aiplatform.googleapis.com/v1/projects/${gcpProject}/locations/us-central1`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return resp.ok;
    } catch {
      return false;
    }
  }
}
