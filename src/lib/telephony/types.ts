export type TelephonyProviderName = "twilio" | "telnyx" | "plivo" | "vonage";

export type CallDirection = "inbound" | "outbound";

export type CallState =
  | "initiated"
  | "ringing"
  | "answered"
  | "active"
  | "transferred"
  | "voicemail"
  | "completed"
  | "failed";

export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "cancelled";

// ── Provider interface ─────────────────────────────────────────────────────────

export interface OutboundCallParams {
  to: string;
  from: string;
  statusCallbackUrl: string;
  streamUrl: string;
  agentId?: string;
  callId?: string;
}

export interface InboundCallParams {
  callSid: string;
  from: string;
  to: string;
  streamUrl: string;
}

export interface CallResult {
  callSid: string;
  status: CallState;
}

export interface RecordingResult {
  recordingSid: string;
  status: string;
}

export interface CallStatusResult {
  callSid: string;
  status: CallState;
  duration?: number;
  price?: string;
}

export interface TelephonyProvider {
  readonly name: TelephonyProviderName;
  makeCall(params: OutboundCallParams): Promise<CallResult>;
  hangupCall(callSid: string): Promise<void>;
  startRecording(callSid: string): Promise<RecordingResult>;
  stopRecording(callSid: string, recordingSid: string): Promise<void>;
  getCallStatus(callSid: string): Promise<CallStatusResult>;
  generateInboundTwiml(params: InboundCallParams): string;
}

// ── Database row shapes ────────────────────────────────────────────────────────

export interface TelephonyConfig {
  id: string;
  workspace_id: string;
  provider: TelephonyProviderName;
  account_sid?: string | null;
  auth_token?: string | null;
  api_key?: string | null;
  api_secret?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PhoneNumber {
  id: string;
  workspace_id: string;
  telephony_config_id?: string | null;
  phone_number: string;
  friendly_name?: string | null;
  provider: TelephonyProviderName;
  provider_sid?: string | null;
  agent_id?: string | null;
  capabilities: { voice: boolean; sms: boolean };
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TelephonyCall {
  id: string;
  workspace_id: string;
  phone_number_id?: string | null;
  agent_id?: string | null;
  campaign_id?: string | null;
  call_sid?: string | null;
  direction: CallDirection;
  from_number?: string | null;
  to_number?: string | null;
  status: CallState;
  started_at: string;
  answered_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  recording_url?: string | null;
  recording_sid?: string | null;
  recording_status?: string | null;
  transcript?: TranscriptEntry[] | null;
  outcome?: string | null;
  cost_cents?: number | null;
  provider: TelephonyProviderName;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TranscriptEntry {
  role: "agent" | "user";
  text: string;
  ts?: number;
}

export interface Campaign {
  id: string;
  workspace_id: string;
  agent_id?: string | null;
  phone_number_id?: string | null;
  name: string;
  description?: string | null;
  status: CampaignStatus;
  targets: CampaignTarget[];
  schedule_config?: Record<string, unknown>;
  retry_config: { max_attempts: number; retry_delay_minutes: number };
  stats: CampaignStats;
  created_at: string;
  updated_at: string;
}

export interface CampaignTarget {
  phone: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface CampaignStats {
  total: number;
  called: number;
  answered: number;
  booked: number;
  failed: number;
}

export interface CallEvent {
  id: string;
  call_id: string;
  workspace_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  occurred_at: string;
}
