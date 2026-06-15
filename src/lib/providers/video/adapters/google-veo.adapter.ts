import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../interface";

const VERTEX_BASE = "https://us-central1-aiplatform.googleapis.com/v1";
const VEO3_MODEL  = "veo-3.0-generate-preview";

/**
 * Google Veo 3 via Vertex AI REST API.
 * Docs: https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos
 *
 * Credentials: GCP project ID + OAuth 2.0 access token.
 * Configure them under Settings → Providers → Video → Google Veo 3.
 * Falls back to GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_ACCESS_TOKEN env vars.
 */
export class GoogleVeoAdapter implements VideoProvider {
  readonly name = "google_veo";

  constructor(
    private readonly config: { gcpProject?: string; accessToken?: string } = {},
  ) {}

  private get project(): string {
    return (this.config.gcpProject ?? "").trim() || process.env.GOOGLE_CLOUD_PROJECT || "";
  }

  private get token(): string {
    return (this.config.accessToken ?? "").trim() || process.env.GOOGLE_CLOUD_ACCESS_TOKEN || "";
  }

  async generate(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    if (!this.project || !this.token) {
      throw new Error(
        "Google Veo 3 requires a GCP Project ID and an OAuth access token. " +
        "Configure them under Settings → Providers → Video → Google Veo 3.",
      );
    }

    const endpoint =
      `${VERTEX_BASE}/projects/${encodeURIComponent(this.project)}` +
      `/locations/us-central1/publishers/google/models/${VEO3_MODEL}:predictLongRunning`;

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{
          prompt: params.prompt,
          ...(params.referenceUrl ? { image: { gcsUri: params.referenceUrl } } : {}),
        }],
        parameters: {
          aspectRatio:     params.aspectRatio     ?? "16:9",
          durationSeconds: params.durationSeconds ?? 8,
          sampleCount:     1,
        },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      throw new Error(`Google Veo 3 generate error ${resp.status}: ${text.slice(0, 300)}`);
    }

    const data = await resp.json() as { name?: string };
    const operationName = data.name ?? "";
    if (!operationName) throw new Error("Google Veo 3 did not return an operation name.");

    return {
      jobId:            operationName,
      status:           "pending",
      estimatedSeconds: 120,
    };
  }

  async pollStatus(jobId: string): Promise<VideoGenerateResult> {
    if (!this.token) throw new Error("Google Veo 3 access token not configured.");

    const resp = await fetch(`${VERTEX_BASE}/${jobId}`, {
      headers: {
        Authorization:  `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) return { jobId, status: "failed" };

    const json = await resp.json() as any;
    if (json.error) return { jobId, status: "failed" };
    if (!json.done) return { jobId, status: "processing" };

    const predictions: any[] = json.response?.predictions ?? [];
    for (const pred of predictions) {
      if (typeof pred === "string" && (pred.startsWith("http") || pred.startsWith("gs://"))) {
        return { jobId, status: "completed", videoUrl: pred };
      }
      const uri = pred?.videoUri ?? pred?.gcsUri ?? pred?.uri ?? pred?.url;
      if (typeof uri === "string") return { jobId, status: "completed", videoUrl: uri };
      if (pred?.bytesBase64Encoded) {
        return { jobId, status: "completed", videoUrl: `data:video/mp4;base64,${pred.bytesBase64Encoded}` };
      }
    }

    return { jobId, status: "failed" };
  }

  async healthCheck(): Promise<boolean> {
    if (!this.project || !this.token) return false;
    try {
      const resp = await fetch(
        `${VERTEX_BASE}/projects/${encodeURIComponent(this.project)}/locations/us-central1`,
        { headers: { Authorization: `Bearer ${this.token}` } },
      );
      return resp.ok;
    } catch {
      return false;
    }
  }
}
