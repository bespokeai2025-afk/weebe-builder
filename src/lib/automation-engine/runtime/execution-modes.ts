/**
 * Execution mode semantics — manual, test (dry-run), production.
 */
export type ExecutionMode = "manual" | "test" | "production";

export type ExecutionModeFlags = {
  mode: ExecutionMode;
  /** Skip real HTTP requests (core.http.request uses _dryRun). */
  dryRunHttp: boolean;
  /** Domain plugins may skip external writes when true. */
  skipSideEffects: boolean;
  /** DB source column value. */
  source: "manual" | "dry_run" | "webhook" | "queue";
  /** Enqueue instead of inline run. */
  preferQueue: boolean;
};

export function resolveExecutionModeFlags(mode: ExecutionMode): ExecutionModeFlags {
  switch (mode) {
    case "test":
      return {
        mode,
        dryRunHttp: true,
        skipSideEffects: true,
        source: "dry_run",
        preferQueue: false,
      };
    case "production":
      return {
        mode,
        dryRunHttp: false,
        skipSideEffects: false,
        source: "queue",
        preferQueue: true,
      };
    case "manual":
    default:
      return {
        mode: "manual",
        dryRunHttp: false,
        skipSideEffects: false,
        source: "manual",
        preferQueue: false,
      };
  }
}

export function isTestExecution(mode: ExecutionMode): boolean {
  return mode === "test";
}
