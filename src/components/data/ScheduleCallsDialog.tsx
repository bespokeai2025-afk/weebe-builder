import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export function ScheduleCallsDialog({
  open,
  onOpenChange,
  recordCount,
  agents,
  onSchedule,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recordCount: number;
  agents: Array<{ id: string; name: string }>;
  onSchedule: (scheduledAt: string | null, agentId: string | null) => Promise<void>;
}) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [agentId, setAgentId] = useState("");
  const [clearSchedule, setClearSchedule] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setScheduledAt("");
      setAgentId("");
      setClearSchedule(false);
      setLoading(false);
    }
  }, [open]);

  async function handleSchedule() {
    setLoading(true);
    try {
      const iso = clearSchedule ? null : scheduledAt ? new Date(scheduledAt).toISOString() : null;
      await onSchedule(iso, agentId || null);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule Calls</DialogTitle>
          <DialogDescription>
            Set a scheduled call time for {recordCount} record
            {recordCount !== 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="clear-schedule"
              checked={clearSchedule}
              onCheckedChange={(v) => setClearSchedule(v === true)}
            />
            <Label htmlFor="clear-schedule" className="cursor-pointer">
              Clear existing schedule
            </Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="schedule-datetime">Call time</Label>
            <Input
              id="schedule-datetime"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              disabled={clearSchedule}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="schedule-agent">Agent (optional)</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger id="schedule-agent">
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSchedule} disabled={loading}>
            {loading ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
