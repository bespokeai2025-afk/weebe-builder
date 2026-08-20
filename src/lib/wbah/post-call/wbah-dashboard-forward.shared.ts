/**
 * Split forwarding to bespoke_ai_backend:
 *  1. Post-call result POST (contains `raw_data` — no callback fields)
 *  2. Callback request POST (no `raw_data` — separate contract)
 */
import { cleanWbahRawData, formatWbahRetellCallData } from "./wbah-format-data.shared";
import {
  buildWbahCallbackRequestBody,
  shouldPostWbahCallbackRequest,
} from "./wbah-callback-post.shared";
import {
  postWbahCallOutputCreate,
  postWbahCallbackRequest,
  type WbahCallOutputCreateBody,
} from "./wbah-webespoke-writer.server";

type RetellCallLike = {
  call_id?: string;
  agent_id?: string;
  call_status?: string;
  call_analysis?: { call_summary?: string; user_sentiment?: string };
};

export async function forwardWbahDashboardAnalyzed(input: {
  leadId: string;
  call: RetellCallLike;
  payload: Record<string, unknown>;
  formatted: ReturnType<typeof formatWbahRetellCallData>;
  calendlyBookingUrl: string | null;
  postCallExtras?: Omit<
    Partial<WbahCallOutputCreateBody>,
    | "leadId"
    | "event"
    | "raw_data"
    | "callback_datetime"
    | "callback_datetime_raw"
    | "callback_type"
    | "is_callback_request"
  >;
}): Promise<void> {
  const { formatted, call, payload, calendlyBookingUrl, postCallExtras } = input;
  const leadId = input.leadId.trim();
  if (!leadId) return;

  await postWbahCallOutputCreate({
    leadId,
    event: "call_analyzed",
    raw_data: cleanWbahRawData(payload),
    retell_call_id: call.call_id ?? null,
    customer_name: formatted.customerName,
    email: formatted.email,
    appointment_date: formatted.appointmentDate,
    appointment_time: formatted.requestedStartUtc ?? formatted.appointmentTimeUk,
    booking_status: postCallExtras?.booking_status ?? "success",
    calendly_booking_url: calendlyBookingUrl ?? "",
    call_summary: formatted.callSummary ?? call.call_analysis?.call_summary ?? null,
    sentiment_analysis: formatted.userSentiment ?? call.call_analysis?.user_sentiment ?? null,
    call_successful: formatted.callSuccessful,
    ...postCallExtras,
  });

  const callbackBody = buildWbahCallbackRequestBody({ leadId, call, formatted });
  if (shouldPostWbahCallbackRequest(callbackBody)) {
    await postWbahCallbackRequest(callbackBody);
  }
}