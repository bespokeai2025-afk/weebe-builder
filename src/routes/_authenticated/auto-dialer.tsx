import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  PhoneOutgoing,
  Play,
  Pause,
  Square,
  Trash2,
  RefreshCw,
  ArrowLeft,
  Users,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createDialerSession,
  listDialerSessions,
  getDialerSession,
  startDialerSession,
  pauseDialerSession,
  cancelDialerSession,
  deleteDialerSession,
  listWorkspacePhoneNumbers,
  getDialerQuickCallDefaults,
} from "@/lib/telephony/auto-dialer.functions";
import { parseDialerTargetList, dedupeDialerTargets, statusLabel } from "@/lib/telephony/auto-dialer.shared";
import {
  autoDetectCsvColumnMapping,
  mapCsvRowsToLeads,
  readSpreadsheetFileHead,
} from "@/lib/whatsapp/csv-leads.shared";

export const Route = createFileRoute("/_authenticated/auto-dialer")({
  head: () => ({ meta: [{ title: "Auto Dialer — Webee" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    session: (search.session as string | undefined) ?? undefined,
  }),
  component: AutoDialerPage,
});

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  dialing: "bg-amber-500/15 text-amber-400",
  ringing: "bg-amber-500/15 text-amber-400",
  bridged: "bg-emerald-500/15 text-emerald-400",
  no_answer: "bg-muted text-muted-foreground",
  busy: "bg-muted text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
  completed: "bg-muted text-muted-foreground",
};

const SESSION_STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  running: "bg-emerald-500/15 text-emerald-400",
  paused: "bg-amber-500/15 text-amber-400",
  completed: "bg-primary/15 text-primary",
  cancelled: "bg-destructive/15 text-destructive",
};

function AutoDialerPage() {
  // Deep-linkable so other pages (Admin → Data) can create a run and send the
  // user straight to it with `/auto-dialer?session=<id>`, and so the browser
  // back button behaves once they're inside one.
  const { session } = Route.useSearch();
  const navigate = Route.useNavigate();

  const openSessionId = session ?? null;
  const setOpenSessionId = (id: string | null) =>
    navigate({ search: (prev) => ({ ...prev, session: id ?? undefined }) });

  return openSessionId ? (
    <SessionDetail sessionId={openSessionId} onBack={() => setOpenSessionId(null)} />
  ) : (
    <SessionList onOpen={setOpenSessionId} />
  );
}

