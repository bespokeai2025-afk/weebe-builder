export type { TelephonyProvider, OutboundCallParams, InboundCallParams, CallResult, RecordingResult, CallStatusResult } from "./interface";
export { createTelephonyProvider } from "./factory";
export { createTwilioAdapter } from "./adapters/twilio.adapter";
export { createFreJunAdapter } from "./adapters/frejun.adapter";
