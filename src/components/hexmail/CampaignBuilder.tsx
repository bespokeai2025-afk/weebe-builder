import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Save, CalendarDays, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  saveHexmailCampaign,
  getHexmailCampaignWithSteps,
  type ActionType,
  type CampaignAction,
} from "@/lib/hexmail/campaigns.functions";
import {
  listHexmailTemplates,
  type HexmailTemplate,
  type TemplateType,
} from "@/lib/hexmail/templates.functions";
import { splitContent } from "@/lib/hexmail/vars-helpers";

const DOC_TEMPLATE_TYPES: TemplateType[] = ["document", "proposal", "quote", "invoice", "contract"];

const ACTION_TYPES: { value: ActionType; label: string; icon: string }[] = [
  { value: "email", label: "Email", icon: "✉️" },
  { value: "whatsapp", label: "WhatsApp", icon: "💬" },
  { value: "sms", label: "SMS", icon: "📱" },
  { value: "ai_call", label: "AI Call", icon: "🤖" },
  { value: "task", label: "Task", icon: "✅" },
  { value: "notification", label: "Notification", icon: "🔔" },
  { value: "pipeline_update", label: "Pipeline Update", icon: "📊" },
  { value: "tag_assignment", label: "Tag Assignment", icon: "🏷️" },
];

// Maps action types to the template type(s) they use for selection
const ACTION_TO_TEMPLATE_TYPES: Partial<Record<ActionType, TemplateType[]>> = {
  email:    ["email"],
  whatsapp: ["whatsapp"],
  sms:      ["sms"],
  task:     DOC_TEMPLATE_TYPES,   // task = "send a document" in follow-up campaigns
};

interface LocalAction extends CampaignAction {}

interface LocalStep {
  tempId: string;
  day_number: number;
  actions: LocalAction[];
}

function makeAction(): LocalAction {
  return {
    id: crypto.randomUUID(),
    type: "email",
    template_id: null,
    notes: "",
    config: {},
  };
}

function makeStep(dayNum: number): LocalStep {
  return {
    tempId: crypto.randomUUID(),
    day_number: dayNum,
    actions: [makeAction()],
  };
}

