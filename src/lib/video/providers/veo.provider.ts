/**
 * Veo Provider — Gemini Developer API + Vertex AI OAuth
 *
 * Auth priority:
 *   1. GEMINI_API_KEY / credentials.geminiApiKey  → generativelanguage.googleapis.com/v1beta
 *      Request body: { instances, parameters } — same schema as Vertex AI
 *      Model default: veo-3.0-generate-preview (Veo 3 is NOW available on Gemini Developer API)
 *      Note: Veo 3+ on Gemini API generates audio by default; generateAudio=false is a no-op.
 *   2. accessToken + gcpProject                   → aiplatform.googleapis.com/v1
 *      Request body: { instances, parameters } (Vertex AI format)
 *      Model default: veo-3.0-generate-preview
 *      generateAudio parameter is fully controllable on Vertex AI path.
 *      If refreshToken + clientId + clientSecret present, auto-refreshes expired tokens.
 */

export type VeoConfig = {
  geminiApiKey?:  string;
  gcpProject?:    string;
  accessToken?:   string;
  refreshToken?:  string;
  clientId?:      string;
  clientSecret?:  string;
  location?:      string;
  model?:         string;
};

export type VeoGenerateParams = {
  prompt:           string;
  aspectRatio?:     "16:9" | "9:16" | "1:1" | "4:5";
  durationSeconds?: number;
  referenceUrl?:    string;
  generateAudio?:   boolean;  // Veo 3+ native AI audio — controllable on Vertex; always-on for Gemini API Veo 3
};

export type VeoJobResult =
  | { status: "pending";    jobId: string }
  | { status: "processing"; jobId: string }
  | { status: "completed";  jobId: string; videoUrl: string }
  | { status: "failed";     jobId: string; error?: string };

const GEMINI_BASE   = "https://generativelanguage.googleapis.com/v1beta";  // :predictLongRunning LRO endpoint
const VERTEX_BASE   = "https://us-central1-aiplatform.googleapis.com/v1";
const TOKEN_URL     = "https://oauth2.googleapis.com/token";
// Veo 3 is now available on the Gemini Developer API and generates native audio by default.
// Veo 2 (veo-2.0-generate-001) has NO audio support — keep as explicit fallback only.
const DEFAULT_MODEL_GEMINI = "veo-3.0-generate-preview";  // Gemini Developer API (API key) — Veo 3 with audio
const DEFAULT_MODEL_VERTEX = "veo-3.0-generate-preview";  // Vertex AI (GCP OAuth)

/** Returns true for Veo 3.x models that support native audio generation. */
export function isAudioCapableModel(model: string): boolean {
  return model.startsWith("veo-3") || model.startsWith("veo-3.");
}

export class VeoProvider {
  private cfg: VeoConfig;
  private _activeToken: string = "";

  constructor(cfg: VeoConfig = {}) {
    this.cfg = { ...cfg };
    this._activeToken = cfg.accessToken?.trim() ?? "";
  }

  private get geminiKey(): string {
    return (this.cfg.geminiApiKey ?? "").trim() || process.env.GEMINI_API_KEY || "";
  }

  private get accessToken(): string {
    return this._activeToken || (this.cfg.accessToken ?? "").trim() || process.env.GOOGLE_CLOUD_ACCESS_TOKEN || "";
  }

  private get project(): string {
    return (this.cfg.gcpProject ?? "").trim() || process.env.GOOGLE_CLOUD_PROJECT || "";
  }

  private get model(): string {
    const cfgModel = (this.cfg.model ?? "").trim() || process.env.VEO_MODEL;
    if (cfgModel) return cfgModel;
    return this.authMode === "gemini_api_key" ? DEFAULT_MODEL_GEMINI : DEFAULT_MODEL_VERTEX;
  }

  private get location(): string {
    return (this.cfg.location ?? "").trim() || process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  }

  /** Returns active auth path or null if no credentials. */
  get authMode(): "gemini_api_key" | "vertex_oauth" | null {
    if (this.geminiKey) return "gemini_api_key";
    if (this.accessToken && this.project) return "vertex_oauth";
    return null;
  }

  // ── OAuth token refresh ───────────────────────────────────────────────────

