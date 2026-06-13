import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Play,
  Pause,
  CalendarDays,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listHexmailCampaigns,
  updateHexmailCampaignStatus,
  deleteHexmailCampaign,
  type HexmailCampaign,
} from "@/lib/hexmail/campaigns.functions";

const STATUS_STYLES: Record<string, string> = {
  draft:   "bg-slate-500/10 text-slate-500 border-slate-500/20",
  active:  "bg-green-500/10 text-green-500 border-green-500/20",
  paused:  "bg-amber-500/10 text-amber-500 border-amber-500/20",
  archived:"bg-rose-500/10 text-rose-500 border-rose-500/20",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize",
        STATUS_STYLES[status] ?? STATUS_STYLES.draft,
      )}
    >
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

  const { data: campaigns = [], isLoading } = useQuery<HexmailCampaign[]>({
    queryKey: ["hexmail-campaigns"],
    queryFn: () => listHexmailCampaigns({ data: {} }),
  });

  const updateStatus = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: HexmailCampaign["status"];
    }) => updateHexmailCampaignStatus({ data: { id, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hexmail-campaigns"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteHexmailCampaign({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hexmail-campaigns"] });
      setDeleteTarget(null);
    },
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Build multi-channel follow-up sequences with day-by-day action timelines.
          </p>
        </div>
        <Button onClick={() => onOpenBuilder()} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Campaign
        </Button>
      </div>

      {/* Campaign list */}
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              onEdit={() => onOpenBuilder(c.id)}
              onStatusChange={(status) => updateStatus.mutate({ id: c.id, status })}
              onDelete={() => setDeleteTarget(c)}
              isUpdating={updateStatus.isPending}
            />
          ))}
        </div>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>{deleteTarget?.name}</strong>? This will also delete all
              its scheduled days and actions. This cannot be undone.
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

function CampaignCard({
  campaign,
  onEdit,
  onStatusChange,
  onDelete,
  isUpdating,
}: {
  campaign: HexmailCampaign;
  onEdit: () => void;
  onStatusChange: (status: HexmailCampaign["status"]) => void;
  onDelete: () => void;
  isUpdating: boolean;
}) {
  const isActive = campaign.status === "active";
  const isPaused = campaign.status === "paused";
  const isDraft = campaign.status === "draft";

  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col gap-3 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-foreground truncate">{campaign.name}</p>
          {campaign.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {campaign.description}
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
            </DropdownMenuItem>
            {(isDraft || isPaused) && (
              <DropdownMenuItem
                onClick={() => onStatusChange("active")}
                disabled={isUpdating}
              >
                <Play className="mr-2 h-3.5 w-3.5" /> Activate
              </DropdownMenuItem>
            )}
            {isActive && (
              <DropdownMenuItem
                onClick={() => onStatusChange("paused")}
                disabled={isUpdating}
              >
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

      <div className="flex items-center gap-3">
        <StatusBadge status={campaign.status} />
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <CalendarDays className="h-3 w-3" />
          Created {new Date(campaign.created_at).toLocaleDateString()}
        </span>
      </div>

      <Button
        size="sm"
        variant="outline"
        className="w-full h-7 text-xs"
        onClick={onEdit}
      >
        <Pencil className="h-3 w-3 mr-1.5" /> Open Builder
      </Button>
    </div>
  );
}
