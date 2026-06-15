import { createFileRoute } from "@tanstack/react-router";

function healthJson(provider: string, configured: boolean, extra?: object) {
  return new Response(
    JSON.stringify({
      status: "ok",
      provider,
      environment: process.env.NODE_ENV ?? "development",
      timestamp: new Date().toISOString(),
      expectedMethod: "POST",
      configured,
      ...extra,
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/public/payments/webhook/health")({
  server: {
    handlers: {
      GET: async () =>
        healthJson(
          "stripe",
          !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
          {
            description: "Stripe payment events webhook — update endpoint URL in Stripe Dashboard → Developers → Webhooks",
            warning: "Never auto-update Stripe webhooks. Use Stripe Dashboard only.",
          },
        ),
    },
  },
});
