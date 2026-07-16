import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bell,
  Loader2,
  Lock,
  Mail,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  listNotificationSettings,
  updateNotificationSetting,
  listWorkspaceNotifications,
  markNotificationsRead,
  sendTestNotificationEmail,
} from "@/lib/notifications/notifications.functions";

function providerLabel(source: string): string {
  switch (source) {
    case "workspace_custom":
      return "your workspace's custom email provider";
    case "parent_custom":
      return "your reseller's email provider";
    case "platform_default":
      return "the WEBEE platform email service";
    default:
      return source;
  }
}
import {
  getMyPermissions,
  listTeamMembers,
  setMemberRole,
  removeMember,
  listRolePermissions,
  upsertRolePermissions,
  resetRolePermissions,
  getApprovalSettings,
  updateApprovalSettings,
  listAccessAuditLog,
} from "@/lib/permissions/team-access.functions";
import { createInvite, listInvites, revokeInvite } from "@/lib/workspace/invites.functions";
import { UserAccessOverrideDialog } from "@/components/settings/UserAccessOverrideDialog";
import {
  ROLE_KEYS,
  ROLE_LABELS,
  PAGE_KEYS,
  PAGE_LABELS,
  PAGE_LEVELS,
  ACTION_KEYS,
  ACTION_LABELS,
  type RoleKey,
} from "@/lib/permissions/permissions.shared";
import { NOTIFICATION_EVENT_LABELS } from "@/lib/notifications/notification-engine.shared";
import { getMyEntitlements } from "@/lib/packages/packages.functions";
import {
  getEmailProviderSettings,
  saveEmailProviderSettings,
  sendEmailProviderTest,
} from "@/lib/email/email-provider.functions";

export const Route = createFileRoute("/_authenticated/settings/account")({
  head: () => ({
    meta: [
      { title: "Account Settings — Webee" },
      { name: "description", content: "Notifications, team access and approval settings." },
    ],
  }),
  component: AccountSettingsPage,
});

const FREQUENCIES = [
  { value: "immediate", label: "Immediately" },
  { value: "hourly", label: "Hourly digest" },
  { value: "daily", label: "Daily digest" },
  { value: "weekly", label: "Weekly digest" },
];