  private async refreshAccessToken(): Promise<string | null> {
    const refreshToken = (this.cfg.refreshToken ?? "").trim();
    const clientId     = (this.cfg.clientId     ?? "").trim();
    const clientSecret = (this.cfg.clientSecret ?? "").trim();
    if (!refreshToken || !clientId || !clientSecret) return null;

    try {
      const res = await fetch(TOKEN_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    new URLSearchParams({
          grant_type:    "refresh_token",
          refresh_token: refreshToken,
          client_id:     clientId,
          client_secret: clientSecret,
        }),
      });
      if (!res.ok) return null;
      const json = await res.json() as { access_token?: string };
      const newToken = json.access_token ?? null;
      if (newToken) this._activeToken = newToken;
      return newToken;
    } catch {
      return null;
    }
  }

  // ── Generate ───────────────────────────────────────────────────────────────

  async generateVideo(params: VeoGenerateParams): Promise<VeoJobResult> {
    if (!this.authMode) {
      throw new Error(
        "Veo credentials not configured. Add a Gemini API Key under " +
        "Settings → Providers → Video → Google Veo 3.",
      );
    }

    const doRequest = async (token: string): Promise<Response> => {
      const instance: Record<string, unknown> = { prompt: params.prompt };
      if (params.referenceUrl) instance.image = { gcsUri: params.referenceUrl };

      if (this.authMode === "gemini_api_key") {
        // Gemini Developer API: :predictLongRunning is the documented LRO endpoint for Veo.
        // Veo 3+ on Gemini API generates audio by default; generateAudio=true is a no-op,
        // generateAudio=false is ignored (audio cannot be disabled on Gemini Developer API).
        const endpoint = `${GEMINI_BASE}/models/${this.model}:predictLongRunning?key=${encodeURIComponent(this.geminiKey)}`;
        const audioCapable = isAudioCapableModel(this.model);
        const body = {
          instances: [instance],
          parameters: {
            aspectRatio:     params.aspectRatio     ?? "16:9",
            durationSeconds: params.durationSeconds ?? 8,
            sampleCount:     1,
            ...(audioCapable ? { generateAudio: params.generateAudio ?? true } : {}),
          },
        };
        console.log("[veo-provider] Gemini API POST", endpoint.replace(/key=[^&]+/, "key=***"), `model=${this.model} audioCapable=${audioCapable}`);
        console.log("[veo-provider] body:", JSON.stringify(body).slice(0, 400));
        return fetch(endpoint, {
          method:  "POST",
          headers: {
            "Content-Type":   "application/json",
            "x-goog-api-key": this.geminiKey,
          },
          body: JSON.stringify(body),
        });
      } else {
        const endpoint =
          `${VERTEX_BASE}/projects/${encodeURIComponent(this.project)}` +
          `/locations/${this.location}/publishers/google/models/${this.model}:predictLongRunning`;
        const body = {
          instances: [instance],
          parameters: {
            aspectRatio:     params.aspectRatio     ?? "16:9",
            durationSeconds: params.durationSeconds ?? 8,
            sampleCount:     1,
            generateAudio:   params.generateAudio ?? true,  // Fully controllable on Vertex AI
          },
        };
        console.log("[veo-provider] Vertex AI request →", endpoint, JSON.stringify(body).slice(0, 300));
        return fetch(endpoint, {
          method:  "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body:    JSON.stringify(body),
        });
      }
    };

    let resp = await doRequest(this.accessToken);
    console.log("[veo-provider] response status:", resp.status, resp.statusText, "content-type:", resp.headers.get("content-type"));

    // Auto-refresh token on 401 (Vertex OAuth path only)
    if (resp.status === 401 && this.authMode === "vertex_oauth") {
      const newToken = await this.refreshAccessToken();
      if (newToken) resp = await doRequest(newToken);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      const isHtml = text.trimStart().startsWith("<!") || text.trimStart().startsWith("<html");
      const snippet = isHtml ? `[HTML error page, status ${resp.status}]` : text.slice(0, 400);
      console.error("[veo-provider] error response:", snippet);
      throw new Error(`Veo submit error ${resp.status}: ${snippet}`);
    }

    const data = await resp.json() as { name?: string };
    const operationName = data.name ?? "";
    if (!operationName) throw new Error("Veo did not return an operation name.");

    return { status: "pending", jobId: operationName };
  }

  // ── Poll status ────────────────────────────────────────────────────────────

  async getStatus(jobId: string): Promise<VeoJobResult> {
    if (!this.authMode) throw new Error("Veo credentials not configured.");

    const doRequest = async (token: string): Promise<Response> => {
      if (this.authMode === "gemini_api_key") {
        const endpoint = `${GEMINI_BASE}/${jobId}?key=${encodeURIComponent(this.geminiKey)}`;
        return fetch(endpoint, { headers: { "Content-Type": "application/json" } });
      } else {
        const endpoint = `${VERTEX_BASE}/${jobId}`;
        return fetch(endpoint, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
      }
    };

    let resp = await doRequest(this.accessToken);

    if (resp.status === 401 && this.authMode === "vertex_oauth") {
      const newToken = await this.refreshAccessToken();
      if (newToken) resp = await doRequest(newToken);
    }

    if (!resp.ok) return { status: "failed", jobId, error: `Poll HTTP ${resp.status}` };

    const json = await resp.json() as any;
    if (json.error) return { status: "failed", jobId, error: json.error.message ?? "Veo error" };
    if (!json.done) return { status: "processing", jobId };

    // ── Gemini API response: { response: { generateVideoResponse: { generatedSamples: [...] } } }
    const geminiSamples: any[] = json.response?.generateVideoResponse?.generatedSamples ?? [];
    for (const sample of geminiSamples) {
      const uri = sample?.video?.uri ?? sample?.video?.gcsUri ?? sample?.videoUri;
      if (typeof uri === "string" && uri) return { status: "completed", jobId, videoUrl: uri };
      if (sample?.video?.bytesBase64Encoded) {
        return { status: "completed", jobId, videoUrl: `data:video/mp4;base64,${sample.video.bytesBase64Encoded}` };
      }
    }

    // ── Vertex AI response: { response: { predictions: [...] } }
    const predictions: any[] = json.response?.predictions ?? [];
    for (const pred of predictions) {
      if (typeof pred === "string" && (pred.startsWith("http") || pred.startsWith("gs://"))) {
        return { status: "completed", jobId, videoUrl: pred };
      }
      const uri = pred?.videoUri ?? pred?.gcsUri ?? pred?.uri ?? pred?.url;
      if (typeof uri === "string" && uri) return { status: "completed", jobId, videoUrl: uri };
      if (pred?.bytesBase64Encoded) {
        return { status: "completed", jobId, videoUrl: `data:video/mp4;base64,${pred.bytesBase64Encoded}` };
      }
    }

    return { status: "failed", jobId, error: "Operation completed but no video URL found in response" };
  }

  // ── Cost estimate ──────────────────────────────────────────────────────────

  estimateCost(durationSeconds: number): number {
    return Math.round(durationSeconds * 0.065 * 10000) / 10000;
  }

  // ── List available models ─────────────────────────────────────────────────

  listModels(): { id: string; label: string; defaultDuration: number; supportsAudio: boolean; requiresVertex?: boolean }[] {
    return [
      { id: "veo-3.0-generate-preview",       label: "Veo 3.0 (Gemini API or Vertex)",       defaultDuration: 8,  supportsAudio: true  },
      { id: "veo-3.1-generate-preview",       label: "Veo 3.1 Preview (Gemini API or Vertex)", defaultDuration: 8,  supportsAudio: true  },
      { id: "veo-3.1-fast-generate-preview",  label: "Veo 3.1 Fast (Gemini API or Vertex)",   defaultDuration: 8,  supportsAudio: true  },
      { id: "veo-2.0-generate-001",           label: "Veo 2.0 (no audio — legacy fallback)",  defaultDuration: 8,  supportsAudio: false },
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
    geminiApiKey:  storedCredentials.geminiApiKey?.trim()  || process.env.GEMINI_API_KEY              || "",
    gcpProject:    storedCredentials.gcpProject?.trim()    || process.env.GOOGLE_CLOUD_PROJECT         || "",
    accessToken:   storedCredentials.accessToken?.trim()   || process.env.GOOGLE_CLOUD_ACCESS_TOKEN    || "",
    refreshToken:  storedCredentials.refreshToken?.trim()  || process.env.GOOGLE_OAUTH_REFRESH_TOKEN   || "",
    clientId:      storedCredentials.clientId?.trim()      || process.env.GOOGLE_OAUTH_CLIENT_ID       || "",
    clientSecret:  storedCredentials.clientSecret?.trim()  || process.env.GOOGLE_OAUTH_CLIENT_SECRET   || "",
    location:      storedCredentials.location?.trim()      || process.env.GOOGLE_CLOUD_LOCATION        || "us-central1",
    model:         storedCredentials.veoModel?.trim()      || process.env.VEO_MODEL                    || "",
  };
}
