import type { TelephonyProvider } from "@/lib/telephony/types";
import { createTelephonyProvider } from "@/lib/telephony/provider-factory";

// Wraps the existing FreJun provider via the existing factory — no logic duplication.
export function createFreJunAdapter(apiKey: string): TelephonyProvider {
  return createTelephonyProvider({ id: "", workspace_id: "", provider: "frejun", api_key: apiKey, is_active: true, created_at: "", updated_at: "" });
}
