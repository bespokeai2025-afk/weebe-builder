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

export function StartCallingDialog({
  open,
  onOpenChange,
  recordCount,
  agents,
  defaultAgentId = "",
  onStart,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recordCount: number;
  agents: Array<{ id: string; name: string; settings?: Record<string, unknown> | null }>;
  defaultAgentId?: string;
  onStart: (agentId: string | null, fromNumber: string | null) => Promise<void>;
}) {
  const [agentId, setAgentId] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [loading, setLoading] = useState(false);

  function phoneForAgent(id: string) {
    const ag = agents.find((a) => a.id === id);
    return (ag?.settings?.phoneNumber as string | undefined) ?? "";
  }

  useEffect(() => {
    if (open) {
      const id = defaultAgentId;
      setAgentId(id);
      setFromNumber(id ? phoneForAgent(id) : "");
      setLoading(false);
    }
  }, [open, defaultAgentId]);

  function handleAgentChange(id: string) {
    setAgentId(id);
    const phone = phoneForAgent(id);
    if (phone) setFromNumber(phone);
  }

  async function handleStart() {
    setLoading(true);
    try {
      await onStart(agentId || null, fromNumber || null);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start Calling</DialogTitle>
          <DialogDescription>
            Initiate outbound calls for {recordCount} selected record
            {recordCount !== 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="start-agent">Agent</Label>
            <Select value={agentId} onValueChange={handleAgentChange}>
              <SelectTrigger id="start-agent">
                <SelectValue placeholder="Select agent (optional)" />
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
          <div className="space-y-1.5">
            <Label htmlFor="start-from">From number</Label>
            <Input
              id="start-from"
              placeholder="+1234567890"
              value={fromNumber}
              onChange={(e) => setFromNumber(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={loading}>
            {loading ? "Starting…" : `Start ${recordCount} call${recordCount !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
