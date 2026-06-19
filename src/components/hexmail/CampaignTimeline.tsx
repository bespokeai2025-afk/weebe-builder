import { useState, useEffect, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus,
  ChevronDown,
  X,
  Save,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Bell,
  Tag,
  CheckSquare,
  GitBranch,
  CalendarDays,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  listHexmailCampaigns,
  getHexmailCampaignWithSteps,
  saveHexmailCampaign,
  type HexmailCampaign,
} from "@/lib/hexmail/campaigns.functions";
import {
  listHexmailTemplates,
  type HexmailTemplate,
} from "@/lib/hexmail/templates.functions";

const DAY_RANGES = [7, 14, 30, 60, 90] as const;
type DayRange = (typeof DAY_RANGES)[number];

const ACTION_TYPES = [
  { value: "email",           label: "Email",           icon: Mail },
  { value: "sms",             label: "SMS",             icon: MessageSquare },
  { value: "whatsapp",        label: "WhatsApp",        icon: MessageSquare },
  { value: "ai_call",         label: "AI Call",         icon: Phone },
  { value: "task",            label: "Task",            icon: CheckSquare },
  { value: "notification",    label: "Notification",    icon: Bell },
  { value: "pipeline_update", label: "Pipeline Update", icon: GitBranch },
  { value: "tag_assignment",  label: "Tag",             icon: Tag },
] as const;

type ActionType = (typeof ACTION_TYPES)[number]["value"];

interface Action {
  id: string;
  type: ActionType;
  template_id: string | null;
  notes: string;
  config: Record<string, unknown>;
}

type StepMap = Map<number, Action[]>;

function templatesByType(templates: HexmailTemplate[], type: string) {
  return templates.filter((t) => t.type === type);
}

function ActionTypeIcon({ type, className }: { type: string; className?: string }) {
  const at = ACTION_TYPES.find((a) => a.value === type);
  const Icon = at?.icon ?? Mail;
  return <Icon className={cn("h-3.5 w-3.5", className)} />;
}

function ActionChip({
  action,
  templates,
}: {
  action: Action;
  templates: HexmailTemplate[];
}) {
  const at = ACTION_TYPES.find((a) => a.value === action.type);
  const tpl = templates.find((t) => t.id === action.template_id);
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
      <ActionTypeIcon type={action.type} className="h-3 w-3" />
      {tpl ? tpl.name : at?.label ?? action.type}
    </span>
  );
}

