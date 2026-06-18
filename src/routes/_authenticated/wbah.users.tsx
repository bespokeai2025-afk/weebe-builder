/**
 * Webuyanyhouse — User Management
 * Create, edit, activate/deactivate WeeBespoke users with dynamic RBAC permissions grid.
 * Permission catalog loaded from API — never hardcoded.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Users, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Shield, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  getWbahUsersAndPermissions, createWbahUser, updateWbahUser,
  toggleWbahUserStatus, deleteWbahUser,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import {
  WbahPage, KpiCard, WbahLoading, WbahError, WbahEmpty,
  WbahTable, WbahTr, WbahTd, safeArr,
} from "@/components/wbah/WbahShell";

export const Route = createFileRoute("/_authenticated/wbah/users")({
  component: WbahUsers,
});

type Permission = { key: string; label: string };
type UserForm = {
  name: string; email: string; password: string;
  role: "admin" | "user"; permissions: Record<string, { read: boolean; write: boolean }>;
};

function blankForm(catalog: Permission[]): UserForm {
  const permissions: UserForm["permissions"] = {};
  for (const p of catalog) permissions[p.key] = { read: false, write: false };
  return { name: "", email: "", password: "", role: "user", permissions };
}

// ── Permission grid ────────────────────────────────────────────────────────────

function PermGrid({
  catalog,
  permissions,
  onChange,
}: {
  catalog: Permission[];
  permissions: UserForm["permissions"];
  onChange: (p: UserForm["permissions"]) => void;
}) {
  function setRead(key: string, val: boolean) {
    const next = { ...permissions, [key]: { ...permissions[key], read: val, write: val ? permissions[key].write : false } };
    if (!val) next[key].write = false;
    onChange(next);
  }
  function setWrite(key: string, val: boolean) {
    const next = { ...permissions, [key]: { read: val ? true : permissions[key].read, write: val } };
    onChange(next);
  }

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr,60px,60px] gap-1 text-[10px] text-gray-500 uppercase px-2 mb-1">
        <div>Permission</div>
        <div className="text-center">Read</div>
        <div className="text-center">Write</div>
      </div>
      {catalog.map((p) => (
        <div key={p.key} className="grid grid-cols-[1fr,60px,60px] gap-1 items-center px-2 py-1 rounded hover:bg-gray-800/50">
          <span className="text-sm text-gray-300">{p.label}</span>
          <div className="flex justify-center">
            <input
              type="checkbox"
              checked={permissions[p.key]?.read ?? false}
              onChange={(e) => setRead(p.key, e.target.checked)}
              className="accent-emerald-500 h-3.5 w-3.5"
            />
          </div>
          <div className="flex justify-center">
            <input
              type="checkbox"
              checked={permissions[p.key]?.write ?? false}
              onChange={(e) => setWrite(p.key, e.target.checked)}
              className="accent-emerald-500 h-3.5 w-3.5"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function WbahUsers() {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [form, setForm] = useState<UserForm | null>(null);

  const getFn    = useServerFn(getWbahUsersAndPermissions);
  const createFn = useServerFn(createWbahUser);
  const updateFn = useServerFn(updateWbahUser);
  const statusFn = useServerFn(toggleWbahUserStatus);
  const delFn    = useServerFn(deleteWbahUser);

  const { data, isLoading, error } = useQuery({
    queryKey: ["wbah-users"],
    queryFn: () => getFn(),
    staleTime: 60_000,
  });

  const catalog: Permission[] = safeArr(data?.permissionCatalog);
  const users   = safeArr(data?.users);
  const admins  = users.filter((u: any) => u.role === "admin");

  function openCreate() {
    setEditUser(null);
    setForm(blankForm(catalog));
    setFormOpen(true);
  }

  function openEdit(u: any) {
    setEditUser(u);
    const perms: UserForm["permissions"] = {};
    for (const p of catalog) {
      const up = (u.permissions ?? {})[p.key] ?? {};
      perms[p.key] = { read: up.read ?? false, write: up.write ?? false };
    }
    setForm({ name: u.name ?? "", email: u.email ?? "", password: "", role: u.role ?? "user", permissions: perms });
    setFormOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("No form");
      if (editUser) {
        return updateFn({ data: { id: editUser._id ?? editUser.id, payload: form } });
      }
      return createFn({ data: form });
    },
    onSuccess: () => {
      toast.success(editUser ? "User updated" : "User created");
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ["wbah-users"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save user"),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      statusFn({ data: { id, status } }),
    onSuccess: () => { toast.success("Status updated"); qc.invalidateQueries({ queryKey: ["wbah-users"] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  const delMutation = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("User deleted"); setDeleteId(null); qc.invalidateQueries({ queryKey: ["wbah-users"] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  return (
    <WbahPage
      title="User Management"
      subtitle="Manage Webuyanyhouse users and their feature permissions"
      actions={
        <Button
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs gap-1.5"
          onClick={openCreate}
        >
          <Plus className="h-3 w-3" /> Add User
        </Button>
      }
    >
      {error && <WbahError message={(error as Error).message} />}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard icon={Users}  label="Total Users"  value={users.length}  color="text-emerald-400" />
        <KpiCard icon={Shield} label="Admins"        value={admins.length} color="text-yellow-400" />
        <KpiCard icon={Users}  label="Active Users"  value={users.filter((u: any) => u.active !== false && u.status !== "inactive").length} color="text-blue-400" />
      </div>

      {isLoading ? (
        <WbahLoading label="Loading users…" />
      ) : users.length === 0 ? (
        <WbahEmpty label="No users found — create one to get started" />
      ) : (
        <WbahTable headers={["Name", "Email", "Role", "Status", "Permissions", "Actions"]}>
          {users.map((u: any, i) => {
            const id     = u._id ?? u.id ?? String(i);
            const isActive = u.active !== false && u.status !== "inactive";
            const permCount = Object.values(u.permissions ?? {}).filter((p: any) => p?.read).length;

            return (
              <WbahTr key={id}>
                <WbahTd>
                  <span className="font-medium text-white">{u.name ?? u.fullName ?? "—"}</span>
                </WbahTd>
                <WbahTd className="text-xs">{u.email ?? "—"}</WbahTd>
                <WbahTd>
                  <span className={`text-xs font-medium ${u.role === "admin" ? "text-yellow-400" : "text-gray-400"}`}>
                    {u.role ?? "user"}
                  </span>
                </WbahTd>
                <WbahTd>
                  <span className={`text-xs font-medium ${isActive ? "text-emerald-400" : "text-gray-600"}`}>
                    {isActive ? "Active" : "Inactive"}
                  </span>
                </WbahTd>
                <WbahTd className="text-xs text-gray-400">
                  {catalog.length > 0 ? `${permCount} / ${catalog.length} read` : "—"}
                </WbahTd>
                <WbahTd>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-gray-400 hover:text-white" onClick={() => openEdit(u)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      className={`h-7 px-2 ${isActive ? "text-gray-400 hover:text-yellow-400" : "text-gray-600 hover:text-emerald-400"}`}
                      onClick={() => statusMutation.mutate({ id, status: isActive ? "inactive" : "active" })}
                    >
                      {isActive ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-gray-400 hover:text-red-400" onClick={() => setDeleteId(id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </WbahTd>
              </WbahTr>
            );
          })}
        </WbahTable>
      )}

      {/* Create / Edit modal */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="bg-gray-950 border-gray-800 text-white sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editUser ? "Edit User" : "Create User"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400">Full Name *</label>
                  <Input className="mt-1 bg-gray-900 border-gray-700 text-white text-sm" value={form.name}
                    onChange={(e) => setForm((f) => f ? { ...f, name: e.target.value } : f)} />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Email *</label>
                  <Input type="email" className="mt-1 bg-gray-900 border-gray-700 text-white text-sm" value={form.email}
                    onChange={(e) => setForm((f) => f ? { ...f, email: e.target.value } : f)} />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-400">Password {editUser ? "(leave blank to keep)" : "*"}</label>
                <div className="relative mt-1">
                  <Input
                    type={showPw ? "text" : "password"}
                    className="bg-gray-900 border-gray-700 text-white text-sm pr-9"
                    value={form.password}
                    onChange={(e) => setForm((f) => f ? { ...f, password: e.target.value } : f)}
                  />
                  <button onClick={() => setShowPw((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-400">Role</label>
                <select
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-md text-sm text-white px-3 py-2"
                  value={form.role}
                  onChange={(e) => setForm((f) => f ? { ...f, role: e.target.value as "admin" | "user" } : f)}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              {catalog.length > 0 && (
                <div>
                  <label className="text-xs text-gray-400 block mb-2">Permissions</label>
                  <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 max-h-60 overflow-y-auto">
                    <PermGrid
                      catalog={catalog}
                      permissions={form.permissions}
                      onChange={(p) => setForm((f) => f ? { ...f, permissions: p } : f)}
                    />
                  </div>
                  <p className="text-[10px] text-gray-600 mt-1">Write access automatically grants Read access.</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="border-gray-700 text-gray-300" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form?.name || !form?.email}
            >
              {editUser ? "Save Changes" : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="bg-gray-950 border-gray-800 text-white sm:max-w-sm">
          <DialogHeader><DialogTitle className="text-red-400">Delete User?</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-400 py-2">This user will be permanently removed from the workspace.</p>
          <DialogFooter>
            <Button variant="outline" className="border-gray-700 text-gray-300" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteId && delMutation.mutate(deleteId)}
              disabled={delMutation.isPending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WbahPage>
  );
}
