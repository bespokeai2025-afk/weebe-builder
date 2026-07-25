/** Raw row from POST /call-output-data/get-user-history (WeeBespoke snake_case). */
export interface CallHistoryRow {
  call_id: number;
  to_number: string;
  customer_name: string;
  crm_crm_type: string;
  call_status: string;
  recording_url: string | null;
  duration_ms?: number | null;
  duration: string;
  disconnection_reason: string | null;
  transcript: string | null;
  end_reason: string | null;
  call_updatedAt: string;
  event: "call_started" | "call_ended" | "call_analyzed";
  appointment_date: string | null;
  appointment_time: string | null;
  booking_status: string | null;
  calendly_booking_url: string | null;
  call_summary: string | null;
  sentiment_analysis: string | null;
  status: string;
}

/** Per-contact call history item returned by getWbahContactCallHistory (UI shape). */
export type WbahContactCallHistoryItem = {
  id: string;
  name: string | null;
  agentName: string | null;
  callStatus: string | null;
  sentiment: string | null;
  durationSeconds: number | null;
  startedAt: string | null;
  recordingUrl: string | null;
  callSummary: string | null;
  disconnectionReason: string | null;
  endReason: string | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  bookingStatus: string | null;
  calendlyBookingUrl: string | null;
  hasTranscript: boolean;
};
