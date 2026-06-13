import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Trash2,
  MoreHorizontal,
  Save,
  Wand2,
  Pencil,
  Eye,
  Loader2,
  CheckCircle2,
  X,
  Mail,
  MessageSquare,
  MessageCircle,
  FileText,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  saveHexmailCampaign,
  getHexmailCampaignWithSteps,
  type ActionType,
} from "@/lib/hexmail/campaigns.functions";
import {
  listHexmailTemplates,
  type HexmailTemplate,
  type TemplateType,
} from "@/lib/hexmail/templates.functions";
import { TemplateBuilder } from "./TemplateBuilder";
import { splitContent } from "@/lib/hexmail/vars-helpers";

// ── Channel definitions ────────────────────────────────────────────────────────

type Channel = "email" | "whatsapp" | "sms" | "document";

// All TemplateTypes that belong to the document channel
const DOC_TEMPLATE_TYPES: TemplateType[] = [
  "document", "proposal", "quote", "invoice", "contract",
];

interface ChannelDef {
  type: Channel;
  templateTypes: TemplateType[];   // one or more template types this channel accepts
  actionType: ActionType;
  label: string;
  icon: React.ElementType;
  pill: string;
  dot: string;
  ring: string;
}

const CHANNELS: ChannelDef[] = [
  {
    type: "email",
    templateTypes: ["email"],
    actionType: "email",
    label: "Email",
    icon: Mail,
    pill: "bg-sky-500/15 text-sky-400 border-sky-500/25",
    dot: "bg-sky-400",
    ring: "ring-sky-500/30",
  },
  {
    type: "whatsapp",
    templateTypes: ["whatsapp"],
    actionType: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    pill: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    dot: "bg-emerald-400",
    ring: "ring-emerald-500/30",
  },
  {
    type: "sms",
    templateTypes: ["sms"],
    actionType: "sms",
    label: "SMS",
    icon: MessageSquare,
    pill: "bg-violet-500/15 text-violet-400 border-violet-500/25",
    dot: "bg-violet-400",
    ring: "ring-violet-500/30",
  },
  {
    type: "document",
    templateTypes: DOC_TEMPLATE_TYPES,
    actionType: "task",
    label: "Document",
    icon: FileText,
    pill: "bg-amber-500/15 text-amber-400 border-amber-500/25",
    dot: "bg-amber-400",
    ring: "ring-amber-500/30",
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

const DAY_RANGES = [7, 14, 30, 90] as const;
type DayRange = (typeof DAY_RANGES)[number];
const GRID_COLS: Record<DayRange, number> = { 7: 7, 14: 7, 30: 6, 90: 9 };

// dayAssignments[day][channel] = templateId | null
type DayAssignments = Record<number, Partial<Record<Channel, string | null>>>;

const SAMPLE_MERGE: Record<string, string> = {
  "{{contact_name}}":     "Alex",
  "{{company_name}}":     "WebeSpokeAI",
  "{{agent_name}}":       "Sarah Johnson",
  "{{appointment_date}}": new Date().toLocaleDateString(),
  "{{pipeline_stage}}":   "Negotiation",
  "{{custom_fields}}":    "[custom value]",
};
function applyMerge(text: string) {
  return Object.entries(SAMPLE_MERGE).reduce((t, [k, v]) => t.replaceAll(k, v), text);
}

function getChannelDef(ch: Channel) {
  return CHANNELS.find((c) => c.type === ch)!;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ChannelTabs({
  active,
  onChange,
  templatesByChannel,
}: {
  active: Channel;
  onChange: (ch: Channel) => void;
  templatesByChannel: Record<Channel, HexmailTemplate[]>;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-muted/30 p-0.5">
      {CHANNELS.map((ch) => {
        const Icon = ch.icon;
        const count = templatesByChannel[ch.type]?.length ?? 0;
        return (
          <button
            key={ch.type}
            type="button"
            onClick={() => onChange(ch.type)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              active === ch.type
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {ch.label}
            {count > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TemplateCard({
  template,
  channel,
  isSelected,
  onUse,
  onEdit,
}: {
  template: HexmailTemplate;
  channel: ChannelDef;
  isSelected: boolean;
  onUse: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className={cn(
        "shrink-0 w-[148px] rounded-lg border p-2.5 flex flex-col gap-2 transition-all",
        isSelected
          ? `border-2 shadow-sm ring-1 ${channel.ring} bg-background border-current`
          : "border-border bg-card hover:border-primary/30 hover:bg-muted/30",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className={cn("flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-medium", channel.pill)}>
          <channel.icon className="h-3 w-3" />
          {channel.label}
        </div>
        {isSelected && <div className={cn("h-2 w-2 rounded-full shrink-0 mt-0.5", channel.dot)} />}
      </div>
      <p className="text-xs font-semibold text-foreground leading-tight line-clamp-2">
        {template.name}
      </p>
      <p className="text-[10px] text-muted-foreground line-clamp-3 leading-relaxed flex-1">
        {splitContent(template.content ?? "").body || template.subject || "No preview"}
      </p>
      <div className="flex gap-1.5 mt-auto">
        <Button size="sm" variant="outline" className="h-6 flex-1 text-[10px] px-2" onClick={onEdit}>
          <Pencil className="h-2.5 w-2.5 mr-1" /> Edit
        </Button>
        <Button size="sm" className="h-6 flex-1 text-[10px] px-2" onClick={onUse}>
          Use
        </Button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  campaignId?: string;
  onBack: () => void;
  onSaved: (newId: string) => void;
}

export function CampaignBuilderPage({ campaignId, onBack, onSaved }: Props) {
  const qc = useQueryClient();

  const [name, setName]                 = useState("Multi-Channel Campaign");
  const [dayRange, setDayRange]         = useState<DayRange>(30);
  const [activeChannel, setActiveChannel] = useState<Channel>("email");
  const [selectedDay, setSelectedDay]   = useState<number>(1);
  const [dayAssignments, setDayAssignments] = useState<DayAssignments>({});
  const [mergeData, setMergeData]       = useState(true);
  const [openDay, setOpenDay]           = useState<number | null>(null);
  const [popoverChannel, setPopoverChannel] = useState<Channel>("email");
  const [templateBuilderOpen, setTemplateBuilderOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<HexmailTemplate | undefined>();
  const [newTemplateChannel, setNewTemplateChannel] = useState<TemplateType>("email");

  const { data: existingCampaign } = useQuery({
    queryKey: ["hexmail-campaign-steps", campaignId],
    queryFn: () => getHexmailCampaignWithSteps({ data: { id: campaignId! } }),
    enabled: !!campaignId,
  });

  const { data: allTemplates = [] } = useQuery<HexmailTemplate[]>({
    queryKey: ["hexmail-templates"],
    queryFn: () => listHexmailTemplates({ data: { includeArchived: false } }),
  });

  // Build template lookup by channel type (document channel spans all doc sub-types)
  const templatesByChannel = CHANNELS.reduce(
    (acc, ch) => {
      acc[ch.type] = allTemplates.filter((t) => ch.templateTypes.includes(t.type));
      return acc;
    },
    {} as Record<Channel, HexmailTemplate[]>,
  );

  useEffect(() => {
    if (existingCampaign) {
      setName(existingCampaign.name);
      const assignments: DayAssignments = {};
      for (const step of existingCampaign.steps ?? []) {
        const dayNum = (step as any).day_number;
        assignments[dayNum] = {};
        for (const action of (step as any).actions ?? []) {
          const ch = CHANNELS.find((c) => c.actionType === action.type || c.type === action.type);
          if (ch && action.template_id) {
            assignments[dayNum][ch.type] = action.template_id;
          }
        }
      }
      setDayAssignments(assignments);
    }
  }, [existingCampaign]);

  const assignTemplate = (day: number, channel: Channel, templateId: string | null) => {
    setDayAssignments((prev) => ({
      ...prev,
      [day]: { ...(prev[day] ?? {}), [channel]: templateId },
    }));
    setSelectedDay(day);
  };

  const openNewTemplate = (ch: Channel) => {
    setNewTemplateChannel(ch as TemplateType);
    setEditingTemplate(undefined);
    setTemplateBuilderOpen(true);
  };

  const autoAssign = () => {
    const templates = templatesByChannel[activeChannel];
    if (templates.length === 0) return;
    const next: DayAssignments = { ...dayAssignments };
    for (let d = 1; d <= dayRange; d++) {
      next[d] = { ...(next[d] ?? {}), [activeChannel]: templates[(d - 1) % templates.length].id };
    }
    setDayAssignments(next);
  };

  const save = useMutation({
    mutationFn: () => {
      const steps = Array.from({ length: dayRange }, (_, i) => i + 1)
        .map((day) => {
          const channelMap = dayAssignments[day] ?? {};
          const actions = CHANNELS
            .filter((ch) => channelMap[ch.type])
            .map((ch) => ({
              id: crypto.randomUUID(),
              type: ch.actionType,
              template_id: channelMap[ch.type]!,
              notes: "",
              config: {},
            }));
          return { day_number: day, actions };
        })
        .filter((s) => s.actions.length > 0);
      return saveHexmailCampaign({ data: { id: campaignId, name, steps } });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["hexmail-campaigns"] });
      toast.success("Campaign saved");
      onSaved(result.id);
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  // Stats
  const assignedDays = new Set(
    Object.entries(dayAssignments)
      .filter(([d, m]) => parseInt(d) <= dayRange && Object.values(m ?? {}).some(Boolean))
      .map(([d]) => parseInt(d)),
  ).size;

  const totalActions = Object.entries(dayAssignments)
    .filter(([d]) => parseInt(d) <= dayRange)
    .reduce((sum, [, m]) => sum + Object.values(m ?? {}).filter(Boolean).length, 0);

  const days = Array.from({ length: dayRange }, (_, i) => i + 1);
  const cols = GRID_COLS[dayRange];

  const currentChannelDef = getChannelDef(activeChannel);
  const currentTemplates = templatesByChannel[activeChannel] ?? [];

  // For preview panel
  const selectedDayMap = dayAssignments[selectedDay] ?? {};
  const previewChannels = CHANNELS.filter((ch) => selectedDayMap[ch.type]);

  return (
    <div className="flex flex-col h-full overflow-hidden rounded-lg border bg-card">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b bg-background">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="h-7 w-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 border-0 bg-transparent font-semibold text-sm p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              placeholder="Campaign name…"
            />
            <p className="text-[11px] text-muted-foreground">
              {assignedDays} day{assignedDays !== 1 ? "s" : ""} · {totalActions} action{totalActions !== 1 ? "s" : ""} assigned
            </p>
          </div>
        </div>

        {/* Day range toggle */}
        <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 gap-0.5 shrink-0">
          {DAY_RANGES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => { setDayRange(d); setSelectedDay(1); setOpenDay(null); }}
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

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={autoAssign}
            disabled={currentTemplates.length === 0}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Auto-Assign
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={() => setDayAssignments({})}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Clear All Assignments
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => save.mutate()}
            disabled={!name.trim() || save.isPending}
          >
            {save.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Save className="h-3.5 w-3.5" />}
            Save
          </Button>
        </div>
      </header>

      {/* ── Channel tabs + template strip ───────────────────────── */}
      <div className="shrink-0 px-4 pt-3 pb-2 border-b bg-muted/10 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <ChannelTabs
            active={activeChannel}
            onChange={setActiveChannel}
            templatesByChannel={templatesByChannel}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs shrink-0"
            onClick={() => openNewTemplate(activeChannel)}
          >
            <Plus className="h-3.5 w-3.5" />
            New {currentChannelDef.label} Template
          </Button>
        </div>

        {/* Template strip for active channel */}
        {currentTemplates.length === 0 ? (
          <button
            onClick={() => openNewTemplate(activeChannel)}
            className="flex items-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-2.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors w-full"
          >
            <currentChannelDef.icon className="h-4 w-4" />
            Create your first {currentChannelDef.label.toLowerCase()} template — then click any day cell to assign it
          </button>
        ) : (
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {currentTemplates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                channel={currentChannelDef}
                isSelected={dayAssignments[selectedDay]?.[activeChannel] === t.id}
                onUse={() => assignTemplate(selectedDay, activeChannel, t.id)}
                onEdit={() => { setEditingTemplate(t); setTemplateBuilderOpen(true); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Main: Grid + Preview ────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Day Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {days.map((day) => {
              const dayMap = dayAssignments[day] ?? {};
              const assignedChannels = CHANNELS.filter((ch) => dayMap[ch.type]);
              const isSelected = selectedDay === day;
              const isOpen = openDay === day;
              const hasAny = assignedChannels.length > 0;
              const activeAssigned = !!dayMap[activeChannel];

              return (
                <Popover
                  key={day}
                  open={isOpen}
                  onOpenChange={(v) => {
                    setOpenDay(v ? day : null);
                    setPopoverChannel(activeChannel);
                    if (v) setSelectedDay(day);
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "rounded-md border px-2 py-2 text-left transition-all w-full min-h-[56px]",
                        "hover:border-primary/50 hover:bg-primary/5",
                        isSelected && isOpen
                          ? "border-primary bg-primary/10 ring-1 ring-primary/30 shadow-sm"
                          : isSelected
                          ? "border-primary/40 bg-primary/5"
                          : hasAny
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : "border-border bg-card",
                      )}
                    >
                      <p className={cn(
                        "text-[10px] font-bold mb-1",
                        isSelected ? "text-primary" : "text-muted-foreground",
                      )}>
                        Day {day}
                      </p>
                      {/* Channel dots */}
                      {assignedChannels.length > 0 ? (
                        <div className="flex flex-wrap gap-0.5">
                          {assignedChannels.map((ch) => (
                            <span
                              key={ch.type}
                              title={ch.label}
                              className={cn(
                                "inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[9px] font-medium",
                                ch.pill,
                              )}
                            >
                              <ch.icon className="h-2.5 w-2.5" />
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[9px] text-muted-foreground/40 leading-tight">—</p>
                      )}
                    </button>
                  </PopoverTrigger>

                  <PopoverContent className="w-72 p-2" align="start" side="bottom" sideOffset={4}>
                    <div className="flex items-center justify-between gap-2 mb-2 px-1">
                      <p className="text-xs font-semibold text-foreground">Day {day}</p>
                      {/* Mini channel switcher in popover */}
                      <div className="flex items-center gap-0.5">
                        {CHANNELS.map((ch) => {
                          const Icon = ch.icon;
                          return (
                            <button
                              key={ch.type}
                              type="button"
                              title={ch.label}
                              onClick={() => setPopoverChannel(ch.type)}
                              className={cn(
                                "flex h-6 w-6 items-center justify-center rounded transition-colors",
                                popoverChannel === ch.type
                                  ? cn("border", ch.pill)
                                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
                              )}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Template list for selected popover channel */}
                    {(() => {
                      const popoverChDef = getChannelDef(popoverChannel);
                      const popoverTemplates = templatesByChannel[popoverChannel] ?? [];
                      const assignedId = dayAssignments[day]?.[popoverChannel] ?? null;

                      if (popoverTemplates.length === 0) {
                        return (
                          <div className="px-1 py-3 text-xs text-muted-foreground text-center">
                            No {popoverChDef.label.toLowerCase()} templates yet.{" "}
                            <button
                              className="text-primary hover:underline"
                              onClick={() => { setOpenDay(null); openNewTemplate(popoverChannel); }}
                            >
                              Create one
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div className="space-y-0.5 max-h-56 overflow-y-auto">
                          {popoverTemplates.map((t) => {
                            const isAssigned = assignedId === t.id;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => assignTemplate(day, popoverChannel, isAssigned ? null : t.id)}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                                  isAssigned
                                    ? cn("border", popoverChDef.pill)
                                    : "hover:bg-muted text-foreground",
                                )}
                              >
                                <CheckCircle2
                                  className={cn(
                                    "h-3.5 w-3.5 shrink-0",
                                    isAssigned ? "text-current" : "text-muted-foreground/30",
                                  )}
                                />
                                <span className="flex-1 truncate font-medium">{t.name}</span>
                                {t.subject && (
                                  <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                                    {t.subject}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                          {assignedId && (
                            <button
                              type="button"
                              onClick={() => assignTemplate(day, popoverChannel, null)}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/5 transition-colors mt-1 border-t pt-2"
                            >
                              <X className="h-3.5 w-3.5" />
                              Remove from Day {day}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </PopoverContent>
                </Popover>
              );
            })}
          </div>
        </div>

        {/* Preview panel */}
        <div className="w-64 shrink-0 flex flex-col border-l">
          <div className="px-3 py-2.5 border-b bg-muted/20 shrink-0">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Preview — Day {selectedDay}
            </p>
            <div className="flex items-center gap-2">
              <Switch
                id="merge-data"
                checked={mergeData}
                onCheckedChange={setMergeData}
                className="h-4 w-7"
              />
              <Label htmlFor="merge-data" className="text-[11px] text-muted-foreground cursor-pointer">
                Show merge data
              </Label>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {previewChannels.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-8">
                <Eye className="h-7 w-7 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  Click any day cell to assign templates.
                </p>
              </div>
            ) : (
              previewChannels.map((ch) => {
                const tid = selectedDayMap[ch.type]!;
                const tpl = allTemplates.find((t) => t.id === tid);
                if (!tpl) return null;
                return (
                  <div key={ch.type} className="space-y-2">
                    {/* Channel badge */}
                    <div className="flex items-center justify-between">
                      <span className={cn("inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium", ch.pill)}>
                        <ch.icon className="h-3 w-3" />
                        {ch.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => assignTemplate(selectedDay, ch.type, null)}
                        className="text-[10px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-0.5"
                      >
                        <X className="h-3 w-3" /> Remove
                      </button>
                    </div>

                    <div className={cn("rounded-md border p-2.5 space-y-2", ch.pill.split(" ")[0].replace("bg-", "border-").replace("/15", "/20"))}>
                      <p className="text-[11px] font-semibold text-foreground">{tpl.name}</p>
                      {tpl.subject && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Subject</p>
                          <p className="text-xs text-foreground leading-relaxed">
                            {mergeData ? applyMerge(tpl.subject) : tpl.subject}
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Content</p>
                        <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed line-clamp-6">
                          {mergeData ? applyMerge(tpl.content) : tpl.content}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Template Builder dialog */}
      <TemplateBuilder
        open={templateBuilderOpen}
        template={editingTemplate}
        defaultType={newTemplateChannel}
        onClose={() => setTemplateBuilderOpen(false)}
        onSaved={() => {
          setTemplateBuilderOpen(false);
          qc.invalidateQueries({ queryKey: ["hexmail-templates"] });
        }}
      />
    </div>
  );
}
