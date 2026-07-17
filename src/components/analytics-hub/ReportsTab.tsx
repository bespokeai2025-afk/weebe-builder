import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  FileText, Plus, Send, Eye, Trash2, Clock, X, Search, Settings2,
} from "lucide-react";
import {
  listAnalyticsReports, getAnalyticsReport, generateReportNow, sendReport,
  listReportSchedules, createReportSchedule, updateReportSchedule, deleteReportSchedule,
} from "@/lib/analytics-hub/reports.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { EmptyState, TableHead, Th } from "@/components/dashboard/PageShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  type AnalyticsFilterState, filterPayload, filterKey, ChartCard, CHART, shortDay,
} from "./shared";

const REPORT_TYPES: Array<{ key: string; label: string }> = [
  { key: "campaign_kpi",           label: "Campaign KPI" },
  { key: "campaign_completion",    label: "Campaign Completion" },
  { key: "daily_campaign_summary", label: "Daily Campaign Summary" },
  { key: "weekly_workspace",       label: "Weekly Workspace" },
  { key: "monthly_roi",            label: "Monthly ROI" },
  { key: "agent_performance",      label: "Agent Performance" },
  { key: "lead_source",            label: "Lead Source" },
  { key: "workflow_failure",       label: "Workflow Failures" },
  { key: "follow_up_performance",  label: "Follow-up Performance" },
  { key: "accountsmind_cost",      label: "Cost / AccountsMind" },
  { key: "wbah_dialler_summary",   label: "Dialler Success & KPIs" },
];
// WBAH-only kinds generated automatically by the campaign run tick — shown in
// the report list (labels) but not offered in the generate/schedule pickers.
const AUTO_TYPE_LABELS: Record<string, string> = {
  wbah_campaign_start: "Campaign Started",
  wbah_campaign_end:   "Campaign Finished",
};
const TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(REPORT_TYPES.map((t) => [t.key, t.label])),
  ...AUTO_TYPE_LABELS,
};

const FREQUENCIES = ["daily", "weekly", "monthly", "custom"] as const;

// Campaign-lifecycle kinds are refused by the report generator for the WBAH
// workspace (WBAH has its own dialler report kinds), so don't offer them there.
const CAMPAIGN_LIFECYCLE_KEYS = new Set([
  "campaign_launch",
  "campaign_failure",
  "campaign_completion",
  "campaign_kpi",
  "daily_campaign_summary",
]);

