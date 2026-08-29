/**
 * Assign-leads dialog — pick a workspace member (human sales agent or any
 * active member) and assign the selected lead(s) to them, or unassign.
 * Reusable across the leads list, qualified list and the pipeline drawer.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import { assignLeads, listAssignableMembers } from "@/lib/leads/lead-assignment.functions";

const UNASSIGN = "__unassign__";

export function useAssignableMembers(enabled = true) {
  const listFn = useServerFn(listAssignableMembers);
  return useQuery({
    queryKey: ["assignable-members"],
    queryFn: () => listFn(),
    staleTime: 5 * 60_000,
    throwOnError: false,
    enabled,
  });
}

export function AssignLeadsDialog({
  open,
  onOpenChange,
  leadIds,
  currentAssignee,
  onAssigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  /** For single-lead use: preselect the current assignee. */
  currentAssignee?: string | null;
  onAssigned?: () => void;
}) {
  const qc = useQueryClient();
  const assignFn = useServerFn(assignLeads);
  const membersQ = useAssignableMembers(open);
  const [selected, setSelected] = useState<string>(currentAssignee ?? "");

  const assignM = useMutation({
    mutationFn: (assignedTo: string | null) =>
      assignFn({ data: { leadIds, assignedTo } }),
    onSuccess: (res: any, assignedTo) => {
      const n = res?.updated ?? 0;
      if (assignedTo === null) {
        toast.success(n > 0 ? `Unassigned ${n} lead${n !== 1 ? "s" : ""}` : "No changes");
      } else {
        toast.success(
          n > 0
            ? `Assigned ${n} lead${n !== 1 ? "s" : ""}${res?.assigneeName ? ` to ${res.assigneeName}` : ""}`
            : "Already assigned — no changes",
        );
      }
      qc.invalidateQueries({ queryKey: ["leads-all"] });
      qc.invalidateQueries({ queryKey: ["leads-qualified"] });
      qc.invalidateQueries({ queryKey: ["pipeline-leads"] });
      qc.invalidateQueries({ queryKey: ["campaign-leads"] });
      onAssigned?.();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error("Assignment failed", { description: e?.message }),
  });

  const members = (membersQ.data ?? []) as Array<{ userId: string; name: string; roleKey: string | null }>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            Assign {leadIds.length} lead{leadIds.length !== 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            The assigned team member is notified and sees these leads in their lists.
          </DialogDescription>
        </DialogHeader>

        {membersQ.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a team member…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGN}>Unassign</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                  {m.roleKey === "sales_agent" ? " · Sales Agent" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!selected || assignM.isPending}
            onClick={() => assignM.mutate(selected === UNASSIGN ? null : selected)}
          >
            {assignM.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {selected === UNASSIGN ? "Unassign" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
