import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/auth/auth.functions";

export const Route = createFileRoute("/pending-approval")({
  component: PendingPage,
});

function PendingPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string>("");
  const [status, setStatus] = useState<"pending" | "approved" | "denied">("pending");

  const refresh = async () => {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      navigate({ to: "/login" });
      return;
    }
    try {
      const p = await getMyProfile();
      setEmail(p?.email ?? "");
      if (p?.approved) {
        navigate({ to: "/builder" });
      } else if (p?.denied) {
        setStatus("denied");
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background bg-mesh bg-noise px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
        {status === "denied" ? (
          <>
            <h1 className="text-xl font-semibold text-destructive">Access denied</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your account ({email}) was denied access.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Pending approval</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Thanks for signing up{email ? ` as ${email}` : ""}. An admin has been
              notified. You'll be able to sign in once your account is approved.
            </p>
          </>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" onClick={refresh}>Check again</Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/login" });
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
