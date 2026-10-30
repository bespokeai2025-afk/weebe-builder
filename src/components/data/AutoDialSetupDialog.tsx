import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/**
 * Auto Dial — separate from "Start Calling" above. That one puts an AI agent
 * on the line; this bridges two real people once the selected records answer.
 */
export function AutoDialSetupDialog({
  open,
  onOpenChange,
  recordCount,
  defaultRouteNumbers,
  onStart,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recordCount: number;
  defaultRouteNumbers: [string, string] | null;
  onStart: (routeNumbers: string[]) => Promise<void>;
}) {
  const [route1, setRoute1] = useState("");
  const [route2, setRoute2] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setRoute1(defaultRouteNumbers?.[0] ?? "");
      setRoute2(defaultRouteNumbers?.[1] ?? "");
      setLoading(false);
    }
  }, [open, defaultRouteNumbers]);

  async function handleStart() {
    const route2Trimmed = route2.trim();
    const routeNumbers = route2Trimmed ? [route1.trim(), route2Trimmed] : [route1.trim()];
    setLoading(true);
    try {
      await onStart(routeNumbers);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Auto Dial</DialogTitle>
          <DialogDescription>
            Dials the {recordCount} selected record{recordCount !== 1 ? "s" : ""} and connects each
            answered call to one of your people. Add a second person and two calls can run at once —
            one each. A new number is only dialled when someone is free, so nobody is ever left
            waiting on the line.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="autodial-route1">Person 1</Label>
            <Input
              id="autodial-route1"
              placeholder="+971585248237"
              value={route1}
              onChange={(e) => setRoute1(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="autodial-route2">Person 2 (optional)</Label>
            <Input
              id="autodial-route2"
              placeholder="+971501234567"
              value={route2}
              onChange={(e) => setRoute2(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={loading || !route1.trim()}>
            {loading ? "Starting…" : `Dial ${recordCount} record${recordCount !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
