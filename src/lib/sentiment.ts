export type NormalizedSentiment = "positive" | "negative" | "neutral" | "unknown";

export function normalizeSentiment(value: string | null | undefined): NormalizedSentiment {
  const s = (value ?? "").toLowerCase().trim();
  if (s === "positive") return "positive";
  if (s === "negative") return "negative";
  if (s === "neutral")  return "neutral";
  return "unknown";
}

export function sentimentBadgeClass(value: string | null | undefined): string {
  const n = normalizeSentiment(value);
  if (n === "positive") return "bg-emerald-500/15 text-emerald-400";
  if (n === "negative") return "bg-red-500/15 text-red-400";
  if (n === "neutral")  return "bg-amber-500/15 text-amber-400";
  return "bg-muted text-muted-foreground";
}
