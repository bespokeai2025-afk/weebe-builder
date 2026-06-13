import twilio from "twilio";
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

export class TwilioProvider implements TelephonyProvider {
  readonly name: TelephonyProviderName = "twilio";
  private client: ReturnType<typeof twilio>;

  constructor(private config: { accountSid: string; authToken: string }) {
    this.client = twilio(config.accountSid, config.authToken);
  }

  async makeCall(params: OutboundCallParams): Promise<CallResult> {
    const twiml = this.buildStreamTwiml(params.streamUrl);
    const call = await this.client.calls.create({
      to: params.to,
      from: params.from,
      twiml,
      statusCallback: params.statusCallbackUrl,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
    });
    return { callSid: call.sid, status: this.mapStatus(call.status) };
  }

  async hangupCall(callSid: string): Promise<void> {
    await this.client.calls(callSid).update({ status: "completed" });
  }

  async startRecording(callSid: string): Promise<RecordingResult> {
    const rec = await this.client.calls(callSid).recordings.create({});
    return { recordingSid: rec.sid, status: rec.status };
  }

  async stopRecording(callSid: string, recordingSid: string): Promise<void> {
    await (this.client.calls(callSid).recordings(recordingSid) as any).update({
      status: "stopped",
    });
  }

  async getCallStatus(callSid: string): Promise<CallStatusResult> {
    const call = await this.client.calls(callSid).fetch();
    return {
      callSid: call.sid,
      status: this.mapStatus(call.status),
      duration: call.duration ? parseInt(call.duration) : undefined,
      price: call.price ?? undefined,
    };
  }

  generateInboundTwiml(params: InboundCallParams): string {
    return this.buildStreamTwiml(params.streamUrl);
  }

  private buildStreamTwiml(streamUrl: string): string {
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<Response>\n` +
      `  <Connect>\n` +
      `    <Stream url="${streamUrl}" />\n` +
      `  </Connect>\n` +
      `</Response>`
    );
  }

  private mapStatus(twilioStatus: string): CallState {
    const map: Record<string, CallState> = {
      queued: "initiated",
      initiated: "initiated",
      ringing: "ringing",
      "in-progress": "active",
      completed: "completed",
      busy: "failed",
      "no-answer": "failed",
      canceled: "failed",
      failed: "failed",
    };
    return map[twilioStatus] ?? "failed";
  }
}
