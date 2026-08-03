/**
 * In-process execution event bus — subscribers receive live node/run updates (SSE bridge).
 */
import type { WaitState } from "../types/execution.schema";
import type { ExecutionMode } from "./execution-modes";

export type ExecutionEventType =
  | "execution.started"
  | "execution.completed"
  | "execution.failed"
  | "execution.waiting"
  | "execution.cancelled"
  | "node.started"
  | "node.finished"
  | "node.skipped"
  | "node.log";

export type ExecutionEvent = {
  type: ExecutionEventType;
  executionId: string;
  timestamp: string;
  workflowId?: string;
  workflowName?: string;
  mode?: ExecutionMode;
  nodeId?: string;
  nodeType?: string;
  nodeName?: string;
  status?: string;
  branch?: string;
  durationMs?: number;
  error?: string;
  waitingOn?: WaitState;
  log?: string;
  meta?: Record<string, unknown>;
};

export type ExecutionEventHandler = (event: ExecutionEvent) => void;

type Subscriber = {
  handler: ExecutionEventHandler;
  filter?: ExecutionEventType[];
};

class ExecutionEventBus {
  private subscribers = new Map<string, Set<Subscriber>>();

  subscribe(
    executionId: string,
    handler: ExecutionEventHandler,
    opts?: { filter?: ExecutionEventType[] },
  ): () => void {
    if (!this.subscribers.has(executionId)) {
      this.subscribers.set(executionId, new Set());
    }
    const sub: Subscriber = { handler, filter: opts?.filter };
    this.subscribers.get(executionId)!.add(sub);
    return () => {
      this.subscribers.get(executionId)?.delete(sub);
      if (this.subscribers.get(executionId)?.size === 0) {
        this.subscribers.delete(executionId);
      }
    };
  }

  emit(event: ExecutionEvent): void {
    const subs = this.subscribers.get(event.executionId);
    if (!subs?.size) return;
    for (const sub of subs) {
      if (sub.filter && !sub.filter.includes(event.type)) continue;
      try {
        sub.handler(event);
      } catch (e) {
        console.warn("[execution-events] subscriber error:", e);
      }
    }
  }

  /** Collect events into an array (testing / batch replay). */
  collect(executionId: string): { events: ExecutionEvent[]; unsubscribe: () => void } {
    const events: ExecutionEvent[] = [];
    const unsubscribe = this.subscribe(executionId, (e) => events.push(e));
    return { events, unsubscribe };
  }
}

export const executionEventBus = new ExecutionEventBus();

export function emitExecutionEvent(
  partial: Omit<ExecutionEvent, "timestamp"> & { timestamp?: string },
): void {
  executionEventBus.emit({
    ...partial,
    timestamp: partial.timestamp ?? new Date().toISOString(),
  });
}
