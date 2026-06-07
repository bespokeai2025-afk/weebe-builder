import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCircle2, Mail, RefreshCw, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { listUserActivity, setUserReviewed } from "@/lib/admin/user-activity.functions";

export const Route = createFileRoute("/_authenticated/admin/user-activity")({
  component: UserActivityPage,
});

function statusVariant(status: string) {
  if (status === "sent") return "bg-emerald-500/15 text-emerald-300";
  if (status === "pending") return "bg-amber-500/15 text-amber-300";
  if (status === "suppressed") return "bg-zinc-500/15 text-zinc-300";
  return "bg-destructive/15 text-destructive";
}

function UserActivityPage() {
  const qc = useQueryClient();
  const fetchActivity = useServerFn(listUserActivity);
  const setReviewed = useServerFn(setUserReviewed);
  const [tab, setTab] = useState<"unreviewed" | "all">("unreviewed");

  const query = useQuery({
    queryKey: ["admin-user-activity", tab],
    queryFn: () => fetchActivity({ data: { onlyUnreviewed: tab === "unreviewed" } }),
    refetchInterval: 30_000,
  });

  const reviewMutation = useMutation({
    mutationFn: (vars: { profileId: string; reviewed: boolean }) => setReviewed({ data: vars }),
    onSuccess: (_d, vars) => {
      toast.success(vars.reviewed ? "Marked as reviewed" : "Reset to unreviewed");
      qc.invalidateQueries({ queryKey: ["admin-user-activity"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = query.data ?? [];

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <Link
            to="/admin"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to admin
          </Link>
          <h1 className="text-sm font-medium">New user activity</h1>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => qc.invalidateQueries({ queryKey: ["admin-user-activity"] })}
            className="gap-1"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        <p className="text-sm text-muted-foreground">
          Track new signups and every email sent to them. Mark a user as reviewed once you've seen
          their interaction.
        </p>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="unreviewed">Awaiting review</TabsTrigger>
            <TabsTrigger value="all">All recent</TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-4 space-y-3">
            {query.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-28" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-lg border p-6 text-sm text-muted-foreground text-center">
                {tab === "unreviewed"
                  ? "All caught up. No users awaiting review."
                  : "No recent users."}
              </div>
            ) : (
              rows.map((r) => (
                <div key={r.profileId} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium truncate">{r.email}</div>
                        {r.approved && (
                          <Badge variant="secondary" className="text-[10px]">
                            Approved
                          </Badge>
                        )}
                        {r.denied && (
                          <Badge variant="destructive" className="text-[10px]">
                            Denied
                          </Badge>
                        )}
                        {r.adminReviewedAt && (
                          <Badge className="bg-emerald-500/15 text-emerald-300 text-[10px]">
                            Reviewed
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Signed up {new Date(r.signedUpAt).toLocaleString()}
                        {r.adminReviewedAt && (
                          <> · reviewed {new Date(r.adminReviewedAt).toLocaleString()}</>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={r.adminReviewedAt ? "outline" : "default"}
                      disabled={reviewMutation.isPending}
                      onClick={() =>
                        reviewMutation.mutate({
                          profileId: r.profileId,
                          reviewed: !r.adminReviewedAt,
                        })
                      }
                      className="gap-1 shrink-0"
                    >
                      {r.adminReviewedAt ? (
                        <>
                          <RotateCcw className="h-4 w-4" /> Reset
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" /> Mark reviewed
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="border-t pt-3">
                    <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground mb-2">
                      <Mail className="h-3 w-3" /> Emails sent ({r.emails.length})
                    </div>
                    {r.emails.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No emails recorded yet.</div>
                    ) : (
                      <ul className="space-y-1.5">
                        {r.emails.map((e) => (
                          <li
                            key={e.id}
                            className="flex items-center justify-between gap-3 text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`rounded-full px-1.5 py-0.5 text-[10px] ${statusVariant(e.status)}`}
                              >
                                {e.status}
                              </span>
                              <span className="font-medium truncate">{e.template}</span>
                              {e.error && (
                                <span className="text-destructive truncate">· {e.error}</span>
                              )}
                            </div>
                            <span className="text-muted-foreground shrink-0">
                              {new Date(e.createdAt).toLocaleString()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
