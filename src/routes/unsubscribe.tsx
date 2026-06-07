import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Status = "checking" | "valid" | "already" | "invalid" | "submitting" | "done" | "error";

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { token } = useSearch({ from: "/unsubscribe" });
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      setError("Missing unsubscribe token.");
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) {
          setStatus("invalid");
          setError(data?.error || "Invalid or expired link.");
          return;
        }
        if (data.valid === false && data.reason === "already_unsubscribed") {
          setStatus("already");
          return;
        }
        setStatus("valid");
      } catch {
        setStatus("error");
        setError("Could not reach the server. Please try again.");
      }
    })();
  }, [token]);

  const confirm = async () => {
    setStatus("submitting");
    try {
      const res = await fetch("/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(data?.error || "Failed to unsubscribe.");
        return;
      }
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Could not reach the server. Please try again.");
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">Unsubscribe</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your email preferences for Webespoke AI Builder.
        </p>

        <div className="mt-6 space-y-4">
          {status === "checking" && (
            <p className="text-sm text-muted-foreground">Validating your link…</p>
          )}
          {status === "valid" && (
            <>
              <p className="text-sm">Click below to stop receiving non-essential emails from us.</p>
              <Button onClick={confirm} className="w-full">
                Confirm unsubscribe
              </Button>
            </>
          )}
          {status === "submitting" && <p className="text-sm text-muted-foreground">Processing…</p>}
          {status === "done" && (
            <p className="text-sm">You've been unsubscribed. Sorry to see you go.</p>
          )}
          {status === "already" && <p className="text-sm">This email is already unsubscribed.</p>}
          {status === "invalid" && <p className="text-sm text-destructive">{error}</p>}
          {status === "error" && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </div>
    </main>
  );
}
