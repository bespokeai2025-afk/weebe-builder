import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  getWbahNewLeadSyncToggle,
  setWbahNewLeadSyncToggle,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import type { WbahNewLeadSyncToggleState } from "@/lib/integrations/webespokeEnterprise/wbah-campaign-sync.types";
import { cn } from "@/lib/utils";

type Props = {
  active: boolean;
  className?: string;
  onStateChange?: (state: WbahNewLeadSyncToggleState) => void;
};

export function WbahNewLeadSyncToggle({ active, className, onStateChange }: Props) {
  const getToggleFn = useServerFn(getWbahNewLeadSyncToggle);
  const setToggleFn = useServerFn(setWbahNewLeadSyncToggle);

  const [state, setState] = useState<WbahNewLeadSyncToggleState | null>(null);
  const [loading, setLoading] = useState(false);
  const [patching, setPatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = (await getToggleFn()) as WbahNewLeadSyncToggleState;
      setState(res);
      onStateChange?.(res);
    } catch (e) {
      const msg = (e as Error).message || "Could not load New Lead sync toggle";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [getToggleFn, onStateChange]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  async function handleToggle(next: boolean) {
    if (!state || patching) return;
    const prev = state;
    setPatching(true);
    setError(null);
    setState({ ...prev, enabled: next });
    try {
      const res = (await setToggleFn({ data: { enabled: next } })) as WbahNewLeadSyncToggleState;
      setState(res);
      onStateChange?.(res);
      toast.success(next ? "Inbound New Lead auto-dial enabled" : "Inbound New Lead auto-dial disabled");
    } catch (e) {
      setState(prev);
      const msg = (e as Error).message || "Failed to update toggle";
      setError(msg);
      toast.error(msg);
    } finally {
      setPatching(false);
    }
  }

  const enabled = state?.enabled ?? false;
  const busy = loading || patching;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 sm:flex-row sm:items-center sm:gap-3",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Switch
          id="wbah-new-lead-sync-toggle"
          checked={enabled}
          disabled={busy || !state}
          onCheckedChange={(v) => void handleToggle(v === true)}
        />
        <Label
          htmlFor="wbah-new-lead-sync-toggle"
          className="cursor-pointer text-[11px] font-medium text-foreground whitespace-nowrap"
        >
          Inbound New Lead auto-dial
        </Label>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug sm:max-w-md">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : enabled ? (
          "New leads sync from Dynamics and auto-dial via New Leads Agent."
        ) : (
          "New leads from Dynamics will not import or auto-dial."
        )}
      </p>
    </div>
  );
}
