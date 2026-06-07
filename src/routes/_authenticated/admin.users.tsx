import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { RefreshCw, Plus, RotateCcw, Shield, User } from "lucide-react";
import { listUsers, createUser, updateUserType, deactivateUser } from "@/lib/admin/users.functions";
import { addUserCredits, resetUserSpend } from "@/lib/auth/auth.functions";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsersPage,
});

interface UserRow {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  user_type: "admin" | "user";
  default_workspace_id: string | null;
  created_at: string;
  spend_limit_cents: number;
  spend_used_cents: number;
}

function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [creditInputs, setCreditInputs] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const data = await listUsers();
      setUsers(data as unknown as UserRow[]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    if (!newEmail.includes("@")) {
      toast.error("Valid email required");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password min 8 chars");
      return;
    }
    setBusy(true);
    try {
      await createUser({
        data: {
          email: newEmail,
          password: newPassword,
          fullName: newName || undefined,
          userType: newIsAdmin ? "admin" : "user",
        },
      });
      toast.success("User created");
      setShowCreate(false);
      setNewEmail("");
      setNewPassword("");
      setNewName("");
      setNewIsAdmin(false);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleAdmin = async (userId: string, current: string) => {
    const newType = current === "admin" ? "user" : "admin";
    setBusy(true);
    try {
      await updateUserType({ data: { userId, userType: newType } });
      toast.success(newType === "admin" ? "Promoted to admin" : "Demoted to user");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const banUser = async (userId: string) => {
    setBusy(true);
    try {
      await deactivateUser({ data: { userId } });
      toast.success("User deactivated");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addCredits = async (id: string) => {
    const raw = creditInputs[id];
    const dollars = Number(raw);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error("Enter a dollar amount");
      return;
    }
    setBusy(true);
    try {
      await addUserCredits({ data: { profileId: id, dollars } });
      toast.success(`Added $${dollars.toFixed(2)} credits`);
      setCreditInputs((s) => ({ ...s, [id]: "" }));
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetSpend = async (id: string) => {
    setBusy(true);
    try {
      await resetUserSpend({ data: { profileId: id } });
      toast.success("Usage reset");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-sm font-medium">User Management</h1>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowCreate(!showCreate)}
              className="gap-1"
            >
              <Plus className="h-4 w-4" /> Create user
            </Button>
            <Button size="sm" variant="ghost" onClick={load} className="gap-1">
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        {showCreate && (
          <div className="rounded-lg border p-4 space-y-3">
            <h2 className="text-sm font-semibold">Create new user</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="new-email">Email</Label>
                <Input
                  id="new-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-password">Password (min 8)</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-name">Full name</Label>
                <Input id="new-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
              <div className="space-y-1 flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newIsAdmin}
                    onChange={(e) => setNewIsAdmin(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm">Admin access</span>
                </label>
              </div>
            </div>
            <Button disabled={busy} onClick={handleCreate}>
              Create account
            </Button>
          </div>
        )}

        <div className="rounded-lg border divide-y">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : users.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No users found.</div>
          ) : (
            users.map((u) => {
              const limit = (u.spend_limit_cents ?? 0) / 100;
              const used = (u.spend_used_cents ?? 0) / 100;
              return (
                <div key={u.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{u.email}</span>
                      {u.user_type === "admin" ? (
                        <span className="text-xs rounded-full bg-primary/15 text-primary px-2 py-0.5 flex items-center gap-1">
                          <Shield className="h-3 w-3" /> Admin
                        </span>
                      ) : (
                        <span className="text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5 flex items-center gap-1">
                          <User className="h-3 w-3" /> User
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {u.full_name && <>{u.full_name} · </>}
                      Joined {new Date(u.created_at).toLocaleDateString()}
                      {u.spend_limit_cents > 0 && (
                        <>
                          {" "}
                          · ${used.toFixed(2)} / ${limit.toFixed(2)}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="$"
                        className="w-20 h-8"
                        value={creditInputs[u.id] ?? ""}
                        onChange={(e) => setCreditInputs((s) => ({ ...s, [u.id]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => addCredits(u.id)}
                        className="h-8 px-2"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => resetSpend(u.id)}
                        className="h-8 px-2"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => toggleAdmin(u.user_id, u.user_type)}
                      className="h-8"
                    >
                      {u.user_type === "admin" ? "Demote" : "Promote"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => banUser(u.user_id)}
                      className="h-8"
                    >
                      Ban
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
