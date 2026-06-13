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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  saveHexmailCampaign,
  getHexmailCampaignWithSteps,
} from "@/lib/hexmail/campaigns.functions";
import {
  listHexmailTemplates,
  type HexmailTemplate,
} from "@/lib/hexmail/templates.functions";
import { TemplateBuilder } from "./TemplateBuilder";

const DAY_RANGES = [7, 14, 30, 90] as const;
type DayRange = (typeof DAY_RANGES)[number];

const GRID_COLS: Record<DayRange, number> = { 7: 7, 14: 7, 30: 6, 90: 9 };

const SAMPLE_MERGE: Record<string, string> = {
  "{{contact_name}}":     "Alex",
  "{{company_name}}":     "WebeSpokeAI",
  "{{agent_name}}":       "Sarah Johnson",
  "{{appointment_date}}": new Date().toLocaleDateString(),
  "{{pipeline_stage}}":   "Negotiation",
  "{{custom_fields}}":    "[custom value]",
};

function applyMerge(text: string): string {
  return Object.entries(SAMPLE_MERGE).reduce((t, [k, v]) => t.replaceAll(k, v), text);
}

interface Props {
  campaignId?: string;
  onBack: () => void;
  onSaved: (newId: string) => void;
}

export function CampaignBuilderPage({ campaignId, onBack, onSaved }: Props) {
  const qc = useQueryClient();

  const [name, setName]                   = useState("Follow-Up Campaign");
  const [dayRange, setDayRange]           = useState<DayRange>(30);
  const [selectedDay, setSelectedDay]     = useState<number>(1);
  const [dayAssignments, setDayAssignments] = useState<Record<number, string | null>>({});
  const [mergeData, setMergeData]         = useState(true);
  const [openDay, setOpenDay]             = useState<number | null>(null);
  const [templateBuilderOpen, setTemplateBuilderOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<HexmailTemplate | undefined>();

  const { data: existingCampaign } = useQuery({
    queryKey: ["hexmail-campaign-steps", campaignId],
    queryFn: () => getHexmailCampaignWithSteps({ data: { id: campaignId! } }),
    enabled: !!campaignId,
  });

  const { data: allTemplates = [] } = useQuery<HexmailTemplate[]>({
    queryKey: ["hexmail-templates"],
    queryFn: () => listHexmailTemplates({ data: { includeArchived: false } }),
  });

  const emailTemplates = allTemplates.filter((t) => t.type === "email");

  useEffect(() => {
    if (existingCampaign) {
      setName(existingCampaign.name);
      const assignments: Record<number, string | null> = {};
      for (const step of existingCampaign.steps ?? []) {
        const firstAction = (step as any).actions?.[0];
        if (firstAction?.template_id) {
          assignments[(step as any).day_number] = firstAction.template_id;
        }
      }
      setDayAssignments(assignments);
    }
  }, [existingCampaign]);

  const save = useMutation({
    mutationFn: () => {
      const steps = Object.entries(dayAssignments)
        .filter(([, tid]) => !!tid)
        .map(([day, tid]) => ({
          day_number: parseInt(day),
          actions: [{
            id: crypto.randomUUID(),
            type: "email" as const,
            template_id: tid!,
            notes: "",
            config: {},
          }],
        }));
      return saveHexmailCampaign({ data: { id: campaignId, name, steps } });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["hexmail-campaigns"] });
      toast.success("Campaign saved");
      onSaved(result.id);
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const autoAssign = () => {
    if (emailTemplates.length === 0) return;
    const next: Record<number, string | null> = {};
    for (let d = 1; d <= dayRange; d++) {
      next[d] = emailTemplates[(d - 1) % emailTemplates.length].id;
    }
    setDayAssignments(next);
  };

  const assignTemplate = (day: number, templateId: string | null) => {
    setDayAssignments((prev) => ({ ...prev, [day]: templateId }));
    setSelectedDay(day);
    setOpenDay(null);
  };

  const selectedTemplate = (() => {
    const tid = dayAssignments[selectedDay];
    return tid ? allTemplates.find((t) => t.id === tid) ?? null : null;
  })();

  const assignedCount = Object.entries(dayAssignments).filter(
    ([d, tid]) => !!tid && parseInt(d) <= dayRange,
  ).length;

  const days = Array.from({ length: dayRange }, (_, i) => i + 1);
  const cols = GRID_COLS[dayRange];

  return (
    <div className="flex flex-col h-full overflow-hidden rounded-lg border bg-card">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b bg-background">
        {/* Campaign name */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="h-7 w-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-sm">
            ✉️
          </div>
          <div className="min-w-0 flex-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 border-0 bg-transparent font-semibold text-sm p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              placeholder="Campaign name…"
            />
            <p className="text-[11px] text-muted-foreground">
              {assignedCount} of {dayRange} days assigned
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

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => { setEditingTemplate(undefined); setTemplateBuilderOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" />
            New Template
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={autoAssign}
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
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onClick={() => setDayAssignments({})}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Clear All Days
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

      {/* ── Template strip ──────────────────────────────────────── */}
      <div className="shrink-0 px-4 pt-3 pb-2 border-b bg-muted/20">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Email Templates — click a day cell below to assign
        </p>
        {emailTemplates.length === 0 ? (
          <button
            onClick={() => { setEditingTemplate(undefined); setTemplateBuilderOpen(true); }}
            className="flex items-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-2.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
          >
            <Plus className="h-4 w-4" /> Create your first email template
          </button>
        ) : (
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {emailTemplates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                isSelected={dayAssignments[selectedDay] === t.id}
                onUse={() => assignTemplate(selectedDay, t.id)}
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
              const tid   = dayAssignments[day] ?? null;
              const tmpl  = tid ? allTemplates.find((t) => t.id === tid) : null;
              const isSelected = selectedDay === day;

              return (
                <Popover
                  key={day}
                  open={openDay === day}
                  onOpenChange={(v) => {
                    setOpenDay(v ? day : null);
                    if (v) setSelectedDay(day);
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "rounded-md border px-2 py-2 text-left transition-all w-full",
                        "hover:border-primary/50 hover:bg-primary/5",
                        isSelected && openDay === day
                          ? "border-primary bg-primary/10 ring-1 ring-primary/30 shadow-sm"
                          : isSelected
                          ? "border-primary/40 bg-primary/5"
                          : tid
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : "border-border bg-card",
                      )}
                    >
                      <p className={cn(
                        "text-[10px] font-bold mb-0.5",
                        isSelected ? "text-primary" : "text-muted-foreground",
                      )}>
                        Day {day}
                      </p>
                      <p className={cn(
                        "text-[9px] truncate leading-tight",
                        tid
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground/40",
                      )}>
                        {tmpl ? tmpl.name : "—"}
                      </p>
                    </button>
                  </PopoverTrigger>

                  <PopoverContent
                    className="w-64 p-2"
                    align="start"
                    side="bottom"
                    sideOffset={4}
                  >
                    <p className="text-xs font-semibold text-foreground mb-2 px-1">
                      Day {day} — assign template
                    </p>

                    {emailTemplates.length === 0 ? (
                      <div className="px-1 py-3 text-xs text-muted-foreground text-center">
                        No templates yet.{" "}
                        <button
                          className="text-primary hover:underline"
                          onClick={() => { setOpenDay(null); setTemplateBuilderOpen(true); }}
                        >
                          Create one
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-0.5 max-h-56 overflow-y-auto">
                        {emailTemplates.map((t) => {
                          const isAssigned = tid === t.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => assignTemplate(day, isAssigned ? null : t.id)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                                isAssigned
                                  ? "bg-primary/10 text-primary"
                                  : "hover:bg-muted text-foreground",
                              )}
                            >
                              <CheckCircle2
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0",
                                  isAssigned ? "text-primary" : "text-muted-foreground/30",
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

                        {/* Clear option */}
                        {tid && (
                          <button
                            type="button"
                            onClick={() => assignTemplate(day, null)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/5 transition-colors mt-1 border-t pt-2"
                          >
                            <X className="h-3.5 w-3.5" />
                            Remove template from Day {day}
                          </button>
                        )}
                      </div>
                    )}
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
              <Label
                htmlFor="merge-data"
                className="text-[11px] text-muted-foreground cursor-pointer"
              >
                Show merge data
              </Label>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {selectedTemplate ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5">
                    {selectedTemplate.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => assignTemplate(selectedDay, null)}
                    className="text-[10px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-0.5"
                  >
                    <X className="h-3 w-3" /> Remove
                  </button>
                </div>
                {selectedTemplate.subject && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Subject</p>
                    <p className="text-xs font-medium text-foreground leading-relaxed">
                      {mergeData ? applyMerge(selectedTemplate.subject) : selectedTemplate.subject}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Body</p>
                  <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
                    {mergeData ? applyMerge(selectedTemplate.content) : selectedTemplate.content}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-8">
                <Eye className="h-7 w-7 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  Click any day cell to assign a template.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Template Builder dialog */}
      <TemplateBuilder
        open={templateBuilderOpen}
        template={editingTemplate}
        onClose={() => setTemplateBuilderOpen(false)}
        onSaved={() => {
          setTemplateBuilderOpen(false);
          qc.invalidateQueries({ queryKey: ["hexmail-templates"] });
        }}
      />
    </div>
  );
}

function TemplateCard({
  template,
  isSelected,
  onUse,
  onEdit,
}: {
  template: HexmailTemplate;
  isSelected: boolean;
  onUse: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className={cn(
        "shrink-0 w-[148px] rounded-lg border p-2.5 flex flex-col gap-2 transition-all",
        isSelected
          ? "border-primary/60 bg-primary/8 shadow-sm ring-1 ring-primary/20"
          : "border-border bg-card hover:border-primary/30 hover:bg-muted/30",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-semibold text-foreground leading-tight line-clamp-2 flex-1">
          {template.name}
        </p>
        {isSelected && <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0 mt-0.5" />}
      </div>
      <p className="text-[10px] text-muted-foreground line-clamp-3 leading-relaxed flex-1">
        {template.content || template.subject || "No preview"}
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
