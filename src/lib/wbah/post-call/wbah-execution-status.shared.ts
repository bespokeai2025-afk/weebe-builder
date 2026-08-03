/**
 * Derived display status for WBAH post-call queue jobs (list + detail UI).
 * DB `status` alone is insufficient: completed jobs may carry step errors (warnings).
 */

export type WbahExecutionDisplayStatus =
  | "success"
  | "warning"
  | "failed"
  | "running"
  | "queued"
  | "retrying";

export type WbahExecutionStatusInput = {
  status: string;
  errors: string[];
  lastError: string | null;
  attemptCount: number;
  maxAttempts: number;
};

export function hasWbahExecutionErrors(row: Pick<WbahExecutionStatusInput, "errors" | "lastError">): boolean {
  return row.errors.length > 0 || Boolean(row.lastError?.trim());
}

/** User-facing status for badges and filter tabs. */
export function deriveWbahExecutionDisplayStatus(row: WbahExecutionStatusInput): WbahExecutionDisplayStatus {
  const dbStatus = row.status;

  if (dbStatus === "failed") return "failed";
  if (dbStatus === "processing") return "running";

  if (dbStatus === "pending") {
    if (row.lastError?.trim() && row.attemptCount > 0) return "retrying";
    return "queued";
  }

  if (dbStatus === "completed") {
    return hasWbahExecutionErrors(row) ? "warning" : "success";
  }

  return "queued";
}

export type WbahExecutionListFilter =
  | "all"
  | "success"
  | "warning"
  | "failed"
  | "queued";

/** Map UI filter tab → DB pre-query status (when possible). */
export function wbahExecutionDbStatusForFilter(
  filter: WbahExecutionListFilter,
): "all" | "pending" | "processing" | "completed" | "failed" {
  switch (filter) {
    case "success":
    case "warning":
      return "completed";
    case "failed":
      return "failed";
    case "queued":
      return "pending";
    default:
      return "all";
  }
}

export function matchesWbahExecutionFilter(
  row: WbahExecutionStatusInput,
  filter: WbahExecutionListFilter,
): boolean {
  if (filter === "all") return true;

  const display = deriveWbahExecutionDisplayStatus(row);

  switch (filter) {
    case "success":
      return display === "success";
    case "warning":
      return display === "warning";
    case "failed":
      return display === "failed" || display === "retrying";
    case "queued":
      return display === "queued" || display === "running";
    default:
      return true;
  }
}
