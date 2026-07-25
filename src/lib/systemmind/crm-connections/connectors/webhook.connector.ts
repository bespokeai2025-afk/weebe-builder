// ── Webhook-based "CRM" connector (Task #457) ─────────────────────────────────
// Outbound fire-and-forget delivery to a customer endpoint. Read access and
// schema discovery do not apply — the test is truthful about that.
import { createHmac } from "node:crypto";
import {
  type CrmConnector, type CrmTestReport, type CrmDiscoverySnapshot, type CrmTestStep,
  step, report, errMsg,
} from "../contract";

export function buildWebhookConnector(creds: Record<string, string>): CrmConnector {
  const webhookUrl = (creds.webhookUrl ?? creds.webhook_url ?? creds.url ?? "").trim();
  const secret = (creds.signingSecret ?? creds.signing_secret ?? creds.secret ?? "").trim();
  const signatureHeader = (creds.signatureHeader ?? creds.signature_header ?? "X-Webee-Signature").trim();

  return {
    provider: "webhook",

    async testConnection(): Promise<CrmTestReport> {
      const steps: CrmTestStep[] = [];
      if (!webhookUrl || !/^https?:\/\//i.test(webhookUrl)) {
        steps.push(step("auth", "Endpoint reachable", false, "A valid http(s) Webhook URL is required."));
        return report(steps);
      }

      try {
        const payload = JSON.stringify({
          event: "webee.connection_test",
          test: true,
          sentAt: new Date().toISOString(),
        });
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (secret) {
          headers[signatureHeader] = createHmac("sha256", secret).update(payload).digest("hex");
        }
        const res = await fetch(webhookUrl, { method: "POST", headers, body: payload });
        if (res.ok) {
          steps.push(step("auth", "Endpoint reachable", true,
            `Test event delivered — endpoint responded HTTP ${res.status}.`));
          steps.push(step("write", "Delivery (write)", true,
            `Write confirmed — endpoint accepted a signed test event${secret ? ` (HMAC-SHA256 in ${signatureHeader})` : " (no signing secret configured)"}.`));
        } else {
          const body = (await res.text().catch(() => "")).slice(0, 200);
          steps.push(step("auth", "Endpoint reachable", false, `Endpoint responded HTTP ${res.status}${body ? `: ${body}` : ""}.`));
        }
      } catch (e) {
        steps.push(step("auth", "Endpoint reachable", false, errMsg(e)));
      }

      steps.push(step("read", "Read access", false,
        "Not applicable — webhooks are outbound-only; this connection cannot read CRM data.", true));

      return report(steps);
    },

    async discover(): Promise<CrmDiscoverySnapshot> {
      return {
        provider: "webhook",
        objects: [],
        pipelines: [],
        owners: [],
        discoveredAt: new Date().toISOString(),
        warnings: ["Webhook connections are outbound-only — there is no schema to discover. Field mapping uses the WEBEE universal payload."],
      };
    },
  };
}
