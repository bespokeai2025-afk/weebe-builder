import type { PostCallExtracted } from "@/lib/builder/post-call-extract.functions";

interface Props {
  data: PostCallExtracted;
}

const SENTIMENT_COLOR: Record<string, string> = {
  positive: "text-emerald-400",
  neutral:  "text-yellow-400",
  negative: "text-rose-400",
};

export function PostCallAnalysis({ data }: Props) {
  const sentimentColor = data.sentiment
    ? (SENTIMENT_COLOR[data.sentiment] ?? "text-muted-foreground")
    : "text-muted-foreground";

  const hasVariables = Object.keys(data.variables).length > 0;

  return (
    <div className="space-y-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        Call Analysis
      </p>

      {data.summary && (
        <p className="text-[10px] leading-relaxed text-foreground/70">{data.summary}</p>
      )}

      <div className="flex flex-wrap gap-1">
        {data.successful !== null && (
          <span className={`inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-medium border ${
            data.successful
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : "bg-rose-500/10 border-rose-500/30 text-rose-400"
          }`}>
            {data.successful ? "✓ Successful" : "✗ Unsuccessful"}
          </span>
        )}
        {data.sentiment && (
          <span className={`inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-medium border border-white/[0.08] bg-white/[0.04] ${sentimentColor}`}>
            {data.sentiment.charAt(0).toUpperCase() + data.sentiment.slice(1)} sentiment
          </span>
        )}
      </div>

      {hasVariables && (
        <div className="rounded border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-2 pt-1.5 pb-1 border-b border-white/[0.04]">
            Variables
          </p>
          <div className="divide-y divide-white/[0.04]">
            {Object.entries(data.variables).map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 px-2 py-1 text-[10px]">
                <span className="shrink-0 text-muted-foreground/70 font-mono">{key}</span>
                <span className="text-foreground/70 break-all">
                  {value === null || value === undefined
                    ? <span className="text-muted-foreground/40 italic">—</span>
                    : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
