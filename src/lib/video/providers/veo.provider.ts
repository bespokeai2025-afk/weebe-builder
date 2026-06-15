/**
 * Veo Provider — Gemini API path
 *
 * Supports Google Veo video generation via the Gemini API (API-key auth),
 * as an alternative to the existing Vertex AI OAuth-token adapter.
 *
 * Credentials (in order of precedence):
 *   1. GEMINI_API_KEY env var or workspace provider_settings.credentials.geminiApiKey
 *   2. Falls back to Vertex AI OAuth if gcpProject + accessToken present
 *
 * Gemini API endpoints:
 *   Submit:  POST https://generativelanguage.googleapis.com/v1beta/models/{model}:predictLongRunning?key={API_KEY}
 *   Poll:    GET  https://generativelanguage.googleapis.com/v1beta/{operationName}?key={API_KEY}
 */

export type VeoConfig = {
  geminiApiKey?:  string;
  gcpProject?:    string;
  accessToken?:   string;
  location?:      string;
  model?:         string;
};

export type VeoGenerateParams = {
  prompt:          string;
  aspectRatio?:    "16:9" | "9:16" | "1:1" | "4:5";
  durationSeconds?: number;
  referenceUrl?:   string;
};

export type VeoJobResult =
  | { status: "pending";    jobId: string }
  | { status: "processing"; jobId: string }
  | { status: "completed";  jobId: string; videoUrl: string }
  | { status: "failed";     jobId: string; error?: string };

const GEMINI_BASE    = "https://generativelanguage.googleapis.com/v1beta";
const VERTEX_BASE    = "https://us-central1-aiplatform.googleapis.com/v1";
const DEFAULT_MODEL  = "veo-3.0-generate-preview";

export class VeoProvider {
  private readonly cfg: VeoConfig;

  constructor(cfg: VeoConfig = {}) {
    this.cfg = cfg;
  }

  private get geminiKey(): string {
    return (this.cfg.geminiApiKey ?? "").trim() || process.env.GEMINI_API_KEY || "";
  }

  private get accessToken(): string {
    return (this.cfg.accessToken ?? "").trim() || process.env.GOOGLE_CLOUD_ACCESS_TOKEN || "";
  }

  private get project(): string {
    return (this.cfg.gcpProject ?? "").trim() || process.env.GOOGLE_CLOUD_PROJECT || "";
  }

  private get model(): string {
    return (this.cfg.model ?? "").trim() || process.env.VEO_MODEL || DEFAULT_MODEL;
  }

  private get location(): string {
    return (this.cfg.location ?? "").trim() || process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  }

  /** Returns which auth path is active, or null if no credentials. */
  get authMode(): "gemini_api_key" | "vertex_oauth" | null {
    if (this.geminiKey) return "gemini_api_key";
    if (this.accessToken && this.project) return "vertex_oauth";
    return null;
  }

  // ── Generate ───────────────────────────────────────────────────────────────

