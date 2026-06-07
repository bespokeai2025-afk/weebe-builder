import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
});

type Status = "loading" | "error" | "timeout";

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;

    async function handleCallback() {
      try {
        const url = new URL(window.location.href);

        // OAuth error from Google (user denied consent, etc.)
        const oauthError = url.searchParams.get("error");
        const errorDesc = url.searchParams.get("error_description");
        if (oauthError) {
          if (!cancelled) {
            setError(
              oauthError === "access_denied"
                ? "Sign-in was cancelled. No changes were made."
                : errorDesc || oauthError,
            );
            setStatus("error");
          }
          return;
        }

        // Check if Supabase SDK already processed the tokens from URL hash
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          if (!cancelled) {
            setError(sessionError.message);
            setStatus("error");
          }
          return;
        }

        if (session) {
          navigate({ to: "/dashboard", replace: true });
          return;
        }

        // Session not immediately available — subscribe and wait
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_IN") {
            subscription.unsubscribe();
            if (!cancelled) {
              navigate({ to: "/dashboard", replace: true });
            }
          }
        });

        // Safety timeout
        setTimeout(() => {
          if (!cancelled) {
            subscription.unsubscribe();
            setStatus("timeout");
            setError("Sign-in is taking longer than expected. Please try again.");
          }
        }, 30000);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "An unexpected error occurred.");
          setStatus("error");
        }
      }
    }

    handleCallback();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background bg-mesh bg-noise px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Completing sign in...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background bg-mesh bg-noise px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm text-center">
        <h2 className="text-lg font-semibold text-destructive">Sign in failed</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {error || "An unexpected error occurred while signing in."}
        </p>
        <div className="mt-6">
          <Link
            to="/login"
            search={{ redirect: "/dashboard" }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to login
          </Link>
        </div>
      </div>
    </main>
  );
}
