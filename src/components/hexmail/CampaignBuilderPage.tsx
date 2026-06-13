import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Plus,
  Trash2,
  MoreHorizontal,
  Save,
  Wand2,
  Pencil,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  saveHexmailCampaign,
  getHexmailCampaignWithSteps,
} from "@/lib/hexmail/campaigns.functions";
import {
  listHexmailTemplates,
  type HexmailTemplate,
} from "@/lib/hexmail/templates.functions";
import { TemplateBuilder } from "./TemplateBuilder";

const TOTAL_DAYS = 90;

const SAMPLE_MERGE: Record<string, string> = {
  "{{contact_name}}": "Alex",
  "{{company_name}}": "WebeSpokeAI",
  "{{agent_name}}": "Sarah Johnson",
  "{{appointment_date}}": new Date().toLocaleDateString(),
  "{{pipeline_stage}}": "Negotiation",
  "{{custom_fields}}": "[custom value]",
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

  const [name, setName] = useState("90-Day Follow-Up Campaign");
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [dayAssignments, setDayAssignments] = useState<Record<number, string | null>>({});
  const [mergeData, setMergeData] = useState(true);
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
        const firstAction = step.actions?.[0];
        if (firstAction?.template_id) {
          assignments[step.day_number] = firstAction.template_id;
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
          actions: [
            {
              id: crypto.randomUUID(),
              type: "email" as const,
              template_id: tid!,
              notes: "",
              config: {},
            },
          ],
        }));
      return saveHexmailCampaign({
        data: {
          id: campaignId,
          name,
          steps,
        },
      });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["hexmail-campaigns"] });
      onSaved(result.id);
    },
  });

  const autoAssign = () => {
    if (emailTemplates.length === 0) return;
    const next: Record<number, string | null> = {};
    for (let d = 1; d <= TOTAL_DAYS; d++) {
      next[d] = emailTemplates[(d - 1) % emailTemplates.length].id;
    }
    setDayAssignments(next);
  };

  const clearAll = () => setDayAssignments({});

  const assignTemplateToDay = (day: number, templateId: string | null) => {
    setDayAssignments((prev) => ({ ...prev, [day]: templateId }));
  };

  const assignSelectedTemplateCardToDay = (templateId: string) => {
    assignTemplateToDay(selectedDay, templateId);
  };

  const selectedTemplate = (() => {
    const tid = dayAssignments[selectedDay];
    return tid ? allTemplates.find((t) => t.id === tid) ?? null : null;
  })();

  const assignedCount = Object.values(dayAssignments).filter(Boolean).length;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 15% 40%, rgba(76,0,160,0.45) 0%, transparent 45%)," +
          "radial-gradient(ellipse at 80% 10%, rgba(20,0,140,0.5) 0%, transparent 45%)," +
          "radial-gradient(ellipse at 50% 90%, rgba(8,0,60,0.6) 0%, transparent 50%)," +
          "linear-gradient(180deg, #090920 0%, #040415 100%)",
      }}
    >
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-primary/30 border border-primary/40 flex items-center justify-center shrink-0">
            <span className="text-sm">✉️</span>
          </div>
          <div className="min-w-0">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 border-0 bg-transparent text-white font-bold text-base p-0 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-white/40"
              placeholder="Campaign name…"
            />
            <p className="text-[11px] text-white/40 mt-0.5">
              {assignedCount} of {TOTAL_DAYS} days assigned
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-xs border-0"
            onClick={() => { setEditingTemplate(undefined); setTemplateBuilderOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" />
            Create New Template
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs border-white/20 text-white/80 bg-white/5 hover:bg-white/10 hover:text-white"
            onClick={autoAssign}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Auto-Assign Templates
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs border-white/20 text-white/80 bg-white/5 hover:bg-white/10 hover:text-white"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
                More Options
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={clearAll} className="text-destructive focus:text-destructive">
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
            <Save className="h-3.5 w-3.5" />
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      {/* ── Email Templates row ───────────────────────────────────────────────── */}
      <div className="shrink-0 px-5 pt-4 pb-2">
        <h2 className="text-white/90 font-semibold text-sm mb-3">Email Templates</h2>
        {emailTemplates.length === 0 ? (
          <div className="flex items-center gap-3 py-2">
            <button
              onClick={() => { setEditingTemplate(undefined); setTemplateBuilderOpen(true); }}
              className="flex items-center gap-2 rounded-xl border-2 border-dashed border-white/20 bg-white/5 px-5 py-3 text-xs text-white/50 hover:border-white/40 hover:text-white/70 transition-colors"
            >
              <Plus className="h-4 w-4" /> Create your first email template
            </button>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
            {emailTemplates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                isSelected={dayAssignments[selectedDay] === t.id}
                onUse={() => assignSelectedTemplateCardToDay(t.id)}
                onEdit={() => { setEditingTemplate(t); setTemplateBuilderOpen(true); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Main area: Timeline + Preview ───────────────────────────────────── */}
      <div className="flex-1 flex gap-4 px-5 pb-5 min-h-0 overflow-hidden">
        {/* Campaign Timeline */}
        <div className="flex-1 flex flex-col min-w-0">
          <h2 className="text-white/90 font-semibold text-sm mb-3 shrink-0">
            Campaign Timeline
          </h2>
          <div className="flex-1 overflow-y-auto pr-1">
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: "repeat(9, minmax(0, 1fr))" }}
            >
              {Array.from({ length: TOTAL_DAYS }, (_, i) => i + 1).map((day) => {
                const tid = dayAssignments[day] ?? null;
                const tmpl = tid ? allTemplates.find((t) => t.id === tid) : null;
                const isSelected = selectedDay === day;
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDay(day)}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-left transition-all",
                      "hover:border-primary/60 hover:bg-primary/10",
                      isSelected
                        ? "border-primary bg-primary/20 shadow-[0_0_12px_rgba(79,140,255,0.4)]"
                        : tid
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-white/10 bg-white/5",
                    )}
                  >
                    <p
                      className={cn(
                        "text-[10px] font-bold mb-1",
                        isSelected ? "text-primary" : "text-white/60",
                      )}
                    >
                      Day {day}
                    </p>
                    <p
                      className={cn(
                        "text-[9px] truncate",
                        tid
                          ? isSelected
                            ? "text-white/90"
                            : "text-emerald-400"
                          : "text-white/30",
                      )}
                    >
                      {tmpl ? tmpl.name : "(none)"}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Email Preview */}
        <div className="w-72 shrink-0 flex flex-col">
          <h2 className="text-white/90 font-semibold text-sm mb-3 shrink-0">
            Email Preview
          </h2>
          <div className="flex-1 rounded-xl border border-white/15 bg-white/5 backdrop-blur-sm flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 space-y-2 shrink-0">
              <p className="text-[11px] text-white/50">
                Previewing:{" "}
                <span className="text-white/80 font-medium">
                  Day {selectedDay} {selectedTemplate ? `(${selectedTemplate.name})` : ""}
                </span>
              </p>

              {/* Template selector for this day */}
              <Select
                value={dayAssignments[selectedDay] ?? "__none__"}
                onValueChange={(v) =>
                  assignTemplateToDay(selectedDay, v === "__none__" ? null : v)
                }
              >
                <SelectTrigger className="h-8 text-xs bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="Assign template…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs text-muted-foreground">
                    (none)
                  </SelectItem>
                  {emailTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2">
                <Switch
                  id="merge-data"
                  checked={mergeData}
                  onCheckedChange={setMergeData}
                  className="h-4 w-7 data-[state=checked]:bg-primary"
                />
                <Label htmlFor="merge-data" className="text-[11px] text-white/60 cursor-pointer">
                  Merge Data
                </Label>
                {mergeData && (
                  <span className="text-[9px] text-white/30 ml-auto">
                    {Object.entries(SAMPLE_MERGE)
                      .map(([k]) => k.replace(/[{}]/g, ""))
                      .slice(0, 2)
                      .join(", ")}…
                  </span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {selectedTemplate ? (
                <div className="space-y-3">
                  {selectedTemplate.subject && (
                    <div>
                      <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Subject</p>
                      <p className="text-sm text-white/90 font-medium">
                        {mergeData ? applyMerge(selectedTemplate.subject) : selectedTemplate.subject}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Body</p>
                    <p className="text-xs text-white/80 whitespace-pre-wrap leading-relaxed">
                      {mergeData
                        ? applyMerge(selectedTemplate.content)
                        : selectedTemplate.content}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                  <Eye className="h-8 w-8 text-white/20" />
                  <p className="text-xs text-white/40">
                    Select a template above to preview Day {selectedDay}
                  </p>
                </div>
              )}
            </div>
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
        "shrink-0 w-[160px] rounded-xl border p-3 flex flex-col gap-2 transition-all",
        isSelected
          ? "border-primary/60 bg-primary/15 shadow-[0_0_16px_rgba(79,140,255,0.3)]"
          : "border-white/15 bg-white/8 hover:border-white/25 hover:bg-white/10",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-semibold text-white/90 leading-tight line-clamp-2 flex-1">
          {template.name}
        </p>
        {isSelected && (
          <div className="h-2 w-2 rounded-full bg-emerald-400 shrink-0 mt-0.5" />
        )}
      </div>
      <p className="text-[10px] text-white/50 line-clamp-3 leading-relaxed flex-1">
        {template.content || template.subject || "No preview available"}
      </p>
      <div className="flex gap-1.5 mt-auto">
        <Button
          size="sm"
          variant="outline"
          className="h-6 flex-1 text-[10px] border-white/20 bg-white/5 text-white/70 hover:bg-white/15 hover:text-white px-2"
          onClick={onEdit}
        >
          <Pencil className="h-2.5 w-2.5 mr-1" />
          Edit
        </Button>
        <Button
          size="sm"
          className="h-6 flex-1 text-[10px] px-2"
          onClick={onUse}
        >
          Use
        </Button>
      </div>
    </div>
  );
}
