import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Brain, CheckCircle2, Loader2, RefreshCw,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { runHiveMindScan } from "@/lib/hivemind/hivemind.tasks";

interface HiveMindReportBannerProps {
  domain: string;
  briefing?: string | null;
  score?: number | null;
  trend?: "up" | "down" | "flat" | null;
  isLoadingBriefing?: boolean;
  onGenerateBriefing?: () => void;
}

export function HiveMindReportBanner({
  domain,
  briefing,
  score,
  trend,
  isLoadingBriefing,
  onGenerateBriefing,
}: HiveMindReportBannerProps) {
  const [scanning, setScanning] = useState(false);
  const [scanned,  setScanned]  = useState(false);
  const scanFn = useServerFn(runHiveMindScan);

  async function handleReport() {
    setScanning(true);
    setScanned(false);
    try {
      await scanFn({});
      setScanned(true);
      setTimeout(() => setScanned(false), 5000);
    } catch {}
    finally { setScanning(false); }
  }

  const TrendIcon  = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-muted-foreground";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/40 mb-6 overflow-hidden">

      {/* Top bar */}
      <div className="px-4 py-2.5 border-b border-white/[0.04] flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Brain className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em]">
            AI Executive Summary
          </span>
          {score !== null && score !== undefined && (
            <span className={cn(
              "text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1",
              score >= 70
                ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/20"
                : score >= 45
                  ? "bg-amber-500/15 text-amber-400 ring-amber-500/20"
                  : "bg-red-500/15 text-red-400 ring-red-500/20",
            )}>
              {score}/100
            </span>
          )}
          {trend && (
            <TrendIcon className={cn("h-3.5 w-3.5", trendColor)} />
          )}
        </div>

        <div className="flex items-center gap-2">
          {onGenerateBriefing && !briefing && !isLoadingBriefing && (
            <Button
              variant="ghost" size="sm"
              className="h-7 text-[11px] gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={onGenerateBriefing}
            >
              <RefreshCw className="h-3 w-3" />
              Generate
            </Button>
          )}
          {onGenerateBriefing && briefing && !isLoadingBriefing && (
            <Button
              variant="ghost" size="sm"
              className="h-7 text-[11px] gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={onGenerateBriefing}
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </Button>
          )}
          <Button
            variant="outline" size="sm"
            className="h-7 text-[11px] gap-1.5 border-emerald-500/20 hover:border-emerald-500/40"
            onClick={handleReport}
            disabled={scanning}
          >
            {scanning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : scanned ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            ) : (
              <Brain className="h-3 w-3 text-emerald-400" />
            )}
            {scanning ? "Scanning…" : scanned ? "Reported!" : "Report to HiveMind"}
          </Button>
        </div>
      </div>

      {/* Briefing text */}
      <div className="px-4 py-3 min-h-[44px] flex items-center">
        {isLoadingBriefing ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
            <span className="text-xs">Generating AI summary…</span>
          </div>
        ) : briefing ? (
          <p className="text-sm text-muted-foreground leading-relaxed">{briefing}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground/50 italic">
            {onGenerateBriefing
              ? `Click "Generate" to get an AI briefing on your ${domain} performance.`
              : `Add ${domain} data to unlock the AI executive summary.`}
          </p>
        )}
      </div>

    </div>
  );
}
