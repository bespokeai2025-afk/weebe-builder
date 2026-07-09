import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck,
  Loader2,
  CalendarClock,
  Clock,
  Phone,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { getCustomAgentConfigFn } from "@/lib/systemmind/custom-agent.functions";

export type CallAgentOption = {
  id: string;
  name: string;
  phoneNumber?: string | null;
};

export interface StartCallsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Number of selected leads/records this dialog will act on. */
  count: number;
  /** Singular noun used in copy, e.g. "lead" or "record". */
  entityLabel?: string;
  title?: string;
  agents: CallAgentOption[];
  defaultAgentId?: string;
  noAgentsMessage?: string;
  /** Small print shown at the bottom of the dialog (e.g. daily limit notice). */
  footerNote?: string;
  /** Extra hint shown only when "Schedule for later" is toggled on. */
  scheduleHint?: string;
  /** Set false to hide the "Schedule for later" toggle entirely. */
  allowSchedule?: boolean;
  onStart: (args: { agentId: string; fromNumber: string | null }) => Promise<void>;
  onSchedule?: (args: {
    agentId: string;
    fromNumber: string | null;
    scheduledAtIso: string;
  }) => Promise<void>;
}

export function StartCallsDialog({
  open,
  onOpenChange,
  count,
  entityLabel = "lead",
  title = "Assign Qualification Agent",
  agents,
  defaultAgentId,
  noAgentsMessage = "No live Client Qualification agents found. Build and go-live with a qualification agent in the Builder first.",
  footerNote,
  scheduleHint,
  allowSchedule = true,
  onStart,
  onSchedule,
}: StartCallsDialogProps) {
  const [agentId, setAgentId] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [running, setRunning] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  const getCustomConfigFn = useServerFn(getCustomAgentConfigFn);
  const customConfigQ = useQuery({
    queryKey: ["custom-agent-config", agentId],
    queryFn: () => getCustomConfigFn({ data: { agentId } }),
    enabled: showSetup && !!agentId,
    staleTime: 5 * 60_000,
    throwOnError: false,
  });

  useEffect(() => {
    if (!open) return;
    const initial =
      defaultAgentId && agents.some((a) => a.id === defaultAgentId)
        ? defaultAgentId
        : agents[0]?.id ?? "";
    setAgentId(initial);
    setFromNumber(agents.find((a) => a.id === initial)?.phoneNumber ?? "");
    setSchedule(false);
    setScheduledAt("");
    setShowSetup(false);
    setRunning(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultAgentId]);

  function handleAgentChange(v: string) {
    setAgentId(v);
    const agent = agents.find((a) => a.id === v);
    if (agent?.phoneNumber) setFromNumber(agent.phoneNumber);
  }

  const canSchedule = allowSchedule && !!onSchedule;

  async function handleSubmit() {
    if (!agentId) return;
    setRunning(true);
    try {
      if (schedule && canSchedule) {
        if (!scheduledAt) {
          toast.error("Pick a date and time for the scheduled calls");
          return;
        }
        await onSchedule!({
          agentId,
          fromNumber: fromNumber || null,
          scheduledAtIso: new Date(scheduledAt).toISOString(),
        });
      } else {
        await onStart({ agentId, fromNumber: fromNumber || null });
      }
    } finally {
      setRunning(false);
    }
  }

  const selectedAgent = agents.find((a) => a.id === agentId);
  const config = (customConfigQ.data as any)?.config ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setSchedule(false);
          setScheduledAt("");
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-400" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <p className="text-sm text-muted-foreground">
            {schedule ? "Schedule" : "Start"} calls for{" "}
            <span className="font-semibold text-foreground">{count}</span> selected{" "}
            {entityLabel}
            {count !== 1 ? "s" : ""}.
          </p>
          {agents.length === 0 ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-400">
              {noAgentsMessage}
            </div>
          ) : (
            <>
              <div className="min-w-0">
                <Label className="text-xs">Agent</Label>
                <Select value={agentId} onValueChange={handleAgentChange}>
                  <SelectTrigger className="mt-1 min-w-0 overflow-hidden">
                    <SelectValue
                      className="min-w-0 flex-1 truncate text-left"
                      placeholder="Select an agent…"
                    >
                      {selectedAgent ? (
                        <span className="block truncate">{selectedAgent.name}</span>
                      ) : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="flex w-full max-w-[280px] items-center gap-2">
                          <span className="truncate">{a.name}</span>
                          {a.phoneNumber && (
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {a.phoneNumber}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">From Number (optional override)</Label>
                <Input
                  value={fromNumber}
                  onChange={(e) => setFromNumber(e.target.value)}
                  placeholder="+1 555 000 0000"
                  className="mt-1 h-8 text-xs"
                />
              </div>

              {/* Custom setup switch */}
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Settings2 className="h-4 w-4 text-sky-400" />
                    Show original agent setup
                  </span>
                  <Switch
                    checked={showSetup}
                    onCheckedChange={setShowSetup}
                    disabled={!agentId}
                  />
                </div>
                {showSetup && (
                  customConfigQ.isLoading ? (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading setup…
                    </p>
                  ) : config ? (
                    <div className="space-y-1.5 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px]">
                          {config.source_script
                            ? "Script-based setup (Option B)"
                            : "Description-based setup (Option A)"}
                        </Badge>
                        {typeof config.deployment_readiness_score === "number" && (
                          <Badge variant="outline" className="text-[10px]">
                            {config.deployment_readiness_score}% ready
                          </Badge>
                        )}
                        {config.crm_mode && (
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {String(config.crm_mode).replace(/_/g, " ")}
                          </Badge>
                        )}
                      </div>
                      {config.agent_summary && (
                        <p className="text-muted-foreground">{config.agent_summary}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      This agent wasn't built with the Custom Workflow generator — no saved
                      setup record on file.
                    </p>
                  )
                )}
              </div>

              {/* Schedule toggle */}
              {canSchedule && (
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-3">
                  <button
                    type="button"
                    onClick={() => setSchedule((v) => !v)}
                    className="flex w-full items-center justify-between"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <CalendarClock className="h-4 w-4 text-purple-400" />
                      Schedule for later
                    </span>
                    <Switch checked={schedule} onCheckedChange={setSchedule} />
                  </button>
                  {schedule && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Call date &amp; time</Label>
                      <Input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        className="mt-1 h-8 text-xs"
                        min={new Date().toISOString().slice(0, 16)}
                      />
                      {scheduleHint && (
                        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {scheduleHint}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {footerNote && <p className="text-[11px] text-muted-foreground">{footerNote}</p>}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!agentId || agents.length === 0 || running}
            className={schedule && canSchedule ? "bg-purple-600 hover:bg-purple-500 text-white" : ""}
          >
            {running ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                {schedule && canSchedule ? "Scheduling…" : "Starting…"}
              </>
            ) : schedule && canSchedule ? (
              <>
                <CalendarClock className="mr-1 h-4 w-4" />
                Schedule {count} Call{count !== 1 ? "s" : ""}
              </>
            ) : (
              <>
                <Phone className="mr-1 h-4 w-4" />
                Start {count} Call{count !== 1 ? "s" : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
