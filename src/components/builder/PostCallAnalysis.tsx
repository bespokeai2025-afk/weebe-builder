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
  const sentimentColor =
    data.sentiment
      ? (SENTIMENT_COLOR[data.sentiment] ?? "text-muted-foreground")
      : "text-muted-foreground";

  const hasVariables = Object.keys(data.variables).length > 0;

  return (
    <div className="space-y-2.5 text-[11px]">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        Call Analysis
      </p>

      {data.summary && (
        <p className="text-foreground/80 leading-relaxed">{data.summary}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {data.successful !== null && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
              data.successful
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-rose-500/10 border-rose-500/30 text-rose-400"
            }`}
          >
            {data.successful ? "✓ Successful" : "✗ Unsuccessful"}
          </span>
        )}
        {data.sentiment && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border border-white/[0.08] bg-white/[0.04] ${sentimentColor}`}
          >
            {data.sentiment.charAt(0).toUpperCase() + data.sentiment.slice(1)} sentiment
          </span>
        )}
      </div>

      {hasVariables && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-2.5 pt-2 pb-1.5 border-b border-white/[0.04]">
            Extracted Variables
          </p>
          <div className="divide-y divide-white/[0.04]">
            {Object.entries(data.variables).map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 px-2.5 py-1.5">
                <span className="shrink-0 text-muted-foreground font-mono">{key}</span>
                <span className="text-foreground/80 break-all">
                  {value === null || value === undefined ? (
                    <span className="text-muted-foreground/50 italic">—</span>
                  ) : (
                    String(value)
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
