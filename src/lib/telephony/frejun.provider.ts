import type {
  TelephonyProvider,
  TelephonyProviderName,
  OutboundCallParams,
  InboundCallParams,
  CallResult,
  RecordingResult,
  CallStatusResult,
  CallState,
} from "./types";

const FREJUN_API_BASE = "https://api.frejun.ai";

export class FreJunProvider implements TelephonyProvider {
  readonly name: TelephonyProviderName = "frejun";

  constructor(private config: { apiKey: string }) {}

  private async apiFetch(path: string, options?: RequestInit) {
    const res = await fetch(`${FREJUN_API_BASE}${path}`, {
      ...options,
      headers: {
        "x-api-key": this.config.apiKey,
        "Content-Type": "application/json",
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`FreJun API ${path} returned ${res.status}: ${body}`);
    }
    return res.json();
  }

  async makeCall(params: OutboundCallParams): Promise<CallResult> {
    const host = new URL(params.statusCallbackUrl).host;
    const callId = params.callId ?? "unknown";
    const flowUrl = `https://${host}/api/public/frejun/flow?callId=${callId}`;

    await this.apiFetch("/api/v1/voice/calls/initiate", {
      method: "POST",
      body: JSON.stringify({
        from_number: params.from,
        to_number: params.to,
        flow_url: flowUrl,
        status_callback_url: params.statusCallbackUrl,
        record: true,
      }),
    });

    return {
      callSid: callId,
      status: "initiated",
    };
  }

  async hangupCall(callSid: string): Promise<void> {
    console.warn(
      `[FreJunProvider] hangupCall(${callSid}): FreJun Teler has no documented mid-call hangup REST API. Call will complete naturally.`,
    );
  }

  async startRecording(_callSid: string): Promise<RecordingResult> {
    return { recordingSid: "frejun-record-on-initiate", status: "recording" };
  }

  async stopRecording(_callSid: string, _recordingSid: string): Promise<void> {
    console.warn("[FreJunProvider] stopRecording: FreJun recordings stop automatically when the call ends.");
  }

  async getCallStatus(callSid: string): Promise<CallStatusResult> {
    try {
      const data = await this.apiFetch(`/api/v1/voice/calls/${callSid}`);
      return {
        callSid,
        status: this.mapStatus(data.state ?? ""),
        duration: data.duration_seconds ?? undefined,
      };
    } catch {
      return { callSid, status: "failed" };
    }
  }

  async getRecordingSignedUrl(callId: string): Promise<string | null> {
    try {
      const data = await this.apiFetch(`/api/v1/recordings/?call_id=${callId}`);
      return (data.signed_url as string) ?? null;
    } catch {
      return null;
    }
  }

  generateInboundTwiml(_params: InboundCallParams): string {
    return JSON.stringify({ action: "hangup" });
  }

  buildCallFlow(streamUrl: string): string {
    return JSON.stringify({
      action: "stream",
      ws_url: streamUrl,
      chunk_size: 400,
      sample_rate: "16k",
    });
  }

  private mapStatus(state: string): CallState {
    const map: Record<string, CallState> = {
      initiated: "initiated",
      ringing: "ringing",
      answered: "active",
      completed: "completed",
      failed: "failed",
    };
    return map[state] ?? "failed";
  }
}