function AccountSettingsPage() {
  const myPermsFn = useServerFn(getMyPermissions);
  const permsQ = useQuery({
    queryKey: ["my-permissions"],
    queryFn: () => myPermsFn(),
    throwOnError: false,
  });
  const canManageUsers = permsQ.data?.actionAccess?.user_management === true;
  const canManageNotifications = permsQ.data?.actionAccess?.notification_settings === true;

  const entitlementsFn = useServerFn(getMyEntitlements);
  const entQ = useQuery({
    queryKey: ["my-entitlements"],
    queryFn: () => entitlementsFn(),
    throwOnError: false,
  });
  const hasCustomEmailProvider =
    (entQ.data as any)?.entitlements?.features?.custom_email_provider === true;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Account Settings</h1>
          <p className="text-sm text-muted-foreground">
            Campaign notifications, team access and approvals for this workspace.
          </p>
        </div>
      </div>

      <Tabs defaultValue="notifications">
        <TabsList>
          <TabsTrigger value="notifications">
            <Bell className="mr-1.5 h-4 w-4" /> Notifications
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users className="mr-1.5 h-4 w-4" /> Team Access
          </TabsTrigger>
          <TabsTrigger value="approvals">
            <ShieldCheck className="mr-1.5 h-4 w-4" /> Approval Settings
          </TabsTrigger>
          {hasCustomEmailProvider && (
            <TabsTrigger value="email">
              <Mail className="mr-1.5 h-4 w-4" /> Email
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="notifications" className="mt-4">
          <NotificationsTab canManage={canManageNotifications} />
        </TabsContent>
        <TabsContent value="team" className="mt-4">
          <TeamAccessTab canManage={canManageUsers} myUserId={null} />
        </TabsContent>
        <TabsContent value="approvals" className="mt-4">
          <ApprovalsTab canManage={canManageUsers} />
        </TabsContent>
        {hasCustomEmailProvider && (
          <TabsContent value="email" className="mt-4">
            <EmailProviderTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ── Notifications tab ────────────────────────────────────────────────────────

function NotificationsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listNotificationSettings);
  const updateFn = useServerFn(updateNotificationSetting);
  const membersFn = useServerFn(listTeamMembers);

  const settingsQ = useQuery({
    queryKey: ["notification-settings"],
    queryFn: () => listFn(),
    throwOnError: false,
  });
  const membersQ = useQuery({
    queryKey: ["team-members"],
    queryFn: () => membersFn(),
    throwOnError: false,
  });

  const saveM = useMutation({
    mutationFn: (input: any) => updateFn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
      toast.success("Notification setting saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const testFn = useServerFn(sendTestNotificationEmail);
  const testM = useMutation({
    mutationFn: (input: { eventKey: string }) => testFn({ data: input }),
    onSuccess: (res: any) => {
      toast.success(
        `Test email sent to ${res?.to ?? "you"}${res?.providerUsed ? ` via ${providerLabel(res.providerUsed)}` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Test send failed"),
  });

  if (settingsQ.isLoading) return <LoadingCard />;
  const payload: any = settingsQ.data ?? {};
  const rows = Array.isArray(payload) ? payload : (payload.rows ?? []);
  const caps = Array.isArray(payload)
    ? { emailAllowed: false, customRecipientsAllowed: false, packageKey: null }
    : (payload.caps ?? { emailAllowed: false, customRecipientsAllowed: false, packageKey: null });
  const providerSource: string | null = Array.isArray(payload) ? null : (payload.providerSource ?? null);
  const members = membersQ.data ?? [];

  return (
    <div className="space-y-4">
    <NotificationInboxCard />
    <Card>
      <CardHeader>
        <CardTitle>Event notifications</CardTitle>
        <CardDescription>
          Choose which events notify your team, in-app and by email.
          {!canManage && " You have read-only access — ask an owner or admin to change these."}
        </CardDescription>
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
          {providerSource && (
            <span className="inline-flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" />
              Emails sent via {providerLabel(providerSource)}
            </span>
          )}
          {!caps.emailAllowed && (
            <Badge variant="secondary" className="text-[10px]">
              Email notifications not included in your package
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row: any) => (
          <div
            key={row.eventKey}
            className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
          >
            <div className="min-w-[220px] flex-1">
              <div className="text-sm font-medium">
                {(NOTIFICATION_EVENT_LABELS as any)[row.eventKey] ?? row.eventKey}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {row.isDefault && <span>Default</span>}
                {row.lastEmail && (
                  <span className={row.lastEmail.status === "sent" ? "" : "text-destructive"}>
                    Last email: {row.lastEmail.status === "sent" ? "sent" : "failed"}{" "}
                    {row.lastEmail.at ? new Date(row.lastEmail.at).toLocaleString() : ""}
                  </span>
                )}
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-xs">
              <Switch
                checked={row.enabled}
                disabled={!canManage || saveM.isPending}
                onCheckedChange={(v) =>
                  saveM.mutate({
                    eventKey: row.eventKey,
                    enabled: v,
                    emailEnabled: row.emailEnabled,
                    inAppEnabled: row.inAppEnabled,
                    recipients: row.recipients,
                    frequency: row.frequency,
                  })
                }
              />
              On
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <Switch
                checked={row.inAppEnabled}
                disabled={!canManage || !row.enabled || saveM.isPending}
                onCheckedChange={(v) =>
                  saveM.mutate({
                    eventKey: row.eventKey,
                    enabled: row.enabled,
                    emailEnabled: row.emailEnabled,
                    inAppEnabled: v,
                    recipients: row.recipients,
                    frequency: row.frequency,
                  })
                }
              />
              In-app
            </label>
            <label
              className="flex items-center gap-1.5 text-xs"
              title={caps.emailAllowed ? undefined : "Email notifications are not included in your package"}
            >
              <Switch
                checked={caps.emailAllowed && row.emailEnabled}
                disabled={!canManage || !row.enabled || !caps.emailAllowed || saveM.isPending}
                onCheckedChange={(v) =>
                  saveM.mutate({
                    eventKey: row.eventKey,
                    enabled: row.enabled,
                    emailEnabled: v,
                    inAppEnabled: row.inAppEnabled,
                    recipients: row.recipients,
                    frequency: row.frequency,
                  })
                }
              />
              <Mail className="h-3.5 w-3.5" /> Email
              {!caps.emailAllowed && <Lock className="h-3 w-3 text-muted-foreground" />}
            </label>
            <Select
              value={row.frequency}
              disabled={!canManage || !row.enabled || saveM.isPending}
              onValueChange={(v) =>
                saveM.mutate({
                  eventKey: row.eventKey,
                  enabled: row.enabled,
                  emailEnabled: row.emailEnabled,
                  inAppEnabled: row.inAppEnabled,
                  recipients: row.recipients,
                  frequency: v,
                })
              }
            >
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canManage && caps.emailAllowed && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                disabled={testM.isPending}
                onClick={() => testM.mutate({ eventKey: row.eventKey })}
                title="Send a test email for this event to your own address"
              >
                <Send className="mr-1 h-3.5 w-3.5" /> Test
              </Button>
            )}
            <RecipientsEditor
              row={row}
              members={members}
              canManage={canManage}
              customEmailsAllowed={caps.customRecipientsAllowed}
              onSave={(recipients) =>
                saveM.mutate({
                  eventKey: row.eventKey,
                  enabled: row.enabled,
                  emailEnabled: row.emailEnabled,
                  inAppEnabled: row.inAppEnabled,
                  recipients,
                  frequency: row.frequency,
                })
              }
            />
          </div>
        ))}
      </CardContent>
    </Card>
    </div>
  );
}

function recipientsSummary(r: any): string {
  const parts: string[] = [];
  if (r?.owner) parts.push("Owner");
  if (r?.admins) parts.push("Admins");
  if (r?.campaignOwner) parts.push("Campaign owner");
  if (r?.roleKeys?.length) parts.push(`${r.roleKeys.length} role${r.roleKeys.length === 1 ? "" : "s"}`);
  if (r?.userIds?.length) parts.push(`${r.userIds.length} user${r.userIds.length === 1 ? "" : "s"}`);
  if (r?.customEmails?.length) parts.push(`${r.customEmails.length} email${r.customEmails.length === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "No recipients";
}

function RecipientsEditor({
  row,
  members,
  canManage,
  customEmailsAllowed = true,
  onSave,
}: {
  row: any;
  members: any[];
  canManage: boolean;
  customEmailsAllowed?: boolean;
  onSave: (recipients: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>(null);
  const r = draft ?? {
    owner: row.recipients?.owner === true,
    admins: row.recipients?.admins === true,
    campaignOwner: row.recipients?.campaignOwner === true,
    roleKeys: [...(row.recipients?.roleKeys ?? [])],
    userIds: [...(row.recipients?.userIds ?? [])],
    customEmails: [...(row.recipients?.customEmails ?? [])],
  };
  const [emailsText, setEmailsText] = useState<string | null>(null);
  const effectiveEmailsText = emailsText ?? (r.customEmails ?? []).join("\n");

  const set = (patch: any) => setDraft({ ...r, ...patch });
  const toggleList = (key: "roleKeys" | "userIds", value: string) => {
    const list: string[] = r[key] ?? [];
    set({ [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) { setDraft(null); setEmailsText(null); }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs" disabled={!row.enabled}>
          {recipientsSummary(row.recipients)}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Recipients — {(NOTIFICATION_EVENT_LABELS as any)[row.eventKey] ?? row.eventKey}
          </DialogTitle>
          <DialogDescription>
            Who receives this notification (in-app for members, email if enabled).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={r.owner}
                disabled={!canManage}
                onCheckedChange={(v) => set({ owner: v === true })}
              />
              Workspace owner
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={r.admins}
                disabled={!canManage}
                onCheckedChange={(v) => set({ admins: v === true })}
              />
              All admins
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={r.campaignOwner}
                disabled={!canManage}
                onCheckedChange={(v) => set({ campaignOwner: v === true })}
              />
              Campaign owner (whoever created the campaign)
            </label>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Roles</div>
            <div className="flex flex-wrap gap-2">
              {ROLE_KEYS.filter((k) => k !== "suspended").map((rk) => (
                <Button
                  key={rk}
                  type="button"
                  variant={(r.roleKeys ?? []).includes(rk) ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!canManage}
                  onClick={() => toggleList("roleKeys", rk)}
                >
                  {ROLE_LABELS[rk as RoleKey] ?? rk}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
              Specific members
            </div>
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded border p-2">
              {members.length === 0 && (
                <p className="text-xs text-muted-foreground">No members loaded.</p>
              )}
              {members.map((m: any) => (
                <label key={m.userId} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={(r.userIds ?? []).includes(m.userId)}
                    disabled={!canManage}
                    onCheckedChange={() => toggleList("userIds", m.userId)}
                  />
                  <span className="truncate">{m.fullName || m.email || m.userId}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
              Custom email addresses
              {!customEmailsAllowed && <Lock className="h-3 w-3" />}
            </div>
            {customEmailsAllowed ? (
              <>
                <Textarea
                  rows={3}
                  placeholder={"one@example.com\ntwo@example.com"}
                  value={effectiveEmailsText}
                  disabled={!canManage}
                  onChange={(e) => setEmailsText(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">One address per line.</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Custom email recipients are not included in your current package.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canManage}
            onClick={() => {
              const customEmails = customEmailsAllowed
                ? effectiveEmailsText
                    .split(/[\n,;]+/)
                    .map((e: string) => e.trim())
                    .filter(Boolean)
                : [];
              onSave({ ...r, customEmails });
              setOpen(false);
              setDraft(null);
              setEmailsText(null);
            }}
          >
            Save recipients
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotificationInboxCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWorkspaceNotifications);
  const markFn = useServerFn(markNotificationsRead);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const q = useQuery({
    queryKey: ["workspace-notifications", unreadOnly],
    queryFn: () => listFn({ data: { limit: 50, unreadOnly } }),
    throwOnError: false,
  });
  const markM = useMutation({
    mutationFn: (input: { ids?: string[]; all?: boolean }) => markFn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace-notifications"] }),
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const rows = q.data ?? [];
  const unreadCount = rows.filter((n: any) => !n.read_at).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Your notifications</CardTitle>
          <CardDescription>Recent in-app campaign notifications for this workspace.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs">
            <Switch checked={unreadOnly} onCheckedChange={setUnreadOnly} /> Unread only
          </label>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={markM.isPending}
              onClick={() => markM.mutate({ all: true })}
            >
              Mark all read
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {q.isLoading && <LoadingRow />}
        {!q.isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {unreadOnly ? "No unread notifications." : "No notifications yet."}
          </p>
        )}
        {rows.map((n: any) => (
          <div
            key={n.id}
            className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${n.read_at ? "opacity-60" : ""}`}
          >
            <Badge
              variant={
                n.severity === "critical"
                  ? "destructive"
                  : n.severity === "warning"
                    ? "secondary"
                    : "outline"
              }
              className="mt-0.5 shrink-0"
            >
              {n.severity}
            </Badge>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{n.title}</div>
              {n.message && (
                <div className="whitespace-pre-line text-xs text-muted-foreground">
                  {String(n.message).split("\n").slice(0, 3).join("\n")}
                </div>
              )}
              <div className="mt-0.5 text-xs text-muted-foreground">
                {new Date(n.created_at).toLocaleString()}
              </div>
            </div>
            {!n.read_at && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 text-xs"
                disabled={markM.isPending}
                onClick={() => markM.mutate({ ids: [n.id] })}
              >
                Mark read
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Team Access tab ──────────────────────────────────────────────────────────

const ASSIGNABLE_ROLES = ROLE_KEYS.filter((r) => r !== "owner");

function TeamAccessTab({ canManage }: { canManage: boolean; myUserId: string | null }) {
  const qc = useQueryClient();
  const membersFn = useServerFn(listTeamMembers);
  const setRoleFn = useServerFn(setMemberRole);
  const removeFn = useServerFn(removeMember);
  const invitesFn = useServerFn(listInvites);
  const createInviteFn = useServerFn(createInvite);
  const revokeInviteFn = useServerFn(revokeInvite);
  const rolesFn = useServerFn(listRolePermissions);
  const upsertRoleFn = useServerFn(upsertRolePermissions);
  const resetRoleFn = useServerFn(resetRolePermissions);
  const auditFn = useServerFn(listAccessAuditLog);

  const membersQ = useQuery({
    queryKey: ["team-members"],
    queryFn: () => membersFn(),
    throwOnError: false,
  });
  const invitesQ = useQuery({
    queryKey: ["team-invites"],
    queryFn: () => invitesFn(),
    throwOnError: false,
  });
  const rolesQ = useQuery({
    queryKey: ["role-permissions"],
    queryFn: () => rolesFn(),
    throwOnError: false,
  });
  const auditQ = useQuery({
    queryKey: ["access-audit"],
    queryFn: () => auditFn({ data: { limit: 30 } }),
    enabled: canManage,
    throwOnError: false,
  });

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("manager");
  const inviteM = useMutation({
    mutationFn: () => createInviteFn({ data: { email: inviteEmail, roleKey: inviteRole } }),
    onSuccess: () => {
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["team-invites"] });
      toast.success("Invite sent");
    },
    onError: (e: any) => toast.error(e?.message ?? "Invite failed"),
  });
  const revokeM = useMutation({
    mutationFn: (inviteId: string) => revokeInviteFn({ data: { inviteId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-invites"] }),
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const roleM = useMutation({
    mutationFn: (input: { targetUserId: string; roleKey: string }) =>
      setRoleFn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members"] });
      toast.success("Role updated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const removeM = useMutation({
    mutationFn: (targetUserId: string) => removeFn({ data: { targetUserId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members"] });
      toast.success("Member removed");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const pendingInvites = useMemo(
    () => (invitesQ.data ?? []).filter((i: any) => !i.accepted_at && new Date(i.expires_at) > new Date()),
    [invitesQ.data],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Team members</CardTitle>
          <CardDescription>
            Assign roles to control what each member can see and do in this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {membersQ.isLoading && <LoadingRow />}
          {(membersQ.data ?? []).map((m: any) => (
            <div key={m.userId} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <div className="min-w-[200px] flex-1">
                <div className="text-sm font-medium">{m.fullName || m.email || m.userId}</div>
                <div className="text-xs text-muted-foreground">{m.email}</div>
              </div>
              {m.legacyRole === "owner" ? (
                <Badge>Owner</Badge>
              ) : (
                <>
                  <Select
                    value={m.roleKey}
                    disabled={!canManage || m.isSelf || roleM.isPending}
                    onValueChange={(v) => roleM.mutate({ targetUserId: m.userId, roleKey: v })}
                  >
                    <SelectTrigger className="h-8 w-[190px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNABLE_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r as RoleKey] ?? r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {canManage && !m.isSelf && (
                    <UserAccessOverrideDialog
                      targetUserId={m.userId}
                      targetLabel={m.fullName || m.email || m.userId}
                    />
                  )}
                  {canManage && !m.isSelf && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      disabled={removeM.isPending}
                      onClick={() => {
                        if (confirm(`Remove ${m.email ?? "this member"} from the workspace?`)) {
                          removeM.mutate(m.userId);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  {m.isSelf && <Badge variant="outline">You</Badge>}
                </>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Invite a team member</CardTitle>
            <CardDescription>They'll receive an email with a link to join this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[220px]">
                <Label htmlFor="invite-email" className="text-xs">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="colleague@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger className="w-[190px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r as RoleKey] ?? r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={!inviteEmail || inviteM.isPending}
                onClick={() => inviteM.mutate()}
              >
                {inviteM.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="mr-1.5 h-4 w-4" />
                )}
                Send invite
              </Button>
            </div>
            {pendingInvites.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">Pending invites</div>
                {pendingInvites.map((i: any) => (
                  <div key={i.id} className="flex items-center gap-2 rounded border px-3 py-1.5 text-sm">
                    <span className="flex-1">{i.email}</span>
                    <Badge variant="outline">{i.invited_role_key ?? i.role}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-destructive"
                      onClick={() => revokeM.mutate(i.id)}
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <RolePermissionsCard
        canManage={canManage}
        rolesQ={rolesQ}
        onSave={(input) =>
          upsertRoleFn({ data: input })
            .then(() => {
              qc.invalidateQueries({ queryKey: ["role-permissions"] });
              toast.success("Role permissions saved");
            })
            .catch((e: any) => toast.error(e?.message ?? "Failed"))
        }
        onReset={(roleKey) =>
          resetRoleFn({ data: { roleKey } })
            .then(() => {
              qc.invalidateQueries({ queryKey: ["role-permissions"] });
              toast.success("Role reset to defaults");
            })
            .catch((e: any) => toast.error(e?.message ?? "Failed"))
        }
      />

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Access audit log</CardTitle>
            <CardDescription>Recent role, invite and settings changes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(auditQ.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No audit entries yet.</p>
            )}
            {(auditQ.data ?? []).map((a: any) => (
              <div key={a.id} className="flex items-center gap-2 rounded border px-3 py-1.5 text-xs">
                <Badge variant={a.risk_level === "high" ? "destructive" : "outline"}>
                  {a.risk_level}
                </Badge>
                <span className="flex-1">
                  {a.object_type} · {a.action_type}
                  {a.object_id ? ` · ${String(a.object_id).slice(0, 24)}` : ""}
                </span>
                <span className="text-muted-foreground">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RolePermissionsCard({
  canManage,
  rolesQ,
  onSave,
  onReset,
}: {
  canManage: boolean;
  rolesQ: any;
  onSave: (input: any) => void;
  onReset: (roleKey: string) => void;
}) {
  const [selectedRole, setSelectedRole] = useState<string>("manager");
  const roles = rolesQ.data ?? [];
  const role = roles.find((r: any) => r.roleKey === selectedRole);
  const [draft, setDraft] = useState<any | null>(null);
  const effective = draft?.roleKey === selectedRole ? draft : role;

  const editable = canManage && selectedRole !== "owner";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Role permissions</CardTitle>
        <CardDescription>
          Customise what each role can access in this workspace. Owner permissions cannot be changed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Select value={selectedRole} onValueChange={(v) => { setSelectedRole(v); setDraft(null); }}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r: any) => (
                <SelectItem key={r.roleKey} value={r.roleKey}>
                  {ROLE_LABELS[r.roleKey as RoleKey] ?? r.displayName ?? r.roleKey}
                  {r.hasOverride ? " (customised)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editable && draft && (
            <Button
              size="sm"
              onClick={() =>
                onSave({
                  roleKey: selectedRole,
                  pageAccess: draft.pageAccess,
                  actionAccess: draft.actionAccess,
                  assignedRecordsOnly: draft.assignedRecordsOnly,
                })
              }
            >
              Save changes
            </Button>
          )}
          {editable && role?.hasOverride && (
            <Button variant="outline" size="sm" onClick={() => { setDraft(null); onReset(selectedRole); }}>
              Reset to defaults
            </Button>
          )}
        </div>

        {effective && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Pages</div>
              {PAGE_KEYS.map((page) => (
                <div key={page} className="flex items-center justify-between gap-2">
                  <span className="text-sm">{PAGE_LABELS[page]}</span>
                  <Select
                    value={effective.pageAccess?.[page] ?? "hidden"}
                    disabled={!editable}
                    onValueChange={(v) =>
                      setDraft({
                        roleKey: selectedRole,
                        pageAccess: { ...effective.pageAccess, [page]: v },
                        actionAccess: { ...effective.actionAccess },
                        assignedRecordsOnly: effective.assignedRecordsOnly === true,
                      })
                    }
                  >
                    <SelectTrigger className="h-7 w-[130px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_LEVELS.map((lvl) => (
                        <SelectItem key={lvl} value={lvl}>
                          {lvl.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Actions</div>
              {ACTION_KEYS.map((action) => (
                <div key={action} className="flex items-center justify-between gap-2">
                  <span className="text-sm">{ACTION_LABELS[action]}</span>
                  <Switch
                    checked={effective.actionAccess?.[action] === true}
                    disabled={!editable}
                    onCheckedChange={(v) =>
                      setDraft({
                        roleKey: selectedRole,
                        pageAccess: { ...effective.pageAccess },
                        actionAccess: { ...effective.actionAccess, [action]: v },
                        assignedRecordsOnly: effective.assignedRecordsOnly === true,
                      })
                    }
                  />
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 border-t pt-2">
                <span className="text-sm">Only see assigned records</span>
                <Switch
                  checked={effective.assignedRecordsOnly === true}
                  disabled={!editable}
                  onCheckedChange={(v) =>
                    setDraft({
                      roleKey: selectedRole,
                      pageAccess: { ...effective.pageAccess },
                      actionAccess: { ...effective.actionAccess },
                      assignedRecordsOnly: v,
                    })
                  }
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Approvals tab ────────────────────────────────────────────────────────────

const APPROVAL_LABELS: Record<string, string> = {
  go_live: "Agent Go Live",
  campaign_activation: "Campaign activation",
  systemmind_changes: "SystemMind changes",
  phone_purchase: "Phone number purchases",
  provider_settings: "Provider settings changes",
};

function ApprovalsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getApprovalSettings);
  const updateFn = useServerFn(updateApprovalSettings);

  const q = useQuery({
    queryKey: ["approval-settings"],
    queryFn: () => getFn(),
    throwOnError: false,
  });

  const saveM = useMutation({
    mutationFn: (settings: Record<string, { approverRoleKeys: string[] }>) =>
      updateFn({ data: { settings } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approval-settings"] });
      toast.success("Approval settings saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  if (q.isLoading) return <LoadingCard />;
  const rows = q.data ?? [];

  const toggleRole = (key: string, roleKey: string) => {
    const settings: Record<string, { approverRoleKeys: string[] }> = {};
    for (const row of rows) {
      let keys = [...row.approverRoleKeys];
      if (row.key === key) {
        keys = keys.includes(roleKey) ? keys.filter((k) => k !== roleKey) : [...keys, roleKey];
      }
      settings[row.key] = { approverRoleKeys: keys };
    }
    saveM.mutate(settings);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who can approve high-risk actions</CardTitle>
        <CardDescription>
          The workspace owner can always approve — that can't be turned off.
          {!canManage && " You have read-only access."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row: any) => (
          <div key={row.key} className="rounded-lg border p-3">
            <div className="mb-2 text-sm font-medium">{APPROVAL_LABELS[row.key] ?? row.key}</div>
            <div className="flex flex-wrap gap-2">
              {ROLE_KEYS.filter((r) => r !== "suspended" && r !== "viewer" && r !== "reports_only").map(
                (r) => {
                  const active = row.approverRoleKeys.includes(r);
                  return (
                    <Button
                      key={r}
                      variant={active ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      disabled={!canManage || saveM.isPending || r === "owner"}
                      onClick={() => toggleRole(row.key, r)}
                    >
                      {ROLE_LABELS[r as RoleKey]}
                    </Button>
                  );
                },
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardContent className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  );
}

// ── Email provider tab (Task #370 — custom_email_provider package feature) ──

function EmailProviderTab() {
  const qc = useQueryClient();
  const getFn = useServerFn(getEmailProviderSettings);
  const saveFn = useServerFn(saveEmailProviderSettings);
  const testFn = useServerFn(sendEmailProviderTest);

  const settingsQ = useQuery({
    queryKey: ["email-provider-settings"],
    queryFn: () => getFn(),
    throwOnError: false,
  });

  const [form, setForm] = useState<null | {
    sendingMode: "platform_default" | "custom";
    fromName: string;
    fromEmail: string;
    replyToEmail: string;
    apiKey: string;
    isActive: boolean;
    fallbackToPlatform: boolean;
  }>(null);
  const [testTo, setTestTo] = useState("");

  const s = settingsQ.data;
  const view = form ?? (s
    ? {
        sendingMode: s.sendingMode,
        fromName: s.fromName ?? "",
        fromEmail: s.fromEmail ?? "",
        replyToEmail: s.replyToEmail ?? "",
        apiKey: "",
        isActive: s.isActive,
        fallbackToPlatform: s.fallbackToPlatform,
      }
    : null);

  const saveM = useMutation({
    mutationFn: (input: any) => saveFn({ data: input }),
    onSuccess: () => {
      setForm(null);
      qc.invalidateQueries({ queryKey: ["email-provider-settings"] });
      toast.success("Email provider settings saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save settings"),
  });
  const testM = useMutation({
    mutationFn: (to: string) => testFn({ data: { to } }),
    onSuccess: (res: any) => {
      if (res?.success) {
        toast.success(
          `Test email sent via ${res.providerUsed === "platform_default" ? "the WEBEE default sender" : "your custom provider"}${res.fellBack ? " (custom provider failed — fell back)" : ""}`,
        );
      } else {
        toast.error(`Test send failed: ${res?.error ?? "unknown error"}`);
      }
      qc.invalidateQueries({ queryKey: ["email-provider-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Test send failed"),
  });

  if (settingsQ.isError) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Email provider settings are not available for this workspace or your role.
        </CardContent>
      </Card>
    );
  }

  if (settingsQ.isLoading || !view) return <LoadingCard />;

  const set = (patch: Partial<NonNullable<typeof form>>) => setForm({ ...view, ...patch });
  const custom = view.sendingMode === "custom";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email sending</CardTitle>
          <CardDescription>
            By default, automated emails (invites, campaign notifications, lead emails) are sent
            from the WEBEE platform sender. Switch to a custom Resend account to send from your
            own domain. Priority: your custom provider → your reseller's provider (if inherited)
            → WEBEE default.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label>Sending mode</Label>
            <Select
              value={view.sendingMode}
              onValueChange={(v) => set({ sendingMode: v as "platform_default" | "custom" })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="platform_default">WEBEE default sender</SelectItem>
                <SelectItem value="custom">Custom provider (Resend)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {custom && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>From name</Label>
                  <Input
                    value={view.fromName}
                    onChange={(e) => set({ fromName: e.target.value })}
                    placeholder="Acme Ltd"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>From email</Label>
                  <Input
                    value={view.fromEmail}
                    onChange={(e) => set({ fromEmail: e.target.value })}
                    placeholder="notifications@yourdomain.com"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Reply-to email (optional)</Label>
                  <Input
                    value={view.replyToEmail}
                    onChange={(e) => set({ replyToEmail: e.target.value })}
                    placeholder="support@yourdomain.com"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Resend API key</Label>
                  <Input
                    type="password"
                    value={view.apiKey}
                    onChange={(e) => set({ apiKey: e.target.value })}
                    placeholder={s?.apiKeyHint ? `Saved (${s.apiKeyHint}) — enter to replace` : "re_..."}
                  />
                  <p className="text-xs text-muted-foreground">
                    Stored encrypted and never shown again. Leave blank to keep the saved key.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">Active</div>
                  <div className="text-xs text-muted-foreground">
                    When off, everything sends via the WEBEE default.
                  </div>
                </div>
                <Switch checked={view.isActive} onCheckedChange={(v) => set({ isActive: v })} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">Fall back to WEBEE default on failure</div>
                  <div className="text-xs text-muted-foreground">
                    If your provider fails, deliver via the WEBEE sender instead of dropping the email.
                  </div>
                </div>
                <Switch
                  checked={view.fallbackToPlatform}
                  onCheckedChange={(v) => set({ fallbackToPlatform: v })}
                />
              </div>
              {s?.exists && (
                <div className="text-xs text-muted-foreground">
                  Domain status: <Badge variant="outline">{s.domainStatus}</Badge>
                  {s.lastSendStatus && (
                    <span className="ml-3">
                      Last send: {s.lastSendStatus}
                      {s.lastSendAt ? ` at ${new Date(s.lastSendAt).toLocaleString()}` : ""}
                      {s.lastSendStatus === "failed" && s.lastSendError ? ` — ${s.lastSendError}` : ""}
                    </span>
                  )}
                  {(s.consecutiveFailures ?? 0) > 0 && (
                    <span className="ml-3 text-destructive">
                      {s.consecutiveFailures} consecutive failure{s.consecutiveFailures === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          <div className="flex gap-2">
            <Button
              onClick={() =>
                saveM.mutate({
                  sendingMode: view.sendingMode,
                  fromName: view.fromName || null,
                  fromEmail: view.fromEmail || null,
                  replyToEmail: view.replyToEmail || null,
                  apiKey: view.apiKey || null,
                  isActive: custom ? view.isActive : false,
                  fallbackToPlatform: view.fallbackToPlatform,
                })
              }
              disabled={saveM.isPending || !form}
            >
              {saveM.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send a test email</CardTitle>
          <CardDescription>
            Sends through the currently effective provider (saved settings, not unsaved edits).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="grid gap-2">
            <Label>Recipient</Label>
            <Input
              className="w-64"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@yourdomain.com"
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => testM.mutate(testTo)}
            disabled={testM.isPending || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo)}
          >
            {testM.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Send test
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
