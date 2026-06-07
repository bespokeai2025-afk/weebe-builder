import { useBuilderStore } from "@/lib/builder/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Flag } from "lucide-react";
import type { Transition } from "@/lib/builder/types";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getWorkspaceCalendarSettings } from "@/lib/calendar/calendar.functions";
import { listMyAgents } from "@/lib/agents/agents.functions";

const BOOKING_PRESETS: {
  id: string;
  label: string;
  defaultName: string;
  defaultDescription: string;
}[] = [
  {
    id: "check_availability",
    label: "Check Calendar Availability (Cal.com)",
    defaultName: "check_availability_cal",
    defaultDescription:
      "Fetch open calendar slots for a date range. Call this BEFORE attempting to book. Required arguments: `start_date` (ISO date, e.g. 2026-06-01) and `end_date` (ISO date). Optional: `timezone` (IANA, defaults to workspace tz). Returns a list of available slots in ISO 8601.",
  },
  {
    id: "book_appointment",
    label: "Book on the Calendar (Cal.com)",
    defaultName: "book_appointment_cal",
    defaultDescription:
      "Create a confirmed booking on the calendar. Only call this AFTER you have collected and verbally confirmed every required field. Required arguments: `name` (caller's full name, first + last), `email` (a valid email — spell it back letter-by-letter to confirm before calling; never guess), `start` (ISO 8601 start time taken from check_availability), `timezone` (IANA, e.g. America/New_York). Optional: `phone` (E.164 format if collected), `notes` (short summary). The API will REJECT the booking with a 400 if email is missing/invalid AND no phone is supplied — always have at least one valid contact method.",
  },
  {
    id: "reschedule_appointment",
    label: "Reschedule Appointment (Cal.com)",
    defaultName: "reschedule_appointment_cal",
    defaultDescription:
      "Move an existing booking to a new slot. Required arguments: `booking_id` (uid returned at booking time, or look it up by email), `new_start` (ISO 8601 from check_availability). Optional: `reason`.",
  },
  {
    id: "cancel_appointment",
    label: "Cancel Appointment (Cal.com)",
    defaultName: "cancel_appointment_cal",
    defaultDescription:
      "Cancel an existing booking. Required: `booking_id` (uid). Optional: `reason`. Confirm with the caller before calling.",
  },
];
const DEFAULT_PROMPT_TEMPLATE = (stepLabel: string) =>
  [
    `## Goal`,
    `Accomplish "${stepLabel}" in a natural, conversational way.`,
    "",
    "## What to do",
    "1. Greet the caller briefly (only on the first turn).",
    "2. Ask the questions you need, one at a time — never stack multiple questions in one turn.",
    "3. For every piece of data you must capture (name, email, phone, address, dates, etc.) repeat it back to confirm before moving on. For emails, spell letter-by-letter (e.g. \"j-o-h-n at gmail dot com\").",
    "4. If the caller mentions booking, scheduling, rescheduling, or cancelling, collect: full name, a valid email (spelled back), preferred day/time, and timezone — then call the appropriate booking tool with ALL required fields. Never call book_appointment without a confirmed email or phone.",
    "5. Keep replies short (1–2 sentences). Sound human; avoid reading raw JSON, IDs, or URLs.",
    "",
    "## Rules",
    "- Never invent information you don't have — ask the caller.",
    "- If a tool errors, apologize briefly and offer an alternative.",
    "- Move to the next step only when you have everything required here.",
  ].join("\n");


