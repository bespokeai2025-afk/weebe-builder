/** Merge Retell canonical agent names with names seen in loaded data. */
export function mergeWbahAgentNames(...groups: (string | null | undefined)[][]): string[] {
  const set = new Set<string>();
  for (const g of groups) {
    for (const n of g) {
      const s = String(n ?? "").trim();
      if (s) set.add(s);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
