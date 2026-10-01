import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

type Status = "checking" | "ready" | "invalid";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [submitting, setSubmitting] = useState(false);

  // Supabase parses the recovery token out of the URL on load and fires
  // PASSWORD_RECOVERY once it's established a session from it — that event,
  // not just "a session exists", is what proves this page was reached via a
  // real reset link rather than e.g. an already-logged-in user wandering here.
  useEffect(() => {
    let cancelled = false;

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && !cancelled) {
        setStatus("ready");
      }
    });

    const timeout = setTimeout(() => {
      if (!cancelled) {
        setStatus((s) => (s === "checking" ? "invalid" : s));
      }
    }, 10000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget as HTMLFormElement);
    const password = (data.get("password") as string) ?? "";
    const confirm = (data.get("confirm") as string) ?? "";

    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast.error(error.message);
      setSubmitting(false);
      return;
    }

    // Sign out the recovery session deliberately — the user proves they know
    // the new password by signing in with it fresh, rather than this link
    // alone dropping them straight into an authenticated session.
    await supabase.auth.signOut({ scope: "local" });
    toast.success("Password updated. Please sign in with your new password.");
    navigate({ to: "/login", search: { redirect: "/dashboard" } });
  };

  return (
    <main className="platform-nebula-surface min-h-screen flex items-center justify-center bg-transparent bg-noise px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        <Logo className="mx-auto h-10 mb-4" />

        {status === "checking" && (
          <div className="py-4 text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Verifying your reset link…</p>
          </div>
        )}

        {status === "invalid" && (
          <>
            <h1 className="text-xl font-semibold text-destructive">Link invalid or expired</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This password reset link is no longer valid. Request a new one to continue.
            </p>
            <div className="mt-5">
              <Link to="/forgot-password">
                <Button type="button" className="w-full">
                  Request a new link
                </Button>
              </Link>
            </div>
          </>
        )}

        {status === "ready" && (
          <>
            <h1 className="text-xl font-semibold">Set a new password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a new password for your account.
            </p>
            <form onSubmit={handleSubmit} className="mt-5 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password (min 8 chars)</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Updating…" : "Update password"}
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
