import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Play,
  Pause,
  Zap,
  Search,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listHexmailCampaigns,
  updateHexmailCampaignStatus,
  deleteHexmailCampaign,
  type HexmailCampaign,
} from "@/lib/hexmail/campaigns.functions";

const STATUS_STYLES: Record<string, string> = {
  draft:    "bg-slate-500/10 text-slate-400 border-slate-500/20",
  active:   "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  paused:   "bg-amber-500/10 text-amber-400 border-amber-500/20",
  archived: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

const STATUS_DOT: Record<string, string> = {
  draft:    "bg-slate-400",
  active:   "bg-emerald-400",
  paused:   "bg-amber-400",
  archived: "bg-rose-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium capitalize",
        STATUS_STYLES[status] ?? STATUS_STYLES.draft,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status] ?? STATUS_DOT.draft)} />
      {status}
    </span>
  );
}

interface FollowUpCentreProps {
  onOpenBuilder: (campaignId?: string) => void;
}

export function FollowUpCentre({ onOpenBuilder }: FollowUpCentreProps) {
  const qc = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<HexmailCampaign | null>(null);
  const [search, setSearch] = useState("");

  const { data: campaigns = [], isLoading } = useQuery<HexmailCampaign[]>({
    queryKey: ["hexmail-campaigns"],
    queryFn: () => listHexmailCampaigns({ data: {} }),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: HexmailCampaign["status"] }) =>
      updateHexmailCampaignStatus({ data: { id, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hexmail-campaigns"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteHexmailCampaign({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hexmail-campaigns"] });
      setDeleteTarget(null);
    },
  });

  const filtered = search.trim()
    ? campaigns.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.description?.toLowerCase().includes(search.toLowerCase()),
      )
    : campaigns;

  const counts = {
    active: campaigns.filter((c) => c.status === "active").length,
    draft: campaigns.filter((c) => c.status === "draft").length,
    paused: campaigns.filter((c) => c.status === "paused").length,
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <p className="text-sm text-muted-foreground">
            {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}
          </p>
          {campaigns.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {counts.active > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {counts.active} active
                </span>
              )}
              {counts.draft > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                  {counts.draft} draft
                </span>
              )}
              {counts.paused > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  {counts.paused} paused
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {campaigns.length > 0 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="h-8 pl-8 w-52 text-xs"
                placeholder="Search campaigns…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
          <Button onClick={() => onOpenBuilder()} className="gap-1.5 h-8">
            <Plus className="h-4 w-4" />
            New Campaign
          </Button>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          Loading campaigns…
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-center rounded-lg border border-dashed">
          <div className="rounded-full bg-primary/10 p-4">
            <Zap className="h-8 w-8 text-primary" />
          </div>
          <div>
            <p className="font-medium text-foreground">No campaigns yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create your first multi-channel follow-up campaign.
            </p>
          </div>
          <Button onClick={() => onOpenBuilder()} className="gap-1.5">
            <Plus className="h-4 w-4" /> New Campaign
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 border-b bg-muted/30 px-4 py-2.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground w-6" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Campaign
            </span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground w-20 text-center">
              Status
            </span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground w-24 text-right">
              Created
            </span>
            <span className="w-8" />
          </div>

          {/* Rows */}
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No campaigns match "{search}"
            </div>
          ) : (
            filtered.map((c, idx) => (
              <CampaignRow
                key={c.id}
                campaign={c}
                isLast={idx === filtered.length - 1}
                onEdit={() => onOpenBuilder(c.id)}
                onStatusChange={(status) => updateStatus.mutate({ id: c.id, status })}
                onDelete={() => setDeleteTarget(c)}
                isUpdating={updateStatus.isPending}
              />
            ))
          )}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This will also
              delete all its scheduled days and actions. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
              disabled={remove.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CampaignRow({
  campaign,
  isLast,
  onEdit,
  onStatusChange,
  onDelete,
  isUpdating,
}: {
  campaign: HexmailCampaign;
  isLast: boolean;
  onEdit: () => void;
  onStatusChange: (status: HexmailCampaign["status"]) => void;
  onDelete: () => void;
  isUpdating: boolean;
}) {
  const isActive = campaign.status === "active";
  const isPaused = campaign.status === "paused";
  const isDraft = campaign.status === "draft";

  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors cursor-pointer group",
        !isLast && "border-b border-border/60",
      )}
      onClick={onEdit}
    >
      {/* Icon */}
      <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/40">
        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
      </div>

      {/* Name + description */}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{campaign.name}</p>
        {campaign.description && (
          <p className="truncate text-xs text-muted-foreground mt-0.5">{campaign.description}</p>
        )}
      </div>

      {/* Status */}
      <div className="w-20 flex justify-center" onClick={(e) => e.stopPropagation()}>
        <StatusBadge status={campaign.status} />
      </div>

      {/* Created date */}
      <span className="w-24 text-right text-xs text-muted-foreground tabular-nums">
        {new Date(campaign.created_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </span>

      {/* Actions */}
      <div onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Open Builder
            </DropdownMenuItem>
            {(isDraft || isPaused) && (
              <DropdownMenuItem onClick={() => onStatusChange("active")} disabled={isUpdating}>
                <Play className="mr-2 h-3.5 w-3.5" /> Activate
              </DropdownMenuItem>
            )}
            {isActive && (
              <DropdownMenuItem onClick={() => onStatusChange("paused")} disabled={isUpdating}>
                <Pause className="mr-2 h-3.5 w-3.5" /> Pause
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
