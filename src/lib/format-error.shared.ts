import { ZodError } from "zod";

function messageFromZodIssue(issue: ZodError["issues"][number]): string {
  if (issue.code === "invalid_enum_value") {
    const received = String((issue as { received?: unknown }).received ?? "?");
    const path = issue.path;
    const stepsIdx = path.indexOf("steps");
    if (stepsIdx >= 0 && typeof path[stepsIdx + 1] === "number") {
      const stepNum = (path[stepsIdx + 1] as number) + 1;
      return `Workflow step ${stepNum} uses unsupported type "${received}". Refresh and save again.`;
    }
    return `Invalid workflow value "${received}".`;
  }
  const path = issue.path.length ? ` (${issue.path.join(".")})` : "";
  return `${issue.message}${path}`;
}

/** Turn Zod / server errors into short UI-friendly strings (never raw JSON dumps). */
export function formatUserFacingError(e: unknown): string {
  if (e instanceof ZodError) {
    return messageFromZodIssue(e.issues[0] ?? { code: "custom", message: "Invalid configuration", path: [] });
  }
  if (e instanceof Error) {
    const msg = e.message.trim();
    if (msg.startsWith("[") && msg.includes("invalid_enum")) {
      try {
        const parsed = JSON.parse(msg) as ZodError["issues"];
        if (Array.isArray(parsed) && parsed[0]) {
          return messageFromZodIssue(parsed[0]);
        }
      } catch {
        /* fall through */
      }
    }
    if (msg.length > 280) return `${msg.slice(0, 277)}…`;
    return msg;
  }
  const s = String(e);
  return s.length > 280 ? `${s.slice(0, 277)}…` : s;
}