  async generateVideo(params: VeoGenerateParams): Promise<VeoJobResult> {
    if (!this.authMode) {
      throw new Error(
        "Veo credentials not configured. Add a Gemini API Key under " +
        "Settings → Providers → Video → Google Veo 3.",
      );
    }

    const body = {
      instances: [{
        prompt: params.prompt,
        ...(params.referenceUrl ? { image: { gcsUri: params.referenceUrl } } : {}),
      }],
      parameters: {
        aspectRatio:     params.aspectRatio     ?? "16:9",
        durationSeconds: params.durationSeconds ?? 8,
        sampleCount:     1,
      },
    };

    let endpoint: string;
    let headers:  Record<string, string>;

    if (this.authMode === "gemini_api_key") {
      endpoint = `${GEMINI_BASE}/models/${this.model}:predictLongRunning?key=${encodeURIComponent(this.geminiKey)}`;
      headers  = { "Content-Type": "application/json" };
    } else {
      endpoint =
        `${VERTEX_BASE}/projects/${encodeURIComponent(this.project)}` +
        `/locations/${this.location}/publishers/google/models/${this.model}:predictLongRunning`;
      headers = {
        Authorization:  `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      };
    }

    const resp = await fetch(endpoint, {
      method:  "POST",
      headers,
      body:    JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      throw new Error(`Veo submit error ${resp.status}: ${text.slice(0, 300)}`);
    }

    const data = await resp.json() as { name?: string };
    const operationName = data.name ?? "";
    if (!operationName) throw new Error("Veo did not return an operation name.");

    return { status: "pending", jobId: operationName };
  }

  // ── Poll status ────────────────────────────────────────────────────────────

  async getStatus(jobId: string): Promise<VeoJobResult> {
    if (!this.authMode) throw new Error("Veo credentials not configured.");

    let endpoint: string;
    let headers:  Record<string, string>;

    if (this.authMode === "gemini_api_key") {
      endpoint = `${GEMINI_BASE}/${jobId}?key=${encodeURIComponent(this.geminiKey)}`;
      headers  = { "Content-Type": "application/json" };
    } else {
      endpoint = `${VERTEX_BASE}/${jobId}`;
      headers  = {
        Authorization:  `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      };
    }

    const resp = await fetch(endpoint, { headers });
    if (!resp.ok) return { status: "failed", jobId, error: `Poll HTTP ${resp.status}` };

    const json = await resp.json() as any;
    if (json.error) return { status: "failed", jobId, error: json.error.message ?? "Veo error" };
    if (!json.done) return { status: "processing", jobId };

    const predictions: any[] = json.response?.predictions ?? [];
    for (const pred of predictions) {
      if (typeof pred === "string" && (pred.startsWith("http") || pred.startsWith("gs://"))) {
        return { status: "completed", jobId, videoUrl: pred };
      }
      const uri = pred?.videoUri ?? pred?.gcsUri ?? pred?.uri ?? pred?.url;
      if (typeof uri === "string") return { status: "completed", jobId, videoUrl: uri };
      if (pred?.bytesBase64Encoded) {
        return { status: "completed", jobId, videoUrl: `data:video/mp4;base64,${pred.bytesBase64Encoded}` };
      }
    }

    return { status: "failed", jobId, error: "Operation completed but no video URL found" };
  }

  // ── Cost estimate ──────────────────────────────────────────────────────────

  estimateCost(durationSeconds: number): number {
    return Math.round(durationSeconds * 0.065 * 10000) / 10000;
  }

  // ── List available models ─────────────────────────────────────────────────

  listModels(): { id: string; label: string; defaultDuration: number }[] {
    return [
      { id: "veo-3.0-generate-preview",   label: "Veo 3.0 (Preview)",   defaultDuration: 8 },
      { id: "veo-3.1-generate-preview",   label: "Veo 3.1 (Preview)",   defaultDuration: 8 },
      { id: "veo-2.0-generate-001",       label: "Veo 2.0",             defaultDuration: 8 },
    ];
  }

  // ── Health check ───────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    if (!this.authMode) return false;
    try {
      if (this.authMode === "gemini_api_key") {
        const resp = await fetch(
          `${GEMINI_BASE}/models?key=${encodeURIComponent(this.geminiKey)}&pageSize=1`,
        );
        return resp.ok;
      } else {
        const resp = await fetch(
          `${VERTEX_BASE}/projects/${encodeURIComponent(this.project)}/locations/${this.location}`,
          { headers: { Authorization: `Bearer ${this.accessToken}` } },
        );
        return resp.ok;
      }
    } catch {
      return false;
    }
  }
}

/** Resolve Veo credentials from DB provider_settings row + env vars. */
export function resolveVeoConfig(storedCredentials: Record<string, string> = {}): VeoConfig {
  return {
    geminiApiKey: storedCredentials.geminiApiKey?.trim() || process.env.GEMINI_API_KEY || "",
    gcpProject:   storedCredentials.gcpProject?.trim()   || process.env.GOOGLE_CLOUD_PROJECT || "",
    accessToken:  storedCredentials.accessToken?.trim()   || process.env.GOOGLE_CLOUD_ACCESS_TOKEN || "",
    location:     storedCredentials.location?.trim()      || process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
    model:        storedCredentials.veoModel?.trim()      || process.env.VEO_MODEL || DEFAULT_MODEL,
  };
}
