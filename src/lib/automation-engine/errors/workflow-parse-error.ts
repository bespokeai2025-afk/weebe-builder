/**
 * Structured parse / validation errors for workflow JSON.
 */
export class WorkflowParseError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors[0] ?? "Invalid workflow");
    this.name = "WorkflowParseError";
    this.errors = errors;
  }
}

export function formatZodWorkflowErrors(
  issues: Array<{ path: (string | number)[]; message: string }>,
): string[] {
  return issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "workflow";
    return `${path}: ${issue.message}`;
  });
}
