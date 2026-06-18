/**
 * Webuyanyhouse — Calls & Scheduling
 * Section 1: Call output table.
 * Section 2: Call frequency scheduling with friendly builder + cron output.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import {
  Phone, Calendar, Plus, Mic, FileText, Clock, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  getWbahCallOutput, getWbahFrequency, addWbahFrequency,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import {
  WbahPage, WbahCard, WbahLoading, WbahError, WbahEmpty,
  WbahTable, WbahTr, WbahTd, StatusBadge, SentimentBadge,
  safeArr, formatDate,
} from "@/components/wbah/WbahShell";

export const Route = createFileRoute("/_authenticated/wbah/calls")({
  component: WbahCalls,
});

// ── Friendly schedule builder ─────────────────────────────────────────────────

type ScheduleMode =
  | "daily"
  | "weekdays"
  | "hourly"
  | "custom";

function buildCron(mode: ScheduleMode, time: string, interval: string, custom: string): string {
  if (mode === "custom") return custom;
  const [hh = "9", mm = "0"] = time.split(":");
  if (mode === "daily")    return `${mm} ${hh} * * *`;
  if (mode === "weekdays") return `${mm} ${hh} * * 1-5`;
  if (mode === "hourly")   return `0 */${interval || "2"} * * *`;
  return custom;
}

const FRIENDLY: { label: string; value: ScheduleMode }[] = [
  { label: "Every day at a set time",     value: "daily" },
  { label: "Every weekday at a set time", value: "weekdays" },
  { label: "Every N hours",               value: "hourly" },
  { label: "Custom cron expression",      value: "custom" },
];

function ScheduleBuilder({
  onSave, onClose,
}: {
  onSave: (payload: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ScheduleMode>("daily");
  const [time, setTime] = useState("09:00");
  const [interval, setInterval] = useState("2");
  const [custom, setCustom] = useState("0 9 * * *");
  const [label, setLabel] = useState("");

  const cron = buildCron(mode, time, interval, custom);

  return (
    <div className="space-y-4 py-2">
      <div>
        <label className="text-xs text-gray-400">Schedule Pattern</label>
        <div className="mt-1 grid grid-cols-1 gap-1.5">
          {FRIENDLY.map((f) => (
            <button
              key={f.value}
              onClick={() => setMode(f.value)}
              className={`text-left px-3 py-2 rounded-lg text-sm border transition-colors ${
                mode === f.value
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                  : "border-gray-700 text-gray-400 hover:border-gray-600"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {(mode === "daily" || mode === "weekdays") && (
        <div>
          <label className="text-xs text-gray-400">Time</label>
          <Input
            type="time"
            className="mt-1 bg-gray-900 border-gray-700 text-white text-sm"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
      )}

      {mode === "hourly" && (
        <div>
          <label className="text-xs text-gray-400">Every N hours</label>
          <Input
            type="number"
            min={1}
            max={24}
            className="mt-1 bg-gray-900 border-gray-700 text-white text-sm"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          />
        </div>
      )}

      {mode === "custom" && (
        <div>
          <label className="text-xs text-gray-400">Cron Expression</label>
          <Input
            className="mt-1 bg-gray-900 border-gray-700 text-white font-mono text-sm"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </div>
      )}

      <div>
        <label className="text-xs text-gray-400">Label (optional)</label>
        <Input
          className="mt-1 bg-gray-900 border-gray-700 text-white text-sm"
          placeholder="e.g. Morning Calls"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      <div className="rounded-lg bg-gray-900 border border-gray-800 px-3 py-2">
        <p className="text-[10px] text-gray-500 uppercase tracking-wide">Generated cron</p>
        <p className="font-mono text-sm text-emerald-400 mt-1">{cron}</p>
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="outline" className="border-gray-700 text-gray-300" onClick={onClose}>Cancel</Button>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={() => onSave({ cron, label, mode, time, interval })}
        >
          Save Schedule
        </Button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function WbahCalls() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"calls" | "scheduling">("calls");
  const [addSched, setAddSched] = useState(false);

  const callsFn  = useServerFn(getWbahCallOutput);
  const schedFn  = useServerFn(getWbahFrequency);
  const addSchedFn = useServerFn(addWbahFrequency);

  const { data: callsRaw, isLoading: callsLoading, error: callsErr } = useQuery({
    queryKey: ["wbah-calls"],
    queryFn: () => callsFn(),
    staleTime: 60_000,
  });

  const { data: schedRaw, isLoading: schedLoading, error: schedErr } = useQuery({
    queryKey: ["wbah-schedules"],
    queryFn: () => schedFn({ data: {} }),
    staleTime: 60_000,
    enabled: tab === "scheduling",
  });

  const addSchedMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => addSchedFn({ data: payload }),
    onSuccess: () => { toast.success("Schedule added"); setAddSched(false); qc.invalidateQueries({ queryKey: ["wbah-schedules"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to add schedule"),
  });

  const calls     = safeArr(callsRaw);
  const schedules = safeArr(schedRaw);

  return (
    <WbahPage
      title="Calls & Scheduling"
      subtitle="Call output history and outbound call frequency scheduling"
      actions={
        tab === "scheduling" ? (
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs gap-1.5"
            onClick={() => setAddSched(true)}
          >
            <Plus className="h-3 w-3" /> Add Schedule
          </Button>
        ) : undefined
      }
    >
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg w-fit">
        {(["calls", "scheduling"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === t ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            {t === "calls" ? `Call Output (${calls.length})` : "Scheduling"}
          </button>
        ))}
      </div>

      {/* ── Call Output Tab ── */}
      {tab === "calls" && (
        <>
          {callsErr && <WbahError message={(callsErr as Error).message} />}
          {callsLoading ? (
            <WbahLoading label="Loading call output…" />
          ) : calls.length === 0 ? (
            <WbahEmpty label="No call records found" />
          ) : (
            <WbahTable headers={["Name", "Phone", "Status", "Outcome", "Duration", "Sentiment", "Recording", "Transcript", "Date"]}>
              {calls.map((c: any, i) => {
                const name   = c.name ?? c.fullName ?? "Unknown";
                const phone  = c.phone ?? c.phoneNumber ?? "—";
                const dur    = c.duration ?? c.durationSeconds;
                const hasRec = !!(c.recording ?? c.recordingUrl);
                const hasTr  = !!(c.transcript ?? c.transcriptUrl);

                return (
                  <WbahTr key={c._id ?? c.id ?? i}>
                    <WbahTd><span className="font-medium text-white">{name}</span></WbahTd>
                    <WbahTd className="font-mono text-xs">{phone}</WbahTd>
                    <WbahTd><StatusBadge status={c.status ?? c.callStatus} /></WbahTd>
                    <WbahTd className="text-xs">{c.outcome ?? c.callOutcome ?? "—"}</WbahTd>
                    <WbahTd className="text-xs">{dur ? `${dur}s` : "—"}</WbahTd>
                    <WbahTd><SentimentBadge sentiment={c.sentiment} /></WbahTd>
                    <WbahTd>
                      {hasRec ? (
                        <a href={c.recording ?? c.recordingUrl} target="_blank" rel="noreferrer"
                          className="text-purple-400 hover:text-purple-300 text-xs flex items-center gap-1">
                          <Mic className="h-3 w-3" /> Play
                        </a>
                      ) : <span className="text-gray-600 text-xs">—</span>}
                    </WbahTd>
                    <WbahTd>
                      {hasTr ? (
                        <span className="text-blue-400 text-xs flex items-center gap-1 cursor-pointer">
                          <FileText className="h-3 w-3" /> View
                        </span>
                      ) : <span className="text-gray-600 text-xs">—</span>}
                    </WbahTd>
                    <WbahTd className="text-xs">{formatDate(c.calledAt ?? c.createdAt ?? c.date)}</WbahTd>
                  </WbahTr>
                );
              })}
            </WbahTable>
          )}
        </>
      )}

      {/* ── Scheduling Tab ── */}
      {tab === "scheduling" && (
        <>
          {schedErr && <WbahError message={(schedErr as Error).message} />}
          {schedLoading ? (
            <WbahLoading label="Loading schedules…" />
          ) : schedules.length === 0 ? (
            <WbahEmpty label="No schedules yet — add one to automate calling times" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {schedules.map((s: any, i) => (
                <div key={s._id ?? s.id ?? i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="text-white font-medium text-sm">{s.label ?? s.name ?? `Schedule ${i + 1}`}</span>
                  </div>
                  <div className="font-mono text-xs text-emerald-400 bg-gray-800 rounded px-2 py-1">
                    {s.cron ?? s.cronExpression ?? s.frequency ?? "—"}
                  </div>
                  {s.mode && <div className="text-xs text-gray-500">Mode: {s.mode}</div>}
                  {s.nextRun && (
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Next: {formatDate(s.nextRun)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Add Schedule modal */}
      <Dialog open={addSched} onOpenChange={setAddSched}>
        <DialogContent className="bg-gray-950 border-gray-800 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Call Schedule</DialogTitle>
          </DialogHeader>
          <ScheduleBuilder
            onSave={(p) => addSchedMutation.mutate(p)}
            onClose={() => setAddSched(false)}
          />
        </DialogContent>
      </Dialog>
    </WbahPage>
  );
}
