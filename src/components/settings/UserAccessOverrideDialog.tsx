/**
 * Per-user visibility override editor (Team Access).
 * Lets owners/admins restrict (or expand within the package cap) what a single
 * member can see, independent of their role.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

import {
  PAGE_KEYS,
  PAGE_LABELS,
  PAGE_LEVELS,
  type PageKey,
} from "@/lib/permissions/permissions.shared";
import {
  listUserAccessOverrides,
  setUserAccessOverride,
  clearUserAccessOverride,
} from "@/lib/packages/packages.functions";

const LEVEL_LABELS: Record<string, string> = {
  hidden: "Hidden",
  view: "View only",
  edit: "Can edit",
  manage: "Full manage",
};

export function UserAccessOverrideDialog({
  targetUserId,
  targetLabel,
}: {
  targetUserId: string;
  targetLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const listFn = useServerFn(listUserAccessOverrides);
  const setFn = useServerFn(setUserAccessOverride);
  const clearFn = useServerFn(clearUserAccessOverride);

  const overridesQ = useQuery({
    queryKey: ["user-access-overrides"],
    queryFn: () => listFn(),
    enabled: open,
    throwOnError: false,
  });

  const existing = useMemo(
    () => (overridesQ.data ?? []).find((o: any) => o.user_id === targetUserId),
    [overridesQ.data, targetUserId],
  );

  const [draftPages, setDraftPages] = useState<Record<string, string> | null>(null);
  const [draftAssigned, setDraftAssigned] = useState<boolean | null>(null);

  const pages: Record<string, string> =
    draftPages ?? ((existing?.page_access_json as Record<string, string>) ?? {});
  const assignedOnly =
    draftAssigned ??
    ((existing?.record_visibility_json as any)?.assignedRecordsOnly === true);

  const hasOverride =
    !!existing &&
    (Object.keys((existing.page_access_json as object) ?? {}).length > 0 ||
      (existing.record_visibility_json as any)?.assignedRecordsOnly === true);

  const saveM = useMutation({
    mutationFn: () =>
      setFn({
        data: {
          targetUserId,
          pageAccess: pages,
          assignedRecordsOnly: assignedOnly,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-access-overrides"] });
      toast.success("Visibility override saved");
      setOpen(false);
      setDraftPages(null);
      setDraftAssigned(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const clearM = useMutation({
    mutationFn: () => clearFn({ data: { targetUserId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-access-overrides"] });
      toast.success("Override removed — role defaults apply");
      setOpen(false);
      setDraftPages(null);
      setDraftAssigned(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to remove"),
  });

  const setPage = (page: PageKey, value: string) => {
    const next = { ...pages };
    if (value === "inherit") delete next[page];
    else next[page] = value;
    setDraftPages(next);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={() => setOpen(true)}
        title="Per-user visibility"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Visibility{hasOverride ? " *" : ""}
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setDraftPages(null); setDraftAssigned(null); } }}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Visibility for {targetLabel}</DialogTitle>
            <DialogDescription>
              Overrides this member&apos;s role defaults. &quot;Inherit&quot; keeps the role
              setting. The workspace package always caps what anyone can see.
            </DialogDescription>
          </DialogHeader>
          {overridesQ.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Assigned records only</Label>
                  <p className="text-xs text-muted-foreground">
                    Only show leads, calls and contacts assigned to this user.
                  </p>
                </div>
                <Switch
                  checked={assignedOnly}
                  onCheckedChange={(v) => setDraftAssigned(v)}
                />
              </div>
              <div className="space-y-1.5">
                {PAGE_KEYS.map((p) => (
                  <div key={p} className="flex items-center justify-between gap-3 rounded border px-3 py-1.5">
                    <span className="text-sm">{PAGE_LABELS[p]}</span>
                    <Select
                      value={pages[p] ?? "inherit"}
                      onValueChange={(v) => setPage(p, v)}
                    >
                      <SelectTrigger className="h-8 w-[150px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">Inherit (role)</SelectItem>
                        {PAGE_LEVELS.map((l) => (
                          <SelectItem key={l} value={l}>
                            {LEVEL_LABELS[l] ?? l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <div className="flex justify-between gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={clearM.isPending || !existing}
                  onClick={() => clearM.mutate()}
                >
                  Remove override
                </Button>
                <Button size="sm" disabled={saveM.isPending} onClick={() => saveM.mutate()}>
                  {saveM.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
