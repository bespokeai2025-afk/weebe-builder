/**
 * Automation engine — execution / run state schemas (persisted in Phase 5).
 */
import { z } from "zod";

export const ExecutionStatusSchema = z.enum([
  "pending",
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);

export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const WaitStateSchema = z.object({
  type: z.enum(["delay", "webhook", "event"]),
  token: z.string().min(1),
  until: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type WaitState = z.infer<typeof WaitStateSchema>;

export const ExecutionSnapshotSchema = z.object({
  executionId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersion: z.number().int().positive().default(1),
  workspaceId: z.string().uuid(),
  status: ExecutionStatusSchema,
  currentNodeIds: z.array(z.string()).default([]),
  nodeOutputs: z.record(z.array(z.unknown())).default({}),
  variables: z.record(z.unknown()).default({}),
  globalVariables: z.record(z.unknown()).default({}),
  waitingOn: WaitStateSchema.optional(),
  startedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
});

export type ExecutionSnapshot = z.infer<typeof ExecutionSnapshotSchema>;
