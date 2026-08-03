/**
 * Compact readiness strip — post-call engine env flags and pipeline mode.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Cpu, Layers, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getWbahPostCallEngineStatusFn } from "@/lib/systemmind/wbah-workflow-wizard.functions";

function FlagBadge({
  label,
  on,
  warn,
}: {
  label: string;
  on: boolean;
  warn?: boolean;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[9px] font-normal px-1.5 py-0 h-5 border-gray-700",
        on && !warn && "border-emerald-500/35 text-emerald-300/90",
        on && warn && "border-amber-500/35 text-amber-300/90",
        !on && "text-gray-500",
      )}
    >
      {label}: {on ? "on" : "off"}
    </Badge>
  );
}

export function WbahPostCallReadinessStrip({ className }: { className?: string }) {
  const statusFn = useServerFn(getWbahPostCallEngineStatusFn);
  const { data: engine, isLoading } = useQuery({
    queryKey: ["wbah-post-call-engine-status"],
    queryFn: () => statusFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (isLoading || !engine) {
    return (
      <div className={cn("text-[10px] text-gray-600", className)}>Loading engine status…</div>
    );
  }

  const automationOn = engine.automationEngineEnabled;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-800/80 bg-gray-950/60 px-2.5 py-2",
        className,
      )}
    >
      <div className="flex items-center gap-1 text-[10px] text-gray-500 mr-1">
        <Cpu className="h-3 w-3" />
        <span className="font-medium text-gray-400">Engine</span>
      </div>
      <FlagBadge label="POST_CALL" on={engine.executionEnabled} />
      <FlagBadge label="QUEUE" on={engine.queueEnabled} />
      <FlagBadge
        label="AUTOMATION"
        on={automationOn}
        warn={automationOn && !engine.executionEnabled}
      />
      <Badge
        variant="outline"
        className={cn(
          "text-[9px] font-normal px-1.5 py-0 h-5 gap-1",
          automationOn
            ? "border-violet-500/40 text-violet-300"
            : "border-gray-700 text-gray-400",
        )}
      >
        {automationOn ? <Zap className="h-2.5 w-2.5" /> : <Layers className="h-2.5 w-2.5" />}
        {engine.pipelineLabel}
      </Badge>
      {automationOn && (
        <span className="text-[9px] text-gray-600 ml-auto">
          Phase {engine.automationEnginePhase} · {engine.wbahPluginNodeCount} WBAH nodes
        </span>
      )}
    </div>
  );
}
