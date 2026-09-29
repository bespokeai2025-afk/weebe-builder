/**
 * Warm transfer — TwiML for the destination leg.
 *
 * Twilio requests this once the human being transferred to answers. It speaks
 * the private "whisper" briefing (only the destination hears it — the caller
 * is still parked, muted, in the conference) then joins the same conference
 * with `startConferenceOnEnter="true"`, which is what actually starts it and
 * bridges the two legs together.
 */
import { createFileRoute } from "@tanstack/react-router";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function twimlResponse(xml: string) {
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

export const Route = createFileRoute("/api/public/telephony/warm-transfer-brief/$callId")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const conference = url.searchParams.get("conference")?.trim();
        const say = url.searchParams.get("say")?.trim();

        if (!conference) {
          return twimlResponse(
            `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this transfer could not be completed.</Say><Hangup/></Response>`,
          );
        }

        const brief = say ? `<Say>${escapeXml(say)}</Say>` : "";
        const twiml =
          `<?xml version="1.0" encoding="UTF-8"?><Response>${brief}` +
          `<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true">` +
          `${escapeXml(conference)}</Conference></Dial></Response>`;

        return twimlResponse(twiml);
      },

      GET: async () => new Response("Warm transfer briefing webhook — POST only", { status: 405 }),
    },
  },
});
