# FreJun API — Questions for Automated Setup

## 1. Authentication & API Keys
- [ ] Is there a `GET /me` or `GET /account` endpoint to **validate an API key** is correct and active?
- [ ] Does the API key have different permission **scopes** (read-only vs write)? If so, what scope do we need for full setup?
- [ ] Are there **rate limits** per minute/hour, and what response code/header signals a limit hit?
- [ ] Is there a **sandbox / test mode** we can use during development without incurring call costs?

## 2. Phone Number Management
- [ ] Is there a `GET /phone-numbers` endpoint to **list all numbers** assigned to the account?
- [ ] Can we **search available numbers** by country, area code, or pattern (like Twilio's `/AvailablePhoneNumbers`)?
- [ ] Can we **purchase / provision** a number directly via API, or must that happen in the FreJun dashboard?
- [ ] Can we **release / delete** a number via API?
- [ ] What format are numbers returned in — E.164 (`+15551234567`) or local?

## 3. Inbound Call Webhook Configuration
- [ ] Is there a `PATCH /phone-numbers/{id}` (or similar) to **set the Call Flow URL** (our inbound webhook) on a per-number basis via API?
- [ ] Same question for the **Status Callback URL** — can we set it per-number via API?
- [ ] Or is webhook config **global per account** rather than per number?
- [ ] Can we verify or read back the current webhook URLs configured on a number?
- [ ] Do webhooks require **signature verification** (like Twilio's X-Twilio-Signature)? If so, what algorithm and header?

## 4. Outbound Calls
- [ ] What is the endpoint and payload schema to **initiate an outbound call** via API?
- [ ] Can we specify a **Call Flow URL** for the outbound leg (so our agent handles the call from the start)?
- [ ] Can we specify an **agent SIP address** or stream URL at call-creation time?
- [ ] Can we **hang up / end an active call** via API? What endpoint?

## 5. Audio Streaming (WebSocket)
- [ ] Is **PCM16 at 16 kHz** the only supported audio format, or can we request 8 kHz μ-law (like Twilio) or 24 kHz?
- [ ] Is the `chunk_size: 400` (samples per frame) configurable, or fixed?
- [ ] Are audio frames sent as **raw binary** or base64-encoded JSON?
- [ ] Is there a WebSocket **keep-alive / ping** requirement, and what's the idle timeout?
- [ ] How do we signal **end-of-stream** to FreJun when we want to close the call cleanly?
- [ ] Are there DTMF / metadata events sent over the same WebSocket, or a separate channel?

## 6. Call Status & Events
- [ ] What are all possible `state` values in status callback POSTs? (e.g., `initiated`, `ringing`, `answered`, `completed`, `failed`)
- [ ] Is there a `GET /calls/{call_id}` to **poll call status** on-demand?
- [ ] Is there a `GET /calls` endpoint to **list call history** with filters (date range, number, direction)?
- [ ] Are there **real-time webhooks** for mid-call events (answered, transferred, etc.) or only a final status callback?

## 7. Call Recordings
- [ ] Can we **enable recording** on a call via API (either at call-start or mid-call)?
- [ ] What format are recordings delivered in (MP3, WAV, MP4)?
- [ ] How long are recording files hosted / available via URL?
- [ ] Is the recording URL included in the status callback, or do we need to fetch it separately?

## 8. SIP Trunking (for HyperStream alternative path)
- [ ] What is the **SIP server hostname** and port for inbound trunking?
- [ ] Do we need our **server IPs whitelisted**, or is auth done via SIP credentials?
- [ ] Is **SIP over TLS (SIPS)** and **SRTP** supported?
- [ ] Can SIP registrations be managed via API (add/remove SIP endpoints)?

## 9. Account & Workspace
- [ ] Can we retrieve **account/workspace metadata** (name, plan, credit balance) via API?
- [ ] Does FreJun support **sub-accounts** or multi-workspace? If so, can we switch context per API call?
- [ ] Are there **usage/billing endpoints** to track call minutes consumed?

## 10. Webhooks — Delivery & Reliability
- [ ] Does FreJun **retry** failed webhook deliveries? How many times, and with what backoff?
- [ ] Is there a **webhook delivery log** in the dashboard or via API to debug missed events?
- [ ] What's the expected **response code** our endpoint should return to acknowledge receipt?
- [ ] Is there a **timeout** after which FreJun considers the webhook delivery failed?
