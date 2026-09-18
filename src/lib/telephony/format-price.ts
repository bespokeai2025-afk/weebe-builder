/** Pence (integer) -> "£12.34" for display. Client-safe, no imports. */
export function formatGbpPence(pence: number | null | undefined): string {
  if (pence == null) return "—";
  return `£${(pence / 100).toFixed(2)}`;
}
