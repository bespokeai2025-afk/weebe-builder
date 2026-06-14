import type { TelephonyProvider } from "@/lib/telephony/types";
import { createTelephonyProvider } from "@/lib/telephony/provider-factory";

// Wraps the existing Twilio provider via the existing factory — no logic duplication.
export function createTwilioAdapter(accountSid: string, authToken: string): TelephonyProvider {
  return createTelephonyProvider({ id: "", workspace_id: "", provider: "twilio", account_sid: accountSid, auth_token: authToken, is_active: true, created_at: "", updated_at: "" });
}
