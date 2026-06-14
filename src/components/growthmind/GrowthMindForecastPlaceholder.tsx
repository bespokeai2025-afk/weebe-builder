import { LineChart, Sparkles } from "lucide-react";
import { GrowthMindShell } from "./GrowthMindShell";

export function GrowthMindForecastPlaceholder() {
  return (
    <GrowthMindShell>
      <div className="flex flex-col items-center justify-center h-full min-h-[480px] gap-4 px-6 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/25">
          <LineChart className="h-7 w-7 text-emerald-400" />
        </div>
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-[11px] font-semibold text-emerald-400 mb-3">
            <Sparkles className="h-3 w-3" />
            Coming soon
          </div>
          <h2 className="text-lg font-semibold mb-1.5">Revenue Forecast</h2>
          <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
            Predict lead volume, appointments, sales, and revenue for the next 90 days using your historical CRM and campaign data.
          </p>
        </div>
      </div>
    </GrowthMindShell>
  );
}
