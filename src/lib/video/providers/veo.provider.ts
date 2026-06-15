/**
 * Veo Provider — Gemini Developer API + Vertex AI OAuth
 *
 * Auth priority:
 *   1. GEMINI_API_KEY / credentials.geminiApiKey  → generativelanguage.googleapis.com/v1alpha
 *      Request body: { instances, parameters } — same schema as Vertex AI
 *      Model default: veo-2.0-generate-001 (Veo 3 not available on Gemini Developer API)
 *   2. accessToken + gcpProject                   → aiplatform.googleapis.com/v1
 *      Request body: { instances, parameters } (Vertex AI format)
 *      Model default: veo-3.0-generate-preview
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
};

export type VeoJobResult =
  | { status: "pending";    jobId: string }
  | { status: "processing"; jobId: string }
  | { status: "completed";  jobId: string; videoUrl: string }
  | { status: "failed";     jobId: string; error?: string };

const GEMINI_BASE   = "https://generativelanguage.googleapis.com/v1alpha"; // Veo requires v1alpha, not v1beta
const VERTEX_BASE   = "https://us-central1-aiplatform.googleapis.com/v1";
const TOKEN_URL     = "https://oauth2.googleapis.com/token";
const DEFAULT_MODEL_GEMINI = "veo-2.0-generate-001";       // Gemini Developer API (API key)
const DEFAULT_MODEL_VERTEX = "veo-3.0-generate-preview";  // Vertex AI (GCP OAuth)

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
    // Gemini Developer API only supports up to veo-2; Vertex AI supports veo-3 preview
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
      // Both Gemini API and Vertex AI use the same instances/parameters schema.
      // Key difference: Gemini API requires durationSeconds as a STRING ("8"),
      // Vertex AI accepts it as an integer. Auth differs (API key vs Bearer token).
      const instance: Record<string, unknown> = { prompt: params.prompt };
      if (params.referenceUrl) instance.image = { gcsUri: params.referenceUrl };

      if (this.authMode === "gemini_api_key") {
        // Gemini Developer API uses :generateVideo (NOT :predictLongRunning — that is Vertex AI only)
        const endpoint = `${GEMINI_BASE}/models/${this.model}:generateVideo?key=${encodeURIComponent(this.geminiKey)}`;
        const body = {
          instances: [instance],
          parameters: {
            aspectRatio:     params.aspectRatio     ?? "16:9",
            durationSeconds: String(params.durationSeconds ?? 8),  // must be string on Gemini API
            sampleCount:     1,
          },
        };
        console.log("[veo-provider] Gemini API POST", endpoint.replace(/key=[^&]+/, "key=***"));
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
            durationSeconds: params.durationSeconds ?? 8,  // integer on Vertex AI
            sampleCount:     1,
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

  listModels(): { id: string; label: string; defaultDuration: number; requiresVertex?: boolean }[] {
    return [
      { id: "veo-2.0-generate-001",     label: "Veo 2.0 (Gemini API key)",        defaultDuration: 8 },
      { id: "veo-3.0-generate-preview", label: "Veo 3.0 Preview (Vertex AI only)", defaultDuration: 8, requiresVertex: true },
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
