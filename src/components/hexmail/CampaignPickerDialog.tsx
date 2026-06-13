import React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Layers,
  Calendar,
  Mail,
  MessageCircle,
  MessageSquare,
  FileText,
  Zap,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  listHexmailCampaigns,
  enrollLeadInCampaign,
  type HexmailCampaign,
} from "@/lib/hexmail/campaigns.functions";

// ── Action type icon helpers ──────────────────────────────────────────────────

const ACTION_ICONS: Record<string, React.ElementType> = {
  email:    Mail,
  whatsapp: MessageCircle,
  sms:      MessageSquare,
  task:     FileText,
  ai_call:  Zap,
};

function CampaignCard({
  campaign,
  selected,
  onSelect,
}: {
  campaign: HexmailCampaign;
  selected: boolean;
  onSelect: () => void;
}) {
  const steps  = campaign.steps ?? [];
  const days   = steps.length;

  // Collect unique action types across all steps
  const actionTypes = [
    ...new Set(steps.flatMap((s) => s.actions.map((a) => a.type))),
  ];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-lg border p-3 transition-all",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/30 shadow-sm"
          : "border-border bg-card hover:border-primary/40 hover:bg-muted/30",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          "h-8 w-8 rounded-md flex items-center justify-center shrink-0 mt-0.5",
          selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        )}>
          <Layers className="h-4 w-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground truncate">{campaign.name}</p>
            {selected && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
          </div>

          <div className="flex items-center gap-3 mt-1.5">
            {days > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Calendar className="h-3 w-3" />
                {days} day{days !== 1 ? "s" : ""}
              </span>
            )}
            {actionTypes.length > 0 && (
              <div className="flex items-center gap-1">
                {actionTypes.slice(0, 5).map((type) => {
                  const Icon = ACTION_ICONS[type];
                  if (!Icon) return null;
                  return (
                    <span key={type} title={type} className="text-muted-foreground">
                      <Icon className="h-3 w-3" />
                    </span>
                  );
                })}
              </div>
            )}
            <Badge
              variant={campaign.status === "active" ? "default" : "secondary"}
              className="text-[10px] h-4 px-1.5"
            >
              {campaign.status}
            </Badge>
          </div>
        </div>
      </div>
    </button>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  leadId: string | null;
  leadName?: string | null;
  onClose: () => void;
  onEnrolled?: (campaignId: string) => void;
}

export function CampaignPickerDialog({ open, leadId, leadName, onClose, onEnrolled }: Props) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // Reset selection when dialog opens
  React.useEffect(() => {
    if (open) setSelectedId(null);
  }, [open]);

  const { data: campaigns = [], isLoading } = useQuery<HexmailCampaign[]>({
    queryKey: ["hexmail-campaigns-with-steps"],
    queryFn: () => listHexmailCampaigns({ data: { includeArchived: false, includeSteps: true } }),
    enabled: open,
  });

  const enroll = useMutation({
    mutationFn: (campaignId: string) =>
      enrollLeadInCampaign({ data: { leadId: leadId!, campaignId } }),
    onSuccess: (_result, campaignId) => {
      const c = campaigns.find((c) => c.id === campaignId);
      toast.success(`${leadName ?? "Lead"} enrolled in "${c?.name ?? "campaign"}"`);
      onEnrolled?.(campaignId);
      onClose();
    },
    onError: (e: any) => {
      // Graceful degradation: migration might not be applied yet
      if (e?.message?.includes("does not exist") || e?.message?.includes("MIGRATION_NEEDED")) {
        toast.warning("Enrollment table not yet applied — run the campaign_enrollments migration.", {
          duration: 6000,
          description: "supabase/migrations/20260621000000_campaign_enrollments.sql",
        });
        onClose();
      } else {
        toast.error(e?.message ?? "Failed to enroll lead");
      }
    },
  });

  const activeCampaigns = campaigns.filter((c) => c.status === "active" || c.status === "draft");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Start Follow-Up Campaign
          </DialogTitle>
          <DialogDescription>
            {leadName
              ? `Choose a campaign to enroll ${leadName} in. They'll receive the sequence of actions you've set up day by day.`
              : "Choose a campaign to enroll this lead in."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-72 overflow-y-auto py-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading campaigns…
            </div>
          ) : activeCampaigns.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <Layers className="h-8 w-8 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">No active campaigns yet.</p>
              <p className="text-xs text-muted-foreground">
                Build one in <strong>Follow-Up Centre</strong> first.
              </p>
            </div>
          ) : (
            activeCampaigns.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                selected={selectedId === c.id}
                onSelect={() => setSelectedId(c.id)}
              />
            ))
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Skip for now
          </Button>
          <Button
            onClick={() => selectedId && enroll.mutate(selectedId)}
            disabled={!selectedId || enroll.isPending}
            className="gap-1.5"
          >
            {enroll.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Enrolling…</>
              : <><Zap className="h-3.5 w-3.5" /> Start Campaign</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