export function NodeEditorDialog() {
  const { selectedNodeId, selectNode, nodes, updateNode, setStartNode } =
    useBuilderStore();
  const node = nodes.find((n) => n.id === selectedNodeId);

  const fetchCal = useServerFn(getWorkspaceCalendarSettings);
  const { data: calSettings } = useQuery({
    queryKey: ["workspace-calendar-settings"],
    queryFn: () => fetchCal(),
    staleTime: 60_000,
  });

  const preset = node ? BOOKING_PRESETS.find((p) => p.id === node.data.toolId) : undefined;

  // Auto-fill defaults when a Cal.com preset is selected and fields are empty.
  useEffect(() => {
    if (!node || !preset) return;
    const patch: Record<string, unknown> = {};
    if (!node.data.toolName) patch.toolName = preset.defaultName;
    if (!node.data.toolDescription) patch.toolDescription = preset.defaultDescription;
    if (!node.data.toolApiKey && calSettings?.calcom_api_key) {
      patch.toolApiKey = calSettings.calcom_api_key;
    }
    if (!node.data.toolEventTypeId && calSettings?.default_event_type_id) {
      patch.toolEventTypeId = String(calSettings.default_event_type_id);
    }
    if (!node.data.toolTimezone && calSettings?.timezone) {
      patch.toolTimezone = calSettings.timezone;
    }
    if (Object.keys(patch).length) updateNode(node.id, patch);
  }, [node?.id, preset?.id, calSettings?.calcom_api_key, calSettings?.default_event_type_id, calSettings?.timezone]);

  if (!node) return null;

  const d = node.data;
  const setTransitions = (t: Transition[]) => updateNode(node.id, { transitions: t });

  return (
    <Dialog open={!!selectedNodeId} onOpenChange={(o) => !o && selectNode(null)}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit {d.kind.replace("_", " ")} node
            {d.isStart && (
              <span className="text-xs rounded bg-violet-100 text-violet-700 px-2 py-0.5">
                Start
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label>Name</Label>
              <Input
                value={d.label}
                onChange={(e) => updateNode(node.id, { label: e.target.value })}
              />
            </div>
            <Button
              type="button"
              variant={d.isStart ? "default" : "outline"}
              size="sm"
              onClick={() => setStartNode(node.id)}
            >
              <Flag className="h-3.5 w-3.5 mr-1" />
              {d.isStart ? "Start node" : "Set as start"}
            </Button>
          </div>

          {d.kind === "conversation" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Instruction type</Label>
                  <Select
                    value={d.instructionType ?? "prompt"}
                    onValueChange={(v) =>
                      updateNode(node.id, {
                        instructionType: v as "prompt" | "static_text",
                      })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prompt">Prompt (LLM)</SelectItem>
                      <SelectItem value="static_text">Static text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {d.isStart && (
                  <div>
                    <Label>Start speaker</Label>
                    <Select
                      value={d.startSpeaker ?? "agent"}
                      onValueChange={(v) =>
                        updateNode(node.id, { startSpeaker: v as "agent" | "user" })
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="agent">Agent</SelectItem>
                        <SelectItem value="user">User</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label>{d.instructionType === "static_text" ? "Static text" : "Prompt"}</Label>
                  {d.instructionType !== "static_text" && !d.dialogue && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() =>
                        updateNode(node.id, {
                          dialogue: DEFAULT_PROMPT_TEMPLATE(d.label || "this step"),
                        })
                      }
                    >
                      Insert default prompt
                    </Button>
                  )}
                </div>
                <Textarea
                  rows={6}
                  value={d.dialogue}
                  onChange={(e) => updateNode(node.id, { dialogue: e.target.value })}
                  placeholder={DEFAULT_PROMPT_TEMPLATE(d.label || "this step")}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Tip: if this step calls <code>book_appointment</code>, list every required field (name, email, ISO start, timezone) explicitly so the agent never calls the tool with missing arguments.
                </p>
              </div>


              <GlobalNodeSettings nodeId={node.id} value={d.globalNodeSetting ?? {}} />
            </>
          )}

          {d.kind === "function" && (
            <>
              <div>
                <Label>Function</Label>
                <Select
                  value={
                    BOOKING_PRESETS.some((p) => p.id === d.toolId)
                      ? d.toolId
                      : d.toolId
                        ? "__custom__"
                        : ""
                  }
                  onValueChange={(v) => {
                    if (v === "__custom__") updateNode(node.id, { toolId: "" });
                    else updateNode(node.id, { toolId: v });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a function" />
                  </SelectTrigger>
                  <SelectContent>
                    {BOOKING_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__">Custom tool ID…</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Cal.com booking tools are auto-attached on deploy when a calendar is connected.
                </p>
              </div>
              {!BOOKING_PRESETS.some((p) => p.id === d.toolId) && (
                <div>
                  <Label>Tool ID</Label>
                  <Input
                    value={d.toolId ?? ""}
                    onChange={(e) => updateNode(node.id, { toolId: e.target.value })}
                    placeholder="tool-xxxx"
                  />
                </div>
              )}
              {preset && (
                <>
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={d.toolName ?? ""}
                      onChange={(e) => updateNode(node.id, { toolName: e.target.value })}
                      placeholder={preset.defaultName}
                    />
                  </div>
                  <div>
                    <Label>
                      Description <span className="text-muted-foreground">(Optional)</span>
                    </Label>
                    <Textarea
                      rows={3}
                      value={d.toolDescription ?? ""}
                      onChange={(e) =>
                        updateNode(node.id, { toolDescription: e.target.value })
                      }
                      placeholder={preset.defaultDescription}
                    />
                  </div>
                  <div>
                    <Label>API Key (Cal.com)</Label>
                    <Input
                      type="password"
                      value={d.toolApiKey ?? ""}
                      onChange={(e) => updateNode(node.id, { toolApiKey: e.target.value })}
                      placeholder={
                        calSettings?.calcom_api_key
                          ? "Using workspace key"
                          : "Enter Cal.com API key"
                      }
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Auto-filled from your connected Cal.com workspace. Override only if this
                      tool should use a different account.
                    </p>
                  </div>
                  <div>
                    <Label>Event Type ID (Cal.com)</Label>
                    <p className="text-xs text-muted-foreground mb-1">
                      You can find the Event Type ID in your cal.com URL.
                    </p>
                    <Input
                      value={d.toolEventTypeId ?? ""}
                      onChange={(e) =>
                        updateNode(node.id, { toolEventTypeId: e.target.value })
                      }
                      placeholder="Enter Event Type ID"
                    />
                  </div>
                  <div>
                    <Label>
                      Timezone <span className="text-muted-foreground">(Optional)</span>
                    </Label>
                    <Input
                      value={d.toolTimezone ?? ""}
                      onChange={(e) => updateNode(node.id, { toolTimezone: e.target.value })}
                      placeholder="America/Los_Angeles"
                    />
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <Label>Speak during execution</Label>
                <Switch
                  checked={!!d.speakDuringExecution}
                  onCheckedChange={(v) => updateNode(node.id, { speakDuringExecution: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Wait for result</Label>
                <Switch
                  checked={d.waitForResult ?? true}
                  onCheckedChange={(v) => updateNode(node.id, { waitForResult: v })}
                />
              </div>
            </>
          )}

          {d.kind === "call_transfer" && (
            <CallTransferSettings nodeId={node.id} />
          )}

          {d.kind === "agent_transfer" && (
            <>
              <DestinationAgentPicker
                value={d.dialogue}
                currentRetellAgentId={
                  (useBuilderStore.getState().settings as { agentId?: string }).agentId
                }
                onChange={(v) => updateNode(node.id, { dialogue: v })}
              />

              <div className="flex items-center justify-between">
                <Label>Keep the same voice</Label>
                <Switch
                  checked={d.agentSwapKeepCurrentVoice ?? false}
                  onCheckedChange={(v) =>
                    updateNode(node.id, { agentSwapKeepCurrentVoice: v })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <Label>Keep the current language</Label>
                <Switch
                  checked={d.agentSwapKeepCurrentLanguage ?? false}
                  onCheckedChange={(v) =>
                    updateNode(node.id, { agentSwapKeepCurrentLanguage: v })
                  }
                />
              </div>

              <div>
                <Label>Post-call analysis setting</Label>
                <Select
                  value={d.agentSwapPostCallAnalysisSetting ?? "only_destination_agent"}
                  onValueChange={(v) =>
                    updateNode(node.id, {
                      agentSwapPostCallAnalysisSetting: v as
                        | "only_destination_agent"
                        | "all",
                    })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="only_destination_agent">Only transferred agent</SelectItem>
                    <SelectItem value="all">Both this agent and transferred agent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Webhook setting</Label>
                <Select
                  value={d.agentSwapWebhookSetting ?? "only_source_agent"}
                  onValueChange={(v) =>
                    updateNode(node.id, {
                      agentSwapWebhookSetting: v as
                        | "only_source_agent"
                        | "only_destination_agent"
                        | "all",
                    })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="only_destination_agent">Only transferred agent</SelectItem>
                    <SelectItem value="all">Both this agent and transferred agent</SelectItem>
                    <SelectItem value="only_source_agent">Only this agent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {d.kind === "press_digit" && (
            <>
              <div>
                <Label>Pause detection (ms)</Label>
                <Input
                  type="number"
                  value={d.pauseDetectionMs ?? 1000}
                  onChange={(e) =>
                    updateNode(node.id, { pauseDetectionMs: parseInt(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <Label>Instruction</Label>
                <Textarea
                  rows={3}
                  value={d.dialogue}
                  onChange={(e) => updateNode(node.id, { dialogue: e.target.value })}
                />
              </div>
            </>
          )}

          {d.kind === "logic_split" && (
            <div>
              <Label>Logic prompt</Label>
              <Textarea
                rows={4}
                value={d.dialogue}
                onChange={(e) => updateNode(node.id, { dialogue: e.target.value })}
                placeholder="Describe how to choose between branches…"
              />
            </div>
          )}

          {d.kind === "sms" && (
            <div>
              <Label>Message</Label>
              <Textarea
                rows={3}
                value={d.smsMessage ?? ""}
                onChange={(e) => updateNode(node.id, { smsMessage: e.target.value })}
              />
            </div>
          )}

          {d.kind === "extract_variable" && (
            <>
              <div>
                <Label>Variable name</Label>
                <Input
                  value={d.variableName ?? ""}
                  onChange={(e) => updateNode(node.id, { variableName: e.target.value })}
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  rows={3}
                  value={d.variableDescription ?? ""}
                  onChange={(e) =>
                    updateNode(node.id, { variableDescription: e.target.value })
                  }
                />
              </div>
            </>
          )}

          {d.kind === "code" && (
            <div>
              <Label>Code</Label>
              <Textarea
                rows={6}
                className="font-mono text-xs"
                value={d.codeSource ?? ""}
                onChange={(e) => updateNode(node.id, { codeSource: e.target.value })}
              />
            </div>
          )}

          {d.kind === "ending" && (
            <div>
              <Label>Ending prompt</Label>
              <Textarea
                rows={3}
                value={d.endingPrompt ?? ""}
                onChange={(e) => updateNode(node.id, { endingPrompt: e.target.value })}
              />
            </div>
          )}

          {d.kind === "note" && (
            <div>
              <Label>Note</Label>
              <Textarea
                rows={4}
                value={d.dialogue}
                onChange={(e) => updateNode(node.id, { dialogue: e.target.value })}
              />
            </div>
          )}

          {d.kind !== "ending" && d.kind !== "note" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Transitions</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setTransitions([
                      ...d.transitions,
                      { id: `t_${Date.now()}`, condition: "", target: null },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />Add
                </Button>
              </div>
              <div className="space-y-2">
                {d.transitions.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Add conditions to label the connections leaving this node. They become
                    edge <code>transition_condition.prompt</code> values in the JSON.
                  </p>
                )}
                {d.transitions.map((t, i) => (
                  <div key={t.id} className="flex gap-2 items-start">
                    <Input
                      placeholder="e.g. User confirms appointment"
                      value={t.condition}
                      onChange={(e) => {
                        const next = [...d.transitions];
                        next[i] = { ...t, condition: e.target.value };
                        setTransitions(next);
                      }}
                    />
                    <Select
                      value={t.target ?? "none"}
                      onValueChange={(v) => {
                        const next = [...d.transitions];
                        next[i] = { ...t, target: v === "none" ? null : v };
                        setTransitions(next);
                      }}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Target" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No target</SelectItem>
                        {nodes
                          .filter((n) => n.id !== node.id)
                          .map((n) => (
                            <SelectItem key={n.id} value={n.id}>
                              {n.data.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        setTransitions(d.transitions.filter((x) => x.id !== t.id))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => selectNode(null)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Override = {
  key: string;
  label: string;
  description?: string;
  defaultValue: number | string | boolean;
  control: "slider" | "select" | "switch";
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
};

const OVERRIDES: Override[] = [
  {
    key: "voice_speed",
    label: "Voice Speed",
    defaultValue: 1,
    control: "slider",
    min: 0.5,
    max: 2,
    step: 0.05,
  },
  {
    key: "responsiveness",
    label: "Response Eagerness",
    defaultValue: 1,
    control: "slider",
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: "interruption_sensitivity",
    label: "Interruption Sensitivity",
    defaultValue: 0.7,
    control: "slider",
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: "model",
    label: "LLM",
    description: "Choose a different LLM for this node",
    defaultValue: "gpt-4.1",
    control: "select",
    options: [
      { label: "GPT-4.1", value: "gpt-4.1" },
      { label: "GPT-4.1 mini", value: "gpt-4.1-mini" },
      { label: "GPT-4.1 nano", value: "gpt-4.1-nano" },
      { label: "GPT-5", value: "gpt-5" },
      { label: "GPT-5 mini", value: "gpt-5-mini" },
      { label: "Claude 4.6 Sonnet", value: "claude-4.6-sonnet" },
      { label: "Claude 4.5 Haiku", value: "claude-4.5-haiku" },
      { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
      { label: "Gemini 3.0 Flash", value: "gemini-3.0-flash" },
    ],
  },
  {
    key: "allow_dtmf_interruption",
    label: "Allow DTMF Interruption",
    description: "Override DTMF interruption behavior for this node",
    defaultValue: true,
    control: "switch",
  },
];

function GlobalNodeSettings({
  nodeId,
  value,
}: {
  nodeId: string;
  value: Record<string, unknown>;
}) {
  const { updateNode, nodes } = useBuilderStore();
  const node = nodes.find((n) => n.id === nodeId);
  const isGlobal = !!node?.data.isGlobalNode;

  const setOverride = (key: string, val: unknown) => {
    const next = { ...value, [key]: val };
    updateNode(nodeId, { globalNodeSetting: next });
  };

  const toggleOverride = (o: Override, enabled: boolean) => {
    const next = { ...value };
    if (enabled) next[o.key] = o.defaultValue;
    else delete next[o.key];
    updateNode(nodeId, { globalNodeSetting: next });
  };

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-5">
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 rounded-sm border border-foreground/40" />
        <h3 className="text-sm font-semibold">Node Settings</h3>
      </div>

      {/* Global Node */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label className="text-sm font-medium">Global Node</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Allow other nodes jump to this node without edges
            </p>
          </div>
          <Switch
            checked={isGlobal}
            onCheckedChange={(v) => updateNode(nodeId, { isGlobalNode: v })}
          />
        </div>

        {isGlobal && (
          <GlobalNodeConditions
            value={(value.conditions as string[]) ?? []}
            onChange={(conds) => {
              const next = { ...value };
              if (conds.length === 0) {
                delete next.conditions;
                delete next.condition;
              } else {
                next.conditions = conds;
                // The export schema uses a single `condition` prompt — join multiples with OR.
                next.condition = conds.filter(Boolean).join("\nOR\n");
              }
              updateNode(nodeId, { globalNodeSetting: next });
            }}
          />
        )}
      </div>


      <div className="border-t pt-4">
        <div className="mb-3">
          <Label className="text-sm font-medium">Node-level overrides</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Override agent defaults for this node
          </p>
        </div>

        <div className="rounded-md border bg-background divide-y">
          {OVERRIDES.map((o) => {
            const enabled = value[o.key] !== undefined;
            const current = value[o.key];
            return (
              <div key={o.key} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">{o.label}</div>
                    {o.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {o.description}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) => toggleOverride(o, v)}
                  />
                </div>

                {enabled && o.control === "slider" && (
                  <div className="flex items-center gap-3 pt-1">
                    <input
                      type="range"
                      min={o.min}
                      max={o.max}
                      step={o.step}
                      value={Number(current ?? o.defaultValue)}
                      onChange={(e) =>
                        setOverride(o.key, parseFloat(e.target.value))
                      }
                      className="flex-1 accent-foreground"
                    />
                    <span className="text-xs tabular-nums w-10 text-right">
                      {Number(current ?? o.defaultValue).toFixed(2)}
                    </span>
                  </div>
                )}

                {enabled && o.control === "select" && (
                  <Select
                    value={String(current ?? o.defaultValue)}
                    onValueChange={(v) => setOverride(o.key, v)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {o.options!.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {enabled && o.control === "switch" && (
                  <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                    <span className="text-xs text-muted-foreground">Enabled</span>
                    <Switch
                      checked={Boolean(current ?? o.defaultValue)}
                      onCheckedChange={(v) => setOverride(o.key, v)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GlobalNodeConditions({
  value,
  onChange,
}: {
  value: string[];
  onChange: (conds: string[]) => void;
}) {
  const update = (i: number, text: string) => {
    const next = [...value];
    next[i] = text;
    onChange(next);
  };
  const add = () => onChange([...value, ""]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="rounded-md border bg-background p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs font-medium">Conditions</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            When any condition is met, the agent can jump to this node.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={add}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>

      {value.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">
          No conditions — add at least one for the global jump to trigger.
        </p>
      )}

      {value.map((c, i) => (
        <div key={i} className="flex gap-2 items-start">
          <Textarea
            rows={2}
            className="text-xs"
            placeholder="e.g. User asks to speak to a human agent"
            value={c}
            onChange={(e) => update(i, e.target.value)}
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={() => remove(i)}
            aria-label="Remove condition"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function CallTransferSettings({ nodeId }: { nodeId: string }) {
  const { nodes, updateNode } = useBuilderStore();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = node.data;

  const mode = d.transferMode ?? "static";
  const transferType = d.transferType ?? "cold_transfer";
  const sipMethod = d.sipTransferMethod ?? "sip_invite";
  const callerId = d.callerIdMode ?? "agent";
  const ringSec = d.transferRingDurationSec ?? 30;
  const headers = d.customSipHeaders ?? {};
  const headerEntries = Object.entries(headers);

  const setHeader = (oldKey: string, newKey: string, value: string) => {
    const next: Record<string, string> = {};
    headerEntries.forEach(([k, v]) => {
      if (k === oldKey) {
        if (newKey.trim()) next[newKey] = value;
      } else {
        next[k] = v as string;
      }
    });
    updateNode(nodeId, { customSipHeaders: next });
  };
  const addHeader = () => updateNode(nodeId, { customSipHeaders: { ...headers, "": "" } });
  const removeHeader = (k: string) => {
    const next = { ...headers };
    delete next[k];
    updateNode(nodeId, { customSipHeaders: next });
  };

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-5">
      <h3 className="text-sm font-semibold">Transfer Call Settings</h3>

      <div className="space-y-2">
        <Label className="text-sm">Transfer to</Label>
        <div className="inline-flex rounded-md border bg-background p-0.5">
          <button
            type="button"
            onClick={() => updateNode(nodeId, { transferMode: "static" })}
            className={`px-3 py-1 text-xs rounded ${mode === "static" ? "bg-foreground text-background" : "text-muted-foreground"}`}
          >
            Static Destination
          </button>
          <button
            type="button"
            onClick={() => updateNode(nodeId, { transferMode: "dynamic" })}
            className={`px-3 py-1 text-xs rounded ${mode === "dynamic" ? "bg-foreground text-background" : "text-muted-foreground"}`}
          >
            Dynamic Routing
          </button>
        </div>

        {mode === "static" ? (
          <>
            <Input
              value={d.transferNumber ?? ""}
              onChange={(e) => updateNode(nodeId, { transferNumber: e.target.value })}
              placeholder="+18563630633 or sip:user@host"
            />
            <p className="text-[11px] text-muted-foreground">
              Enter a static phone number, SIP URI, or dynamic variable.
            </p>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={!!d.ignoreE164Validation}
                  onCheckedChange={(v) => updateNode(nodeId, { ignoreE164Validation: v })}
                />
                Ignore E.164 validation
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={d.transferExtensionNumber !== undefined}
                  onChange={(e) =>
                    updateNode(nodeId, {
                      transferExtensionNumber: e.target.checked ? (d.transferExtensionNumber ?? "") : undefined,
                    })
                  }
                />
                Extension Number
              </label>
            </div>
            {d.transferExtensionNumber !== undefined && (
              <Input
                value={d.transferExtensionNumber ?? ""}
                onChange={(e) => updateNode(nodeId, { transferExtensionNumber: e.target.value })}
                placeholder="Extension digits (e.g. 1234)"
              />
            )}
          </>
        ) : (
          <>
            <Input
              value={d.transferDynamicVariable ?? ""}
              onChange={(e) => updateNode(nodeId, { transferDynamicVariable: e.target.value })}
              placeholder="variable_name"
            />
            <p className="text-[11px] text-muted-foreground">
              Number/SIP URI is read at runtime from{" "}
              <code>{`{{${d.transferDynamicVariable || "variable_name"}}}`}</code>.
            </p>
          </>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-sm">How should the AI handle the transfer?</Label>
        <div className="space-y-2">
          {[
            { v: "cold_transfer", t: "Cold Transfer", desc: "AI transfers immediately" },
            { v: "warm_transfer", t: "Warm Transfer", desc: "AI gives a one-way brief to the agent" },
            { v: "agentic_warm_transfer", t: "Agentic Warm Transfer", desc: "AI has a 2-way conversation with agent, then bridges" },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => updateNode(nodeId, { transferType: o.v as "cold_transfer" | "warm_transfer" | "agentic_warm_transfer" })}
              className={`w-full text-left rounded-md border bg-background px-3 py-2 flex items-center justify-between ${transferType === o.v ? "ring-2 ring-foreground" : ""}`}
            >
              <div>
                <div className="text-sm font-medium">{o.t}</div>
                <div className="text-[11px] text-muted-foreground">{o.desc}</div>
              </div>
              <div className={`h-3 w-3 rounded-full border ${transferType === o.v ? "bg-foreground border-foreground" : ""}`} />
            </button>
          ))}
        </div>
        {(transferType === "warm_transfer" || transferType === "agentic_warm_transfer") && (
          <div className="space-y-2">
            <Textarea
              rows={3}
              placeholder="Prompt the AI uses for the three-way handoff message…"
              value={d.warmHandoffPrompt ?? ""}
              onChange={(e) => updateNode(nodeId, { warmHandoffPrompt: e.target.value })}
            />
            {transferType === "agentic_warm_transfer" && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={d.transferAgentId ?? ""}
                  onChange={(e) => updateNode(nodeId, { transferAgentId: e.target.value })}
                  placeholder="Transfer agent ID"
                />
                <Input
                  value={d.transferAgentVersion ?? "latest"}
                  onChange={(e) => updateNode(nodeId, { transferAgentVersion: e.target.value })}
                  placeholder="latest"
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-sm">SIP Transfer Method</Label>
        <div className="inline-flex rounded-md border bg-background p-0.5">
          {[
            { v: "sip_invite", t: "SIP INVITE" },
            { v: "sip_refer", t: "SIP REFER" },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => updateNode(nodeId, { sipTransferMethod: o.v as "sip_invite" | "sip_refer" })}
              className={`px-3 py-1 text-xs rounded ${sipMethod === o.v ? "bg-foreground text-background" : "text-muted-foreground"}`}
            >
              {o.t}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Displayed Caller ID</Label>
        {[
          { v: "agent", t: "Agent's Number" },
          { v: "user", t: "User's Number" },
        ].map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => updateNode(nodeId, { callerIdMode: o.v as "agent" | "user" })}
            className={`w-full text-left rounded-md border bg-background px-3 py-2 flex items-center justify-between ${callerId === o.v ? "ring-2 ring-foreground" : ""}`}
          >
            <span className="text-sm">{o.t}</span>
            <div className={`h-3 w-3 rounded-full border ${callerId === o.v ? "bg-foreground border-foreground" : ""}`} />
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Transfer Ring Duration</Label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={5}
            max={90}
            step={1}
            value={ringSec}
            onChange={(e) => updateNode(nodeId, { transferRingDurationSec: parseInt(e.target.value) })}
            className="flex-1 accent-foreground"
          />
          <span className="text-xs tabular-nums w-10 text-right">{ringSec}s</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Custom SIP Headers</Label>
            <p className="text-[11px] text-muted-foreground">
              Key/value pairs for call routing, metadata, or carrier integration.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={addHeader}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add
          </Button>
        </div>
        {headerEntries.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">No custom headers.</p>
        )}
        {headerEntries.map(([k, v], i) => (
          <div key={`${i}-${k}`} className="flex gap-2">
            <Input
              className="flex-1"
              placeholder="X-Header-Name"
              defaultValue={k}
              onBlur={(e) => setHeader(k, e.target.value, v as string)}
            />
            <Input
              className="flex-1"
              placeholder="value"
              value={v as string}
              onChange={(e) => setHeader(k, k, e.target.value)}
            />
            <Button size="icon" variant="ghost" onClick={() => removeHeader(k)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}



function DestinationAgentPicker({
  value,
  currentRetellAgentId,
  onChange,
}: {
  value: string;
  currentRetellAgentId?: string;
  onChange: (v: string) => void;
}) {
  const fetchAgents = useServerFn(listMyAgents);
  const { data: agents, isLoading } = useQuery({
    queryKey: ["workspace-agents"],
    queryFn: () => fetchAgents({}),
  });

  const deployed = (agents ?? []).filter(
    (a) => a.retell_agent_id && a.retell_agent_id !== currentRetellAgentId,
  );

  // If the saved value isn't in the list (custom ID), keep it selectable.
  const valueIsCustom =
    !!value && !deployed.some((a) => a.retell_agent_id === value);

  return (
    <div>
      <Label>Destination agent</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue
            placeholder={isLoading ? "Loading agents…" : "Select an agent"}
          />
        </SelectTrigger>
        <SelectContent>
          {deployed.length === 0 && !valueIsCustom && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No other deployed agents in this workspace. Deploy another agent first.
            </div>
          )}
          {deployed.map((a) => (
            <SelectItem key={a.id} value={a.retell_agent_id as string}>
              {a.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {a.retell_agent_id}
              </span>
            </SelectItem>
          ))}
          {valueIsCustom && (
            <SelectItem value={value}>{value} (manual)</SelectItem>
          )}
        </SelectContent>
      </Select>
      <div className="mt-2 flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Or paste an agent ID (agent_xxx)"
          className="text-xs"
        />
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        Seamless transition — full call context preserved, appears as a single call.
      </p>
    </div>
  );
}