export function ReportsTab({
  filter,
  canGenerate,
  canSchedule,
  canEmail,
  isWbah = false,
}: {
  filter: AnalyticsFilterState;
  canGenerate: boolean;
  canSchedule: boolean;
  canEmail: boolean;
  isWbah?: boolean;
}) {
  const reportTypes = useMemo(
    () =>
      REPORT_TYPES.filter((t) => {
        if (t.key === "wbah_dialler_summary") return isWbah;
        if (isWbah && CAMPAIGN_LIFECYCLE_KEYS.has(t.key)) return false;
        return true;
      }),
    [isWbah],
  );
  const qc = useQueryClient();
  const listFn = useServerFn(listAnalyticsReports);
  const getFn = useServerFn(getAnalyticsReport);
  const genFn = useServerFn(generateReportNow);
  const sendFn = useServerFn(sendReport);
  const listSchedFn = useServerFn(listReportSchedules);
  const createSchedFn = useServerFn(createReportSchedule);
  const updateSchedFn = useServerFn(updateReportSchedule);
  const deleteSchedFn = useServerFn(deleteReportSchedule);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [viewId, setViewId] = useState<string | null>(null);
  const [showGen, setShowGen] = useState(false);
  const [showSched, setShowSched] = useState(false);

  const reportsQ = useQuery({
    queryKey: ["analytics-reports", search, typeFilter],
    queryFn: () => listFn({ data: { search: search || null, reportType: typeFilter || null, limit: 100 } }),
    staleTime: 30_000,
    throwOnError: false,
  });
  const schedQ = useQuery({
    queryKey: ["analytics-report-schedules"],
    queryFn: () => listSchedFn(),
    staleTime: 30_000,
    throwOnError: false,
  });
  const viewQ = useQuery({
    queryKey: ["analytics-report", viewId],
    queryFn: () => getFn({ data: { id: viewId! } }),
    enabled: !!viewId,
    throwOnError: false,
  });

  const genMut = useMutation({
    mutationFn: (input: any) => genFn({ data: input }),
    onSuccess: (r: any) => {
      if (r?.ok) { toast.success("Report generated"); qc.invalidateQueries({ queryKey: ["analytics-reports"] }); setShowGen(false); }
      else toast.error(`Generation failed: ${r?.error ?? "unknown"}`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Generation failed"),
  });
  const sendMut = useMutation({
    mutationFn: (input: { reportId: string; recipients: string[] }) => sendFn({ data: input }),
    onSuccess: (r: any) => { if (r?.ok !== false) toast.success("Report sent"); else toast.error(`Send failed: ${r?.error ?? "unknown"}`); },
    onError: (e: any) => toast.error(e?.message ?? "Send failed"),
  });
  const createSchedMut = useMutation({
    mutationFn: (input: any) => createSchedFn({ data: input }),
    onSuccess: () => { toast.success("Schedule created"); qc.invalidateQueries({ queryKey: ["analytics-report-schedules"] }); setShowSched(false); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create schedule"),
  });
  const updateSchedMut = useMutation({
    mutationFn: (input: any) => updateSchedFn({ data: input }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["analytics-report-schedules"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update schedule"),
  });
  const deleteSchedMut = useMutation({
    mutationFn: (id: string) => deleteSchedFn({ data: { id } }),
    onSuccess: () => { toast.success("Schedule deleted"); qc.invalidateQueries({ queryKey: ["analytics-report-schedules"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to delete schedule"),
  });

  const reports: any[] = (reportsQ.data as any)?.reports ?? [];
  const schedules: any[] = (schedQ.data as any)?.schedules ?? [];

  return (
    <div className="space-y-5 px-6 pt-5">
      {isWbah && (
        <DiallerReportSetup
          schedules={schedules}
          loading={schedQ.isLoading}
          canSchedule={canSchedule}
          onCreate={(v: any) => createSchedMut.mutate(v)}
          onUpdate={(v: any) => updateSchedMut.mutate(v)}
          pending={createSchedMut.isPending || updateSchedMut.isPending}
        />
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports…"
              className="rounded-lg border border-white/[0.1] bg-card/60 py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-white/[0.1] bg-card/60 px-2.5 py-1.5 text-sm text-foreground"
          >
            <option value="">All types</option>
            {reportTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          {canSchedule && (
            <Button size="sm" variant="outline" onClick={() => setShowSched(true)}><Clock className="mr-1.5 h-3.5 w-3.5" />New schedule</Button>
          )}
          {canGenerate && (
            <Button size="sm" onClick={() => setShowGen(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Generate report</Button>
          )}
        </div>
      </div>

      {/* Reports list */}
      <ChartCard title="Reports" icon={FileText} color={CHART.primary}>
        {reportsQ.isLoading ? (
          <LoadingProgress label="Loading reports" estimatedMs={5000} />
        ) : reports.length === 0 ? (
          <EmptyState icon={FileText} title="No reports yet" message="Generate a report to see it here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Name</Th><Th>Type</Th><Th>Status</Th><Th>Created</Th><Th />
              </TableHead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="h-11 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 font-medium">{r.report_name}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{TYPE_LABEL[r.report_type] ?? r.report_type}</td>
                    <td className="px-3 py-2.5"><Badge className="capitalize">{r.report_status}</Badge></td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{shortDay(r.created_at)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setViewId(r.id)}><Eye className="h-3.5 w-3.5" /></Button>
                        {canEmail && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={sendMut.isPending}
                            onClick={() => {
                              const to = window.prompt("Recipient email(s), comma-separated:");
                              if (!to) return;
                              const recipients = to.split(",").map((s) => s.trim()).filter(Boolean);
                              if (recipients.length === 0) return;
                              sendMut.mutate({ reportId: r.id, recipients });
                            }}
                          >
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      {/* Schedules */}
      <ChartCard title="Scheduled Reports" icon={Clock} color={CHART.accent}>
        {schedQ.isLoading ? (
          <LoadingProgress label="Loading schedules" estimatedMs={4000} />
        ) : schedules.length === 0 ? (
          <EmptyState icon={Clock} title="No schedules" message="Create a schedule to auto-generate reports." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Name</Th><Th>Type</Th><Th>Frequency</Th><Th>Recipients</Th><Th>Enabled</Th><Th />
              </TableHead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} className="h-11 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 font-medium">{s.name}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{TYPE_LABEL[s.report_type] ?? s.report_type}</td>
                    <td className="px-3 py-2.5 text-xs capitalize">{s.frequency}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{(s.recipients_json ?? []).length}</td>
                    <td className="px-3 py-2.5">
                      <button
                        disabled={!canSchedule || updateSchedMut.isPending}
                        onClick={() => updateSchedMut.mutate({ id: s.id, enabled: !s.enabled })}
                        className="text-xs text-primary hover:underline disabled:opacity-50"
                      >
                        {s.enabled ? "On" : "Off"}
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      {canSchedule && (
                        <div className="flex justify-end">
                          <Button size="sm" variant="ghost" disabled={deleteSchedMut.isPending} onClick={() => { if (window.confirm("Delete this schedule?")) deleteSchedMut.mutate(s.id); }}>
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      {viewId && <ReportViewModal q={viewQ} onClose={() => setViewId(null)} />}
      {showGen && <GenerateModal reportTypes={reportTypes} onClose={() => setShowGen(false)} onSubmit={(v) => genMut.mutate({ ...v, ...filterPayload(filter) })} pending={genMut.isPending} />}
      {showSched && <ScheduleModal reportTypes={reportTypes} onClose={() => setShowSched(false)} onSubmit={(v) => createSchedMut.mutate(v)} pending={createSchedMut.isPending} />}
    </div>
  );
}

/**
 * WBAH-only setup card: tailor which automatic dialler reports get emailed and
 * to whom. Campaign start/finish preferences are stored as schedule rows of
 * type wbah_campaign_start / wbah_campaign_end (event-driven — the periodic
 * schedule sweep skips them; the campaign run tick reads them). The recurring
 * summary row (wbah_dialler_summary) is managed here too (daily or weekly).
 */
function DiallerReportSetup({
  schedules,
  loading,
  canSchedule,
  onCreate,
  onUpdate,
  pending,
}: {
  schedules: any[];
  loading: boolean;
  canSchedule: boolean;
  onCreate: (v: any) => void;
  onUpdate: (v: any) => void;
  pending: boolean;
}) {
  const startRow = schedules.find((s) => s.report_type === "wbah_campaign_start") ?? null;
  const endRow = schedules.find((s) => s.report_type === "wbah_campaign_end") ?? null;
  const summaryRow = schedules.find((s) => s.report_type === "wbah_dialler_summary") ?? null;
  const fallbackRecipients: string[] = Array.isArray(summaryRow?.recipients_json) ? summaryRow.recipients_json : [];

  return (
    <ChartCard title="Dialler Report Setup" icon={Settings2} color={CHART.accent}>
      {loading ? (
        <LoadingProgress label="Loading report settings" estimatedMs={4000} />
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Choose which dialler campaign reports are emailed automatically, and to whom. Campaign start and finish emails are sent the moment a scheduled dialler run begins or completes.
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <EventPrefTile
              label="When a campaign starts"
              description="A short heads-up email when a scheduled dialler run begins."
              row={startRow}
              reportType="wbah_campaign_start"
              defaultName="Campaign start email"
              fallbackRecipients={fallbackRecipients}
              canSchedule={canSchedule}
              onCreate={onCreate}
              onUpdate={onUpdate}
              pending={pending}
            />
            <EventPrefTile
              label="When a campaign finishes"
              description="Full KPI report emailed as soon as a run completes."
              row={endRow}
              reportType="wbah_campaign_end"
              defaultName="Campaign finish email"
              fallbackRecipients={fallbackRecipients}
              canSchedule={canSchedule}
              onCreate={onCreate}
              onUpdate={onUpdate}
              pending={pending}
            />
            <SummaryPrefTile
              row={summaryRow}
              canSchedule={canSchedule}
              onCreate={onCreate}
              onUpdate={onUpdate}
              pending={pending}
            />
          </div>
        </div>
      )}
    </ChartCard>
  );
}

function PrefToggle({ on, disabled, onClick }: { on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-primary" : "bg-white/[0.12]"}`}
      aria-pressed={on}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function RecipientsEditor({
  value,
  placeholder,
  disabled,
  onSave,
  pending,
}: {
  value: string[];
  placeholder: string;
  disabled: boolean;
  onSave: (recipients: string[]) => void;
  pending: boolean;
}) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => { setText(value.join(", ")); }, [value.join(",")]);
  const parsed = useMemo(() => text.split(",").map((s) => s.trim()).filter(Boolean), [text]);
  const dirty = parsed.join(",") !== value.join(",");
  return (
    <div className="space-y-1.5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-lg border border-white/[0.1] bg-card/60 px-2.5 py-1.5 text-xs disabled:opacity-50"
      />
      {dirty && !disabled && (
        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={pending} onClick={() => onSave(parsed)}>
          {pending ? "Saving…" : "Save recipients"}
        </Button>
      )}
    </div>
  );
}

function EventPrefTile({
  label, description, row, reportType, defaultName, fallbackRecipients,
  canSchedule, onCreate, onUpdate, pending,
}: {
  label: string;
  description: string;
  row: any | null;
  reportType: string;
  defaultName: string;
  fallbackRecipients: string[];
  canSchedule: boolean;
  onCreate: (v: any) => void;
  onUpdate: (v: any) => void;
  pending: boolean;
}) {
  // No row yet = emails ON by default (they go to the daily summary recipients).
  const enabled = row ? !!row.enabled : true;
  const recipients: string[] = row && Array.isArray(row.recipients_json) ? row.recipients_json : [];
  const ensureRow = (patch: { enabled?: boolean; recipients?: string[] }) => {
    if (row) onUpdate({ id: row.id, ...patch });
    else {
      onCreate({
        reportType,
        name: defaultName,
        frequency: "custom",
        scheduleConfig: { event: true },
        recipients: patch.recipients ?? fallbackRecipients,
        enabled: patch.enabled ?? true,
      });
    }
  };
  return (
    <div className="rounded-xl border border-white/[0.08] bg-card/40 p-3.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <PrefToggle on={enabled} disabled={!canSchedule || pending} onClick={() => ensureRow({ enabled: !enabled })} />
      </div>
      <p className="mb-2.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
      <RecipientsEditor
        value={recipients}
        placeholder={fallbackRecipients.length > 0 ? `Default: ${fallbackRecipients.join(", ")}` : "email@example.com"}
        disabled={!canSchedule}
        onSave={(r) => ensureRow({ recipients: r, enabled })}
        pending={pending}
      />
      {!row && recipients.length === 0 && fallbackRecipients.length > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">Currently sent to the daily summary recipients.</p>
      )}
    </div>
  );
}

function SummaryPrefTile({
  row, canSchedule, onCreate, onUpdate, pending,
}: {
  row: any | null;
  canSchedule: boolean;
  onCreate: (v: any) => void;
  onUpdate: (v: any) => void;
  pending: boolean;
}) {
  const enabled = row ? !!row.enabled : false;
  const frequency = row?.frequency === "weekly" ? "weekly" : "daily";
  const recipients: string[] = row && Array.isArray(row.recipients_json) ? row.recipients_json : [];
  const ensureRow = (patch: { enabled?: boolean; recipients?: string[]; frequency?: string }) => {
    if (row) onUpdate({ id: row.id, ...patch });
    else {
      onCreate({
        reportType: "wbah_dialler_summary",
        name: "Dialler Success & KPIs",
        frequency: patch.frequency ?? "daily",
        recipients: patch.recipients ?? [],
        enabled: patch.enabled ?? true,
      });
    }
  };
  return (
    <div className="rounded-xl border border-white/[0.08] bg-card/40 p-3.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Recurring summary</span>
        <PrefToggle on={enabled} disabled={!canSchedule || pending} onClick={() => ensureRow({ enabled: !enabled })} />
      </div>
      <p className="mb-2.5 text-[11px] leading-snug text-muted-foreground">Dialler Success &amp; KPIs report, sent on a schedule.</p>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Send</span>
        <select
          value={frequency}
          disabled={!canSchedule || pending}
          onChange={(e) => ensureRow({ frequency: e.target.value })}
          className="rounded-lg border border-white/[0.1] bg-card/60 px-2 py-1 text-xs capitalize disabled:opacity-50"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>
      <RecipientsEditor
        value={recipients}
        placeholder="email@example.com"
        disabled={!canSchedule}
        onSave={(r) => ensureRow({ recipients: r, enabled })}
        pending={pending}
      />
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.1] bg-popover p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReportViewModal({ q, onClose }: { q: any; onClose: () => void }) {
  const r: any = q.data;
  return (
    <ModalShell title={r?.report_name ?? "Report"} onClose={onClose}>
      {q.isLoading ? (
        <LoadingProgress label="Loading report" estimatedMs={3000} />
      ) : q.error ? (
        <p className="text-sm text-amber-300">Could not load report.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge>{TYPE_LABEL[r.report_type] ?? r.report_type}</Badge>
            <Badge className="capitalize">{r.report_status}</Badge>
            <span className="text-xs text-muted-foreground">{shortDay(r.date_range_start)} → {shortDay(r.date_range_end)}</span>
          </div>
          {r.report_summary && <p className="text-foreground/80">{r.report_summary}</p>}
          {Array.isArray(r.insights_json) && r.insights_json.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Insights</h4>
              <ul className="list-disc pl-4 text-xs text-foreground/70">
                {r.insights_json.map((it: any, i: number) => <li key={i}>{typeof it === "string" ? it : it?.text ?? JSON.stringify(it)}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(r.recommendations_json) && r.recommendations_json.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommendations</h4>
              <ul className="list-disc pl-4 text-xs text-foreground/70">
                {r.recommendations_json.map((it: any, i: number) => <li key={i}>{typeof it === "string" ? it : it?.action ?? JSON.stringify(it)}</li>)}
              </ul>
            </div>
          )}
          {r.metrics_json && (
            <pre className="max-h-56 overflow-auto rounded-lg border border-white/[0.06] bg-card/40 p-3 text-[11px] text-muted-foreground">
              {JSON.stringify(r.metrics_json, null, 2)}
            </pre>
          )}
        </div>
      )}
    </ModalShell>
  );
}

function GenerateModal({ onClose, onSubmit, pending, reportTypes }: { onClose: () => void; onSubmit: (v: any) => void; pending: boolean; reportTypes: Array<{ key: string; label: string }> }) {
  const [reportType, setReportType] = useState(reportTypes[0].key);
  const [name, setName] = useState("");
  return (
    <ModalShell title="Generate report" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Report type</span>
          <select value={reportType} onChange={(e) => setReportType(e.target.value)} className="w-full rounded-lg border border-white/[0.1] bg-card/60 px-3 py-2 text-sm">
            {reportTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-generated if empty" className="w-full rounded-lg border border-white/[0.1] bg-card/60 px-3 py-2 text-sm" />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={pending} onClick={() => onSubmit({ reportType, name: name || null })}>{pending ? "Generating…" : "Generate"}</Button>
        </div>
      </div>
    </ModalShell>
  );
}

function ScheduleModal({ onClose, onSubmit, pending, reportTypes }: { onClose: () => void; onSubmit: (v: any) => void; pending: boolean; reportTypes: Array<{ key: string; label: string }> }) {
  const [reportType, setReportType] = useState(reportTypes[0].key);
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]>("weekly");
  const [recipients, setRecipients] = useState("");
  const recipientList = useMemo(() => recipients.split(",").map((s) => s.trim()).filter(Boolean), [recipients]);
  return (
    <ModalShell title="New report schedule" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly workspace summary" className="w-full rounded-lg border border-white/[0.1] bg-card/60 px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Report type</span>
          <select value={reportType} onChange={(e) => setReportType(e.target.value)} className="w-full rounded-lg border border-white/[0.1] bg-card/60 px-3 py-2 text-sm">
            {reportTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Frequency</span>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as any)} className="w-full rounded-lg border border-white/[0.1] bg-card/60 px-3 py-2 text-sm capitalize">
            {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Recipients (comma-separated emails)</span>
          <input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ops@example.com, cfo@example.com" className="w-full rounded-lg border border-white/[0.1] bg-card/60 px-3 py-2 text-sm" />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={pending || !name.trim()}
            onClick={() => onSubmit({ reportType, name: name.trim(), frequency, recipients: recipientList, enabled: true })}
          >
            {pending ? "Creating…" : "Create schedule"}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
