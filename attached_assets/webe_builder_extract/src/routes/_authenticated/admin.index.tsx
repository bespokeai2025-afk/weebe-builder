import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, Check, X, RefreshCw, Plus, RotateCcw } from "lucide-react";
import {
  listAllProfiles,
  setUserApproval,
  addUserCredits,
  resetUserSpend,
} from "@/lib/auth/auth.functions";
import {
  listWorkspaceRequests,
  decideWorkspaceRequest,
} from "@/lib/agents/workspace.functions";


export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminPage,
});

type Profile = {
  id: string;
  user_id: string;
  email: string;
  approved: boolean;
  denied: boolean;
  created_at: string;
  approval_decided_at: string | null;
  spend_limit_cents: number;
  spend_used_cents: number;
};

function AdminPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creditInputs, setCreditInputs] = useState<Record<string, string>>({});
  const [wsReqs, setWsReqs] = useState<
    Array<{
      id: string;
      user_id: string;
      workspace_name: string;
      status: string;
      created_at: string;
      decided_at: string | null;
      email: string;
    }>
  >([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, ws] = await Promise.all([
        listAllProfiles(),
        listWorkspaceRequests(),
      ]);
      setProfiles(data as Profile[]);
      setWsReqs(ws as typeof wsReqs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const decideWs = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      await decideWorkspaceRequest({ data: { id, approve } });
      toast.success(approve ? "Workspace approved" : "Workspace denied");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };



  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      await setUserApproval({ data: { profileId: id, approve } });
      toast.success(approve ? "User approved" : "User denied");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const addCredits = async (id: string) => {
    const raw = creditInputs[id];
    const dollars = Number(raw);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error("Enter a dollar amount");
      return;
    }
    setBusy(id);
    try {
      await addUserCredits({ data: { profileId: id, dollars } });
      toast.success(`Added $${dollars.toFixed(2)} in credits`);
      setCreditInputs((s) => ({ ...s, [id]: "" }));
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const resetSpend = async (id: string) => {
    setBusy(id);
    try {
      await resetUserSpend({ data: { profileId: id } });
      toast.success("Usage reset");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pending = profiles.filter((p) => !p.approved && !p.denied);
  const decided = profiles.filter((p) => p.approved || p.denied);
  const approved = profiles.filter((p) => p.approved);

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <Link
            to="/builder"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to builder
          </Link>
          <h1 className="text-sm font-medium">Admin</h1>
          <Button size="sm" variant="ghost" onClick={load} className="gap-1">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6 space-y-8">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2">
          <Link
            to="/admin/user-activity"
            className="rounded-lg border p-4 hover:bg-white/[0.03] transition"
          >
            <div className="text-sm font-medium">New user activity</div>
            <div className="text-xs text-muted-foreground mt-1">
              See emails sent to new signups and mark them as reviewed.
            </div>
          </Link>
          <Link
            to="/billing"
            className="rounded-lg border p-4 hover:bg-white/[0.03] transition"
          >
            <div className="text-sm font-medium">Payments & plans</div>
            <div className="text-xs text-muted-foreground mt-1">
              Manage products, subscriptions, and the Stripe billing portal.
            </div>
          </Link>
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-3">
            Workspace requests ({wsReqs.filter((r) => r.status === "pending").length} pending)
          </h2>
          <div className="rounded-lg border divide-y">
            {wsReqs.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No workspace requests yet.
              </div>
            ) : (
              wsReqs.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {r.workspace_name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.email} · requested {new Date(r.created_at).toLocaleString()}
                      {r.decided_at && (
                        <> · decided {new Date(r.decided_at).toLocaleString()}</>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.status === "pending" ? (
                      <>
                        <Button
                          size="sm"
                          disabled={busy === r.id}
                          onClick={() => decideWs(r.id, true)}
                          className="gap-1"
                        >
                          <Check className="h-4 w-4" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === r.id}
                          onClick={() => decideWs(r.id, false)}
                          className="gap-1"
                        >
                          <X className="h-4 w-4" /> Deny
                        </Button>
                      </>
                    ) : (
                      <span
                        className={
                          r.status === "approved"
                            ? "text-xs rounded-full bg-emerald-500/15 text-emerald-300 px-2 py-1"
                            : "text-xs rounded-full bg-destructive/15 text-destructive px-2 py-1"
                        }
                      >
                        {r.status === "approved" ? "Approved" : "Denied"}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section>

          <h2 className="text-sm font-semibold mb-3">
            Pending ({pending.length})
          </h2>
          <div className="rounded-lg border divide-y">
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : pending.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No pending signups.
              </div>
            ) : (
              pending.map((p) => (
                <Row
                  key={p.id}
                  p={p}
                  busy={busy === p.id}
                  onDecide={decide}
                />
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-3">
            Credits ({approved.length})
          </h2>
          <div className="rounded-lg border divide-y">
            {approved.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No approved users yet.
              </div>
            ) : (
              approved.map((p) => {
                const limit = (p.spend_limit_cents ?? 0) / 100;
                const used = (p.spend_used_cents ?? 0) / 100;
                const over = used >= limit;
                return (
                  <div
                    key={p.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {p.email}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Used ${used.toFixed(2)} / ${limit.toFixed(2)}
                        {over && (
                          <span className="ml-2 text-destructive font-medium">
                            Over cap — needs top-up
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="$"
                        className="w-24 h-9"
                        value={creditInputs[p.id] ?? ""}
                        onChange={(e) =>
                          setCreditInputs((s) => ({
                            ...s,
                            [p.id]: e.target.value,
                          }))
                        }
                      />
                      <Button
                        size="sm"
                        disabled={busy === p.id}
                        onClick={() => addCredits(p.id)}
                        className="gap-1"
                      >
                        <Plus className="h-4 w-4" /> Add credits
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === p.id}
                        onClick={() => resetSpend(p.id)}
                        className="gap-1"
                      >
                        <RotateCcw className="h-4 w-4" /> Reset
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-3">
            History ({decided.length})
          </h2>
          <div className="rounded-lg border divide-y">
            {decided.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No decisions yet.
              </div>
            ) : (
              decided.map((p) => (
                <Row
                  key={p.id}
                  p={p}
                  busy={busy === p.id}
                  onDecide={decide}
                  history
                />
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Row({
  p,
  busy,
  onDecide,
  history,
}: {
  p: Profile;
  busy: boolean;
  onDecide: (id: string, approve: boolean) => void;
  history?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{p.email}</div>
        <div className="text-xs text-muted-foreground">
          Signed up {new Date(p.created_at).toLocaleString()}
          {history && p.approval_decided_at && (
            <> · decided {new Date(p.approval_decided_at).toLocaleString()}</>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {history ? (
          <span
            className={
              p.approved
                ? "text-xs rounded-full bg-emerald-500/15 text-emerald-300 px-2 py-1"
                : "text-xs rounded-full bg-destructive/15 text-destructive px-2 py-1"
            }
          >
            {p.approved ? "Approved" : "Denied"}
          </span>
        ) : (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onDecide(p.id, true)}
              className="gap-1"
            >
              <Check className="h-4 w-4" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onDecide(p.id, false)}
              className="gap-1"
            >
              <X className="h-4 w-4" /> Deny
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