function ActionEditor({
  action,
  templates,
  onChange,
  onRemove,
}: {
  action: Action;
  templates: HexmailTemplate[];
  onChange: (a: Action) => void;
  onRemove: () => void;
}) {
  const tplOptions = ["email", "sms", "whatsapp"].includes(action.type)
    ? templatesByType(templates, action.type)
    : [];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
      {/* Type */}
      <Select
        value={action.type}
        onValueChange={(v) =>
          onChange({ ...action, type: v as ActionType, template_id: null })
        }
      >
        <SelectTrigger className="h-7 w-40 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACTION_TYPES.map((a) => (
            <SelectItem key={a.value} value={a.value} className="text-xs">
              <span className="flex items-center gap-2">
                <a.icon className="h-3.5 w-3.5" />
                {a.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Template picker */}
      {tplOptions.length > 0 && (
        <Select
          value={action.template_id ?? "none"}
          onValueChange={(v) =>
            onChange({ ...action, template_id: v === "none" ? null : v })
          }
        >
          <SelectTrigger className="h-7 w-52 text-xs">
            <SelectValue placeholder="Select template…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none" className="text-xs text-muted-foreground">
              No template
            </SelectItem>
            {tplOptions.map((t) => (
              <SelectItem key={t.id} value={t.id} className="text-xs">
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Notes */}
      <Input
        className="h-7 min-w-[140px] flex-1 text-xs"
        placeholder="Notes…"
        value={action.notes}
        onChange={(e) => onChange({ ...action, notes: e.target.value })}
      />

      {/* Remove */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function DayRow({
  dayNumber,
  actions,
  isExpanded,
  onToggle,
  templates,
  onChange,
}: {
  dayNumber: number;
  actions: Action[];
  isExpanded: boolean;
  onToggle: () => void;
  templates: HexmailTemplate[];
  onChange: (actions: Action[]) => void;
}) {
  const hasActions = actions.length > 0;

  const addAction = () => {
    onChange([
      ...actions,
      {
        id: crypto.randomUUID(),
        type: "email",
        template_id: null,
        notes: "",
        config: {},
      },
    ]);
  };

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        hasActions
          ? "border-primary/25 bg-primary/5"
          : "border-border bg-card hover:bg-muted/30",
      )}
    >
      {/* Row header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-0.5 text-xs font-mono font-semibold",
            hasActions
              ? "bg-primary/20 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          Day {String(dayNumber).padStart(2, "0")}
        </span>

        <div className="flex flex-1 flex-wrap items-center gap-1.5 min-w-0">
          {hasActions ? (
            actions.map((a) => (
              <ActionChip key={a.id} action={a} templates={templates} />
            ))
          ) : (
            <span className="text-xs italic text-muted-foreground">
              No actions — click to add
            </span>
          )}
        </div>

        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
            isExpanded && "rotate-180",
          )}
        />
      </button>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="border-t bg-muted/10 px-4 pb-3 pt-3 space-y-2">
          {actions.length === 0 && (
            <p className="text-xs text-muted-foreground pb-1">
              Add one or more actions for this day in the sequence.
            </p>
          )}

          {actions.map((action, idx) => (
            <ActionEditor
              key={action.id}
              action={action}
              templates={templates}
              onChange={(updated) => {
                const next = [...actions];
                next[idx] = updated;
                onChange(next);
              }}
              onRemove={() => onChange(actions.filter((_, i) => i !== idx))}
            />
          ))}

          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-7 gap-1.5 text-xs"
            onClick={addAction}
          >
            <Plus className="h-3 w-3" />
            Add Action
          </Button>
        </div>
      )}
    </div>
  );
}

interface NewCampaignDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => void;
  isPending: boolean;
}

function NewCampaignDialog({ open, onClose, onCreate, isPending }: NewCampaignDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const descId = useId();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), description.trim());
  };

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
          <DialogDescription id={descId}>
            Give your follow-up campaign a name to get started.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label>Campaign Name</Label>
            <Input
              autoFocus
              placeholder="e.g. 30-Day Warm Nurture"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              placeholder="What is this campaign for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isPending} className="gap-2">
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create Campaign
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface CampaignTimelineProps {
  initialCampaignId?: string;
}

export function CampaignTimeline({ initialCampaignId }: CampaignTimelineProps) {
  const qc = useQueryClient();
  const [campaignId, setCampaignId] = useState(initialCampaignId ?? "");
  const [dayRange, setDayRange] = useState<DayRange>(30);
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set());
  const [localSteps, setLocalSteps] = useState<StepMap>(new Map());
  const [isDirty, setIsDirty] = useState(false);
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);

  const campaignsQ = useQuery<HexmailCampaign[]>({
    queryKey: ["hexmail-campaigns"],
    queryFn: () => listHexmailCampaigns({ data: {} }),
  });

  const campaignQ = useQuery({
    queryKey: ["hexmail-campaign-steps", campaignId],
    queryFn: () => getHexmailCampaignWithSteps({ data: { id: campaignId } }),
    enabled: !!campaignId,
    throwOnError: false,
  });

  const templatesQ = useQuery({
    queryKey: ["hexmail-templates"],
    queryFn: () => listHexmailTemplates({ data: { includeArchived: false } }),
    throwOnError: false,
  });

  useEffect(() => {
    if (campaignQ.data?.steps) {
      const map: StepMap = new Map();
      for (const step of campaignQ.data.steps as any[]) {
        map.set(step.day_number, step.actions ?? []);
      }
      setLocalSteps(map);
      setIsDirty(false);
      setExpandedDays(new Set());
    }
  }, [campaignQ.data]);

  useEffect(() => {
    if (initialCampaignId) setCampaignId(initialCampaignId);
  }, [initialCampaignId]);

  const saveMut = useMutation({
    mutationFn: () => {
      const campaign = campaignQ.data;
      if (!campaign) throw new Error("No campaign loaded");
      return saveHexmailCampaign({
        data: {
          id: campaign.id,
          name: campaign.name,
          description: campaign.description ?? null,
          status: campaign.status,
          steps: Array.from(localSteps.entries())
            .filter(([, actions]) => actions.length > 0)
            .map(([day_number, actions]) => ({ day_number, actions })),
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hexmail-campaign-steps", campaignId] });
      setIsDirty(false);
      toast.success("Campaign saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const createMut = useMutation({
    mutationFn: ({ name, description }: { name: string; description: string }) =>
      saveHexmailCampaign({ data: { name, description, steps: [] } }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["hexmail-campaigns"] });
      setCampaignId(result.id);
      setNewCampaignOpen(false);
      toast.success("Campaign created");
    },
    onError: (e: any) => toast.error(e?.message ?? "Create failed"),
  });

  const toggleDay = (day: number) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const setDayActions = (day: number, actions: Action[]) => {
    setLocalSteps((prev) => {
      const next = new Map(prev);
      if (actions.length === 0) next.delete(day);
      else next.set(day, actions);
      return next;
    });
    setIsDirty(true);
    if (!expandedDays.has(day)) {
      setExpandedDays((prev) => new Set([...prev, day]));
    }
  };

  const campaigns = campaignsQ.data ?? [];
  const templates = templatesQ.data ?? [];
  const days = Array.from({ length: dayRange }, (_, i) => i + 1);
  const configuredDays = localSteps.size;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: campaign selector */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
          <Select value={campaignId || "none"} onValueChange={(v) => v !== "none" && setCampaignId(v)}>
            <SelectTrigger className="w-64 text-sm">
              <SelectValue placeholder="Select a campaign…" />
            </SelectTrigger>
            <SelectContent>
              {campaigns.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No campaigns yet</div>
              )}
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-sm">
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {campaignQ.isLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}

          {configuredDays > 0 && (
            <span className="text-xs text-muted-foreground">
              {configuredDays} day{configuredDays !== 1 ? "s" : ""} configured
            </span>
          )}
        </div>

        {/* Right: day range + actions */}
        <div className="flex items-center gap-2">
          {/* Day range toggle */}
          <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 gap-0.5">
            {DAY_RANGES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDayRange(d)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  dayRange === d
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {d}d
              </button>
            ))}
          </div>

          {isDirty && (
            <Button
              size="sm"
              className="gap-1.5 h-8"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || !campaignId}
            >
              {saveMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8"
            onClick={() => setNewCampaignOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            New Campaign
          </Button>
        </div>
      </div>

      {/* Empty state: no campaign selected */}
      {!campaignId && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
          <div className="rounded-full bg-primary/10 p-4">
            <Zap className="h-8 w-8 text-primary" />
          </div>
          <div>
            <p className="font-medium">No campaign selected</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Select a campaign from the dropdown above or create a new one.
            </p>
          </div>
          <Button className="gap-1.5" onClick={() => setNewCampaignOpen(true)}>
            <Plus className="h-4 w-4" />
            New Campaign
          </Button>
        </div>
      )}

      {/* Day range rows */}
      {!!campaignId && (
        <div className="space-y-1.5">
          {days.map((day) => (
            <DayRow
              key={day}
              dayNumber={day}
              actions={localSteps.get(day) ?? []}
              isExpanded={expandedDays.has(day)}
              onToggle={() => toggleDay(day)}
              templates={templates}
              onChange={(actions) => setDayActions(day, actions)}
            />
          ))}
        </div>
      )}

      {/* New Campaign dialog */}
      <NewCampaignDialog
        open={newCampaignOpen}
        onClose={() => setNewCampaignOpen(false)}
        onCreate={(name, description) => createMut.mutate({ name, description })}
        isPending={createMut.isPending}
      />
    </div>
  );
}