function SessionList({ onOpen }: { onOpen: (id: string) => void }) {
  const listFn = useServerFn(listDialerSessions);
  const deleteFn = useServerFn(deleteDialerSession);
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["dialer-sessions"],
    queryFn: () => listFn(),
    refetchInterval: 8000,
    throwOnError: false,
  });

  const sessions = data?.sessions ?? [];

  async function handleDelete(id: string) {
    if (!confirm("Delete this dialer run? This can't be undone.")) return;
    try {
      await deleteFn({ data: { sessionId: id } });
      toast.success("Run deleted");
      queryClient.invalidateQueries({ queryKey: ["dialer-sessions"] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to delete run");
    }
  }

  if (showCreate) {
    return (
      <CreateSessionForm
        onCancel={() => setShowCreate(false)}
        onCreated={(id) => {
          setShowCreate(false);
          queryClient.invalidateQueries({ queryKey: ["dialer-sessions"] });
          onOpen(id);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Auto Dialer</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Dials a list of numbers one at a time. When one answers, it rings your 2 people at
            once and connects the call to whichever picks up first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <PhoneOutgoing className="h-3.5 w-3.5" />
            New dialer run
          </Button>
        </div>
      </div>

      {sessions.length === 0 && !isFetching ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
          <PhoneOutgoing className="h-10 w-10 opacity-30" />
          <p className="text-sm">No dialer runs yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Name</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-left font-medium">Progress</th>
                <th className="px-4 py-2.5 text-left font-medium">Routes to</th>
                <th className="px-4 py-2.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.map((s: any) => {
                const stats = s.stats ?? {};
                return (
                  <tr
                    key={s.id}
                    className="cursor-pointer hover:bg-muted/20"
                    onClick={() => onOpen(s.id)}
                  >
                    <td className="px-4 py-2.5 font-medium">{s.name}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                          SESSION_STATUS_COLORS[s.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {stats.dialed ?? 0} / {stats.total ?? 0} dialled · {stats.bridged ?? 0} connected
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {(s.route_numbers ?? []).join("  ·  ")}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(s.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateSessionForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const createFn = useServerFn(createDialerSession);
  const numbersFn = useServerFn(listWorkspacePhoneNumbers);
  const defaultsFn = useServerFn(getDialerQuickCallDefaults);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [targetsRaw, setTargetsRaw] = useState("");
  const [route1, setRoute1] = useState("");
  const [route2, setRoute2] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [csvParsing, setCsvParsing] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);

  useQuery({
    queryKey: ["dialer-quick-call-defaults"],
    queryFn: async () => {
      const d = await defaultsFn();
      if (d.routeNumbers) {
        setRoute1((cur) => cur || d.routeNumbers![0]);
        setRoute2((cur) => cur || d.routeNumbers![1]);
      }
      return d;
    },
    throwOnError: false,
  });

  async function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvParsing(true);
    try {
      const { headers, rows } = await readSpreadsheetFileHead(file, 20000);
      const mapping = autoDetectCsvColumnMapping(headers);
      if (!mapping) {
        toast.error("Couldn't find a phone number column in that file", {
          description: `Columns found: ${headers.join(", ") || "none"}`,
        });
        return;
      }
      const leads = mapCsvRowsToLeads(rows, mapping);
      if (leads.length === 0) {
        toast.error("No rows with a usable phone number in that file");
        return;
      }
      const lines = leads.map((l) => (l.full_name ? `${l.full_name}, ${l.phone}` : l.phone));
      setTargetsRaw((cur) => (cur.trim() ? `${cur.trim()}\n${lines.join("\n")}` : lines.join("\n")));
      setCsvFileName(file.name);
      toast.success(`Loaded ${leads.length} number(s) from ${file.name}`);
    } catch (err) {
      toast.error("Could not read that file", { description: (err as Error).message });
    } finally {
      setCsvParsing(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  }

  const { data: numbersData } = useQuery({
    queryKey: ["workspace-phone-numbers"],
    queryFn: () => numbersFn(),
    throwOnError: false,
  });
  const ownedNumbers = numbersData?.numbers ?? [];

  const { targets, errors } = useMemo(() => parseDialerTargetList(targetsRaw), [targetsRaw]);
  const deduped = useMemo(() => dedupeDialerTargets(targets), [targets]);
  const duplicateCount = targets.length - deduped.length;

  async function handleSubmit() {
    if (!name.trim()) return toast.error("Give this run a name");
    if (deduped.length === 0) return toast.error("Add at least one number to call");
    if (errors.length > 0) {
      return toast.error(`${errors.length} line(s) aren't valid numbers — fix them before starting`);
    }
    if (!route1.trim()) {
      return toast.error("Add a number to route answered calls to");
    }
    const route2Trimmed = route2.trim();
    const routeNumbers = route2Trimmed ? [route1.trim(), route2Trimmed] : [route1.trim()];

    setSubmitting(true);
    try {
      const result = await createFn({
        data: {
          name: name.trim(),
          routeNumbers,
          targets: deduped,
          fromNumber: fromNumber || undefined,
        },
      });
      toast.success(`Run created with ${result.targetCount} number(s)`);
      onCreated(result.sessionId);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to create run");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCancel}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold">New dialer run</h1>
      </div>

      <div className="space-y-1.5">
        <Label>Run name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekend callback list" />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Numbers to dial — one per line, or upload a CSV</Label>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={csvParsing}
            onClick={() => csvInputRef.current?.click()}
          >
            <Upload className="h-3 w-3" />
            {csvParsing ? "Reading…" : csvFileName ?? "Upload CSV"}
          </Button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleCsvFile}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Either just the phone number, or "Name, phone" — e.g. <code>Ali, +971501234567</code>. A
          CSV or Excel file with a phone column works too — its rows are added to the list below.
        </p>
        <Textarea
          value={targetsRaw}
          onChange={(e) => setTargetsRaw(e.target.value)}
          rows={8}
          placeholder={"+971501234567\nSara, +971509876543"}
          className="font-mono text-xs"
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          {deduped.length} number{deduped.length === 1 ? "" : "s"} ready to call
          {duplicateCount > 0 && ` · ${duplicateCount} duplicate(s) removed`}
        </div>
        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
            {errors.length} line{errors.length === 1 ? "" : "s"} couldn't be read as a phone number:
            <ul className="mt-1 list-disc pl-4">
              {errors.slice(0, 5).map((e) => (
                <li key={e.line}>
                  Line {e.line}: "{e.raw}"
                </li>
              ))}
              {errors.length > 5 && <li>…and {errors.length - 5} more</li>}
            </ul>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Route answered calls to</Label>
        <p className="text-xs text-muted-foreground">
          When someone on the list picks up, the call connects here. Add a second number to ring
          both at once — whichever answers first gets connected.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input value={route1} onChange={(e) => setRoute1(e.target.value)} placeholder="+971585248237" />
          <Input
            value={route2}
            onChange={(e) => setRoute2(e.target.value)}
            placeholder="+971501234567 (optional)"
          />
        </div>
      </div>

      {ownedNumbers.length > 1 && (
        <div className="space-y-1.5">
          <Label>Call from</Label>
          <select
            value={fromNumber}
            onChange={(e) => setFromNumber(e.target.value)}
            className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Default workspace number</option>
            {ownedNumbers.map((n: any) => (
              <option key={n.id} value={n.phone_number}>
                {n.friendly_name ? `${n.friendly_name} — ${n.phone_number}` : n.phone_number}
              </option>
            ))}
          </select>
        </div>
      )}
      {ownedNumbers.length === 0 && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-500">
          This workspace has no active phone number yet — add one under Telephony → Phone Numbers
          before starting a run.
        </p>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Creating…" : "Create run"}
        </Button>
      </div>
    </div>
  );
}

function SessionDetail({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const getFn = useServerFn(getDialerSession);
  const startFn = useServerFn(startDialerSession);
  const pauseFn = useServerFn(pauseDialerSession);
  const cancelFn = useServerFn(cancelDialerSession);
  const queryClient = useQueryClient();

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["dialer-session", sessionId],
    queryFn: () => getFn({ data: { sessionId } }),
    refetchInterval: 4000,
    throwOnError: false,
  });

  const session = data?.session;
  const targets = data?.targets ?? [];

  async function run(action: "start" | "pause" | "cancel") {
    try {
      if (action === "start") await startFn({ data: { sessionId } });
      if (action === "pause") await pauseFn({ data: { sessionId } });
      if (action === "cancel") {
        if (!confirm("Cancel this run? Any numbers not yet dialled will be skipped.")) return;
        await cancelFn({ data: { sessionId } });
      }
      queryClient.invalidateQueries({ queryKey: ["dialer-session", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["dialer-sessions"] });
    } catch (e: any) {
      toast.error(e.message ?? "Action failed");
    }
  }

  if (!session) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      </div>
    );
  }

  const stats = session.stats ?? {};

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{session.name}</h1>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                  SESSION_STATUS_COLORS[session.status] ?? "bg-muted text-muted-foreground"
                }`}
              >
                {session.status}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Calling from {session.from_number} · routing to {(session.route_numbers ?? []).join(" · ")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          {(session.status === "draft" || session.status === "paused") && (
            <Button size="sm" onClick={() => run("start")}>
              <Play className="h-3.5 w-3.5" />
              {session.status === "paused" ? "Resume" : "Start"}
            </Button>
          )}
          {session.status === "running" && (
            <Button size="sm" variant="outline" onClick={() => run("pause")}>
              <Pause className="h-3.5 w-3.5" />
              Pause
            </Button>
          )}
          {(session.status === "running" || session.status === "paused" || session.status === "draft") && (
            <Button size="sm" variant="outline" onClick={() => run("cancel")}>
              <Square className="h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total", value: stats.total ?? 0 },
          { label: "Dialled", value: stats.dialed ?? 0 },
          { label: "Connected", value: stats.bridged ?? 0 },
          { label: "No answer / failed", value: (stats.no_answer ?? 0) + (stats.failed ?? 0) },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
            <p className="mt-1 text-2xl font-bold">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">#</th>
              <th className="px-4 py-2.5 text-left font-medium">Name</th>
              <th className="px-4 py-2.5 text-left font-medium">Phone</th>
              <th className="px-4 py-2.5 text-left font-medium">Status</th>
              <th className="px-4 py-2.5 text-left font-medium">Answered by</th>
              <th className="px-4 py-2.5 text-left font-medium">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {targets.map((t: any) => (
              <tr key={t.id}>
                <td className="px-4 py-2 text-muted-foreground">{t.position + 1}</td>
                <td className="px-4 py-2">{t.name || "—"}</td>
                <td className="px-4 py-2 font-mono text-xs">{t.phone}</td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_COLORS[t.status] ?? "bg-muted text-muted-foreground"
                    }`}
                  >
                    {statusLabel(t.status)}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                  {t.bridged_number || "—"}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {t.duration_secs ? `${t.duration_secs}s` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
