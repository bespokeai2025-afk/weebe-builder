/**
 * Lead assignment server functions — thin authenticated wrappers around the
 * plain async cores in lead-assignment.server.ts (shared with the v1 API).
 * All permission enforcement lives in the cores (fail closed).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assignLeadsCore,
  assignLeadsInputSchema,
  listAssignableMembersCore,
  getLeadAssignmentHistoryCore,
} from "./lead-assignment.server";

/** Assign / reassign / unassign one or many leads. Returns per-lead results. */
export const assignLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => assignLeadsInputSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    return assignLeadsCore(workspaceId, userId, data);
  });

/**
 * Members that can be assigned leads (any active, non-suspended member).
 * Requires membership only — used to render the assignee picker.
 */
export const listAssignableMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    return listAssignableMembersCore(workspaceId, userId);
  });

/** Assignment history for one lead (members-readable audit trail). */
export const getLeadAssignmentHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { leadId: string }) => z.object({ leadId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    return getLeadAssignmentHistoryCore(workspaceId, userId, data.leadId);
  });
