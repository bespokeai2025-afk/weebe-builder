/**
 * Retell-shaped webhook delivery for the native engine.
 *
 * The engine does not write to `calls`, leads, CRM or bookings itself. It POSTs
 * the same events Retell does to `/api/public/voice-webhook` and lets the
 * existing processor fan them out. That is a deliberate architectural choice:
 * one HTTP hop buys every downstream integration unchanged, including the dedup
 * ledger and the webhook event log, which we would otherwise have to reimplement.
 *
 * Relative imports only (reachable from vite.config.ts).
 */
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import type { VoiceLifecycleEvent, VoiceWebhookPayload } from "./types";

const WEBHOOK_PATH = "/api/public/voice-webhook";
const DELIVERY_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [250, 1_000];

/**
 * The port we are actually listening on.
 *
 * Self-delivery over loopback is preferred to the public hostname: it cannot be
 * broken by proxy, TLS or DNS, and in a sandbox the public name often does not
 * resolve from inside the box at all. The port is only known at runtime, so the
 * gateway hands us the server it mounted on.
 */
let localBaseUrl: string | null = null;

export function registerLocalHttpServer(server: HttpServer): void {
  const read = () => {
    const address = server.address();
    if (address && typeof address === "object") {
      localBaseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
    }
  };
  if (server.listening) read();
  else server.once("listening", read);
}

/** Test seam. */
export function setLocalBaseUrlForTests(url: string | null): void {
  localBaseUrl = url;
}

export function resolveWebhookUrl(): string {
  const explicit = process.env.WEBEE_VOICE_WEBHOOK_URL?.trim();
  if (explicit) return explicit;
  if (localBaseUrl) return `${localBaseUrl}${WEBHOOK_PATH}`;

  const host =
    process.env.PUBLIC_BASE_URL?.trim() ||
    process.env.WEBEE_PUBLIC_URL?.trim() ||
    process.env.PUBLIC_URL?.trim() ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "") ||
    "http://127.0.0.1:5000";
  return `${host.replace(/\/$/, "")}${WEBHOOK_PATH}`;
}

let signingKeyWarned = false;

/**
 * Produce the `x-retell-signature` header the processor expects.
 *
 * Returns null when verification is disabled, which is the default. When it is
 * enabled the processor validates against `RETELL_API_KEY` first, so signing
 * with that key is what makes native events accepted — and a deployment that
 * enables verification without that key would silently 403 every native call,
 * hence the warning.
 */
export function signWebhookBody(rawBody: string, now = Date.now()): string | null {
  if (process.env.RETELL_SIGNATURE_VERIFICATION_ENABLED !== "true") return null;
  const key = process.env.RETELL_API_KEY ?? "";
  if (!key) {
    if (!signingKeyWarned) {
      signingKeyWarned = true;
      console.error(
        "[voice-webhook] signature verification is enabled but RETELL_API_KEY is unset — native voice events will be rejected with 403",
      );
    }
    return null;
  }
  const digest = createHmac("sha256", key).update(`${rawBody}${now}`).digest("hex");
  return `v=${now},d=${digest}`;
}

export interface EmitResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Deliver one lifecycle event.
 *
 * Never throws and never blocks the audio path: callers fire these without
 * awaiting, and a webhook that fails must not drop a live call. Retries cover the
 * window during a deploy where the HTTP listener is briefly unavailable.
 */
export async function emitVoiceEvent(payload: VoiceWebhookPayload): Promise<EmitResult> {
  const url = resolveWebhookUrl();
  const rawBody = JSON.stringify(payload);
  const signature = signWebhookBody(rawBody);

  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "webee-native-voice/1.0",
      };
      if (signature) headers["x-retell-signature"] = signature;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: rawBody,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      if (res.ok) return { ok: true, status: res.status };
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await sleep(delay);
  }

  console.error(
    `[voice-webhook] ${payload.event} for call ${payload.call.call_id} not delivered: ${lastError}`,
  );
  return { ok: false, error: lastError };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Convenience used by the lifecycle: fire-and-forget with the event named in logs. */
export function emitVoiceEventAsync(
  payload: VoiceWebhookPayload,
  logPrefix = "[voice-webhook]",
): void {
  void emitVoiceEvent(payload).then((result) => {
    if (result.ok) {
      console.log(`${logPrefix} ${payload.event} delivered call=${payload.call.call_id}`);
    }
  });
}

export type { VoiceLifecycleEvent };