interface Props {
  open: boolean;
  campaignId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function CampaignBuilder({ open, campaignId, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<LocalStep[]>([]);

  const { data: existingCampaign, isLoading: loadingCampaign } = useQuery({
    queryKey: ["hexmail-campaign-steps", campaignId],
    queryFn: () => getHexmailCampaignWithSteps({ data: { id: campaignId! } }),
    enabled: open && !!campaignId,
    throwOnError: false,
  });

  const { data: templates = [] } = useQuery<HexmailTemplate[]>({
    queryKey: ["hexmail-templates"],
    queryFn: () => listHexmailTemplates({ data: {} }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    if (campaignId && existingCampaign) {
      setName(existingCampaign.name);
      const loadedSteps = (existingCampaign.steps ?? []).map((s) => ({
        tempId: s.id ?? crypto.randomUUID(),
        day_number: s.day_number,
        actions: s.actions.map((a) => ({ ...a })),
      }));
      setSteps(
        loadedSteps.length > 0
          ? loadedSteps
          : [makeStep(1)],
      );
    } else if (!campaignId) {
      setName("");
      setSteps([makeStep(1)]);
    }
  }, [open, campaignId, existingCampaign]);

  const save = useMutation({
    mutationFn: () =>
      saveHexmailCampaign({
        data: {
          id: campaignId,
          name,
          steps: steps.map((s) => ({
            day_number: s.day_number,
            actions: s.actions,
          })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hexmail-campaigns"] });
      onSaved();
    },
  });

  const addDay = () => {
    const max = steps.reduce((m, s) => Math.max(m, s.day_number), 0);
    setSteps((prev) => [...prev, makeStep(max + 1)]);
  };

  const removeStep = (tempId: string) => {
    setSteps((prev) => prev.filter((s) => s.tempId !== tempId));
  };

  const addAction = (tempId: string) => {
    setSteps((prev) =>
      prev.map((s) =>
        s.tempId === tempId ? { ...s, actions: [...s.actions, makeAction()] } : s,
      ),
    );
  };

  const removeAction = (stepTempId: string, actionId: string) => {
    setSteps((prev) =>
      prev.map((s) =>
        s.tempId === stepTempId
          ? { ...s, actions: s.actions.filter((a) => a.id !== actionId) }
          : s,
      ),
    );
  };

  const updateAction = (
    stepTempId: string,
    actionId: string,
    patch: Partial<LocalAction>,
  ) => {
    setSteps((prev) =>
      prev.map((s) =>
        s.tempId === stepTempId
          ? {
              ...s,
              actions: s.actions.map((a) =>
                a.id === actionId ? { ...a, ...patch } : a,
              ),
            }
          : s,
      ),
    );
  };

  const moveDayUp = (tempId: string) => {
    const idx = steps.findIndex((s) => s.tempId === tempId);
    if (idx <= 0) return;
    const next = [...steps];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setSteps(next.map((s, i) => ({ ...s, day_number: i + 1 })));
  };

  const moveDayDown = (tempId: string) => {
    const idx = steps.findIndex((s) => s.tempId === tempId);
    if (idx === -1 || idx >= steps.length - 1) return;
    const next = [...steps];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setSteps(next.map((s, i) => ({ ...s, day_number: i + 1 })));
  };

  const templatesForType = (type: ActionType): HexmailTemplate[] => {
    const tTypes = ACTION_TO_TEMPLATE_TYPES[type];
    if (!tTypes) return [];
    return templates.filter((t) => tTypes.includes(t.type) && t.status === "active");
  };

  const sortedSteps = [...steps].sort((a, b) => a.day_number - b.day_number);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="text-lg">
            {campaignId ? "Edit Campaign" : "New Follow-Up Campaign"}
          </SheetTitle>
          <div className="mt-2">
            <Label className="text-xs text-muted-foreground mb-1 block">Campaign Name</Label>
            <Input
              placeholder="e.g. Post-Demo Follow-Up"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-sm"
            />
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loadingCampaign && campaignId ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              Loading campaign…
            </div>
          ) : (
            <>
              {sortedSteps.map((step, stepIdx) => (
                <div
                  key={step.tempId}
                  className="rounded-lg border bg-card overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                      <Badge variant="secondary" className="text-xs font-semibold">
                        Day {step.day_number}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => moveDayUp(step.tempId)}
                        disabled={stepIdx === 0}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => moveDayDown(step.tempId)}
                        disabled={stepIdx === sortedSteps.length - 1}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => removeStep(step.tempId)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="p-3 space-y-2">
                    {step.actions.map((action) => {
                      const tmplOptions = templatesForType(action.type);
                      const needsTemplate = !!ACTION_TO_TEMPLATE_TYPES[action.type];
                      return (
                        <div
                          key={action.id}
                          className="rounded-md border bg-background p-3 space-y-2"
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <Select
                                value={action.type}
                                onValueChange={(v) =>
                                  updateAction(step.tempId, action.id, {
                                    type: v as ActionType,
                                    template_id: null,
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ACTION_TYPES.map((at) => (
                                    <SelectItem key={at.value} value={at.value} className="text-xs">
                                      {at.icon} {at.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
                              onClick={() => removeAction(step.tempId, action.id)}
                              disabled={step.actions.length === 1}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          {needsTemplate && (
                            <Select
                              value={action.template_id ?? "__none__"}
                              onValueChange={(v) =>
                                updateAction(step.tempId, action.id, {
                                  template_id: v === "__none__" ? null : v,
                                })
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="→ Select Template" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__" className="text-xs text-muted-foreground">
                                  No template selected
                                </SelectItem>
                                {tmplOptions.length === 0 && (
                                  <SelectItem value="__empty__" disabled className="text-xs">
                                    No {action.type} templates yet
                                  </SelectItem>
                                )}
                                {tmplOptions.map((t) => (
                                  <SelectItem key={t.id} value={t.id} className="text-xs">
                                    {t.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}

                          <Textarea
                            placeholder="Notes or instructions for this action…"
                            value={action.notes}
                            onChange={(e) =>
                              updateAction(step.tempId, action.id, { notes: e.target.value })
                            }
                            className="text-xs min-h-[56px] resize-none"
                          />
                        </div>
                      );
                    })}

                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-7 text-xs border border-dashed"
                      onClick={() => addAction(step.tempId)}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Action
                    </Button>
                  </div>
                </div>
              ))}

              <Button
                variant="outline"
                className="w-full border-dashed gap-1.5"
                onClick={addDay}
              >
                <Plus className="h-4 w-4" />
                Add Day {steps.length + 1}
              </Button>
            </>
          )}
        </div>

        <SheetFooter className="px-6 py-4 border-t flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1 gap-1.5"
            onClick={() => save.mutate()}
            disabled={!name.trim() || steps.length === 0 || save.isPending}
          >
            <Save className="h-4 w-4" />
            {save.isPending ? "Saving…" : "Save Campaign"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
