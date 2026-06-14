import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../interface";

const RUNWAY_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_VERSION = "2024-11-06";

/**
 * Runway Gen-3 Alpha Turbo via the Runway ML API.
 * Docs: https://docs.dev.runwayml.com
 */
export class RunwayAdapter implements VideoProvider {
  readonly name = "runway";

  constructor(private readonly apiKey: string) {}

  async generate(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    if (!this.apiKey) throw new Error("Runway API key not configured");

    const ratio =
      params.aspectRatio === "9:16" ? "720:1280" :
      params.aspectRatio === "1:1"  ? "1:1"      :
      "1280:720";

    const resp = await fetch(`${RUNWAY_BASE}/image_to_video`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "X-Runway-Version": RUNWAY_VERSION,
      },
      body: JSON.stringify({
        model: "gen3a_turbo",
        promptText: params.prompt,
        duration: Math.min(params.durationSeconds ?? 5, 10),
        ratio,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Runway generation error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return {
      jobId: data.id ?? `runway_${Date.now()}`,
      status: "pending",
      estimatedSeconds: params.durationSeconds ? params.durationSeconds * 4 : 30,
    };
  }

  async pollStatus(jobId: string): Promise<VideoGenerateResult> {
    if (!this.apiKey) throw new Error("Runway API key not configured");

    const resp = await fetch(`${RUNWAY_BASE}/tasks/${jobId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "X-Runway-Version": RUNWAY_VERSION,
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Runway poll error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    const status: VideoGenerateResult["status"] =
      data.status === "SUCCEEDED" ? "completed" :
      data.status === "FAILED"    ? "failed"    :
      "processing";

    return {
      jobId,
      status,
      videoUrl: data.output?.[0] ?? undefined,
      thumbnailUrl: data.output?.[1] ?? undefined,
    };
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const resp = await fetch(`${RUNWAY_BASE}/organization`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "X-Runway-Version": RUNWAY_VERSION,
        },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
