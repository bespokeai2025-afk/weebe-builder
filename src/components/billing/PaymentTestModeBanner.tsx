const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

export function PaymentTestModeBanner() {
  if (!clientToken) {
    return (
      <div className="w-full rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
        Production checkout is not configured. Complete go-live in your Lovable project to accept
        real payments.
      </div>
    );
  }
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200">
        Test mode — all payments in preview are simulated. Use card 4242 4242 4242 4242.
      </div>
    );
  }
  return null;
}
