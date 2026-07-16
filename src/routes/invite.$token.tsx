import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";
import { getInviteByToken, acceptInvite } from "@/lib/workspace/invites.functions";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [{ title: "Workspace Invitation — Webee" }],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const getFn = useServerFn(getInviteByToken);
  const acceptFn = useServerFn(acceptInvite);
  const [accepting, setAccepting] = useState(false);

  const inviteQ = useQuery({
    queryKey: ["invite", token],
    queryFn: () => getFn({ data: { token } }),
    throwOnError: false,
  });

  const sessionQ = useQuery({
    queryKey: ["invite-session"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return { signedIn: !!data.session, email: data.session?.user?.email ?? null };
    },
    throwOnError: false,
  });

  const onAccept = async () => {
    setAccepting(true);
    try {
      const res = await acceptFn({ data: { token } });
      toast.success("Welcome to the workspace!");
      // Switch active workspace then land on the dashboard.
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user?.id;
      if (userId && res.workspaceId) {
        await supabase
          .from("profiles")
          .update({ default_workspace_id: res.workspaceId } as any)
          .eq("user_id", userId);
      }
      navigate({ to: "/dashboard" });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not accept the invite");
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Logo className="mb-2 h-8" />
          <CardTitle>Workspace invitation</CardTitle>
          <CardDescription>
            {inviteQ.isLoading
              ? "Checking your invitation…"
              : inviteQ.data?.valid
                ? `You've been invited to join ${inviteQ.data.workspaceName} as ${String(inviteQ.data.roleKey).replace(/_/g, " ")}.`
                : "This invitation is invalid or has expired."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {inviteQ.data?.valid && sessionQ.data?.signedIn && (
            <Button className="w-full" disabled={accepting} onClick={onAccept}>
              {accepting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" />
              )}
              Accept invitation
            </Button>
          )}
          {inviteQ.data?.valid && sessionQ.data && !sessionQ.data.signedIn && (
            <>
              <p className="text-center text-sm text-muted-foreground">
                Sign in (or create an account) with <strong>{inviteQ.data.email}</strong> first,
                then return to this link.
              </p>
              <Button
                className="w-full"
                onClick={() => { window.location.href = "/login"; }}
              >
                Go to sign in
              </Button>
            </>
          )}
          {!inviteQ.isLoading && !inviteQ.data?.valid && (
            <Button variant="outline" className="w-full" onClick={() => navigate({ to: "/" })}>
              Back to home
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
