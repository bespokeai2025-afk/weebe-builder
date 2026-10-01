import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const data = new FormData(e.currentTarget as HTMLFormElement);
    const email = ((data.get("email") as string) ?? "").trim().toLowerCase();

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    // Always show the same success state, whether or not an account exists for
    // this email — confirming/denying that here would let anyone enumerate
    // registered accounts just by trying emails against this form.
    if (error) {
      console.error("[forgot-password] resetPasswordForEmail failed:", error.message);
    }
    setSent(true);
    setLoading(false);
  };

  return (
    <main className="platform-nebula-surface min-h-screen flex items-center justify-center bg-transparent bg-noise px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        <Logo className="mx-auto h-10 mb-4" />
        <h1 className="text-xl font-semibold">Reset your password</h1>

        {sent ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              If an account exists for that email, we've sent a link to reset your password.
              Check your inbox (and spam folder) — the link expires after a while, so use it soon.
            </p>
            <div className="mt-5">
              <Link to="/login" search={{ redirect: "/dashboard" }}>
                <Button type="button" variant="outline" className="w-full">
                  Back to sign in
                </Button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the email on your account and we'll send you a link to reset your password.
            </p>
            <form onSubmit={handleSubmit} className="mt-5 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Sending…" : "Send reset link"}
              </Button>
            </form>
            <div className="mt-4 text-center text-xs text-muted-foreground">
              <Link to="/login" search={{ redirect: "/dashboard" }} className="hover:text-foreground">
                ← Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
