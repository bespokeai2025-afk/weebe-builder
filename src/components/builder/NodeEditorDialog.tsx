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
import { Plus, Trash2, Flag, Pencil } from "lucide-react";
import type { Transition, ExtractVariableItem } from "@/lib/builder/types";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getWorkspaceCalendarSettings } from "@/lib/calendar/calendar.functions";
import { listMyAgents } from "@/lib/agents/agents.functions";
import { listWatiTemplates } from "@/lib/whatsapp/wati.functions";

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
      "Create a confirmed booking on the calendar. Only call this AFTER you have collected and verbally confirmed EVERY required field. Required arguments: `name` (caller's full name, first + last), `email` (a valid email — spell it back letter-by-letter to confirm; never guess), `phone` (E.164 format — always collect, even if the caller is calling from a known number), `start` (ISO 8601 start time taken from check_availability), `timezone` (IANA, e.g. America/New_York — infer from the caller's area code if possible, then confirm verbally; ask if uncertain). Optional: `notes` (short summary). Always pass both email AND phone — the API rejects bookings missing both contact methods.",
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
    '3. For every piece of data you must capture (name, email, phone, address, dates, etc.) repeat it back to confirm before moving on. For emails, spell letter-by-letter (e.g. "j-o-h-n at gmail dot com").',
    "4. If the caller mentions booking, scheduling, rescheduling, or cancelling:",
    "   a. Collect full name, a valid email (spelled back letter-by-letter), and phone number (even if they are already calling from a known number — ask to confirm).",
    "   b. Determine timezone: infer it from the caller's area code (e.g. 212 → America/New_York, 310 → America/Los_Angeles, 44 prefix → Europe/London) and say it aloud to confirm (e.g. 'I'll book that in Eastern Time — is that right?'). Ask if you cannot determine it.",
    "   c. Then call the appropriate booking tool with ALL required fields. Never call book_appointment without both a confirmed email AND phone.",
    "5. Keep replies short (1–2 sentences). Sound human; avoid reading raw JSON, IDs, or URLs.",
    "",
    "## Rules",
    "- Never invent information you don't have — ask the caller.",
    "- If a tool errors, apologize briefly and offer an alternative.",
    "- Move to the next step only when you have everything required here.",
  ].join("\n");

export function NodeEditorDialog() {
  const { selectedNodeId, selectNode, nodes, updateNode, setStartNode, pendingAddVariable } = useBuilderStore();
  const node = nodes.find((n) => n.id === selectedNodeId);

  const fetchCal = useServerFn(getWorkspaceCalendarSettings);
  const { data: calSettings } = useQuery({
    queryKey: ["workspace-calendar-settings"],
    queryFn: () => fetchCal(),
    staleTime: 60_000,
    throwOnError: false,
  });

  // WATI approved templates — only returns rows when a WATI connection exists,
  // so the template picker below is naturally gated on WATI being connected.
  const fetchWatiTemplates = useServerFn(listWatiTemplates);
  const { data: watiTemplates } = useQuery({
    queryKey: ["wati-templates-for-builder"],
    queryFn: () => fetchWatiTemplates(),
    staleTime: 5 * 60_000,
    throwOnError: false,
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
  }, [
    node?.id,
    preset?.id,
    calSettings?.calcom_api_key,
    calSettings?.default_event_type_id,
    calSettings?.timezone,
  ]);

  const [editingVar, setEditingVar] = useState<ExtractVariableItem | null>(null);
  const [editingVarIsNew, setEditingVarIsNew] = useState(false);

  useEffect(() => {
    if (pendingAddVariable && node?.data.kind === "extract_variable") {
      setEditingVar({ id: crypto.randomUUID(), name: "", description: "", type: "string" });
      setEditingVarIsNew(true);
      useBuilderStore.setState({ pendingAddVariable: false });
    } else {
      setEditingVar(null);
      setEditingVarIsNew(false);
    }
  }, [selectedNodeId]);

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
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
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
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
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
                  Tip: if this step calls <code>book_appointment</code>, list every required field
                  (name, email, ISO start, timezone) explicitly so the agent never calls the tool
                  with missing arguments.
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
                      onChange={(e) => updateNode(node.id, { toolDescription: e.target.value })}
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
                      Auto-filled from your connected Cal.com workspace. Override only if this tool
                      should use a different account.
                    </p>
                  </div>
                  <div>
                    <Label>Event Type ID (Cal.com)</Label>
                    <p className="text-xs text-muted-foreground mb-1">
                      You can find the Event Type ID in your cal.com URL.
                    </p>
                    <Input
                      value={d.toolEventTypeId ?? ""}
                      onChange={(e) => updateNode(node.id, { toolEventTypeId: e.target.value })}
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

          {d.kind === "call_transfer" && <CallTransferSettings nodeId={node.id} />}

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
                  onCheckedChange={(v) => updateNode(node.id, { agentSwapKeepCurrentVoice: v })}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label>Keep the current language</Label>
                <Switch
                  checked={d.agentSwapKeepCurrentLanguage ?? false}
                  onCheckedChange={(v) => updateNode(node.id, { agentSwapKeepCurrentLanguage: v })}
                />
              </div>

              <div>
                <Label>Post-call analysis setting</Label>
                <Select
                  value={d.agentSwapPostCallAnalysisSetting ?? "only_destination_agent"}
                  onValueChange={(v) =>
                    updateNode(node.id, {
                      agentSwapPostCallAnalysisSetting: v as "only_destination_agent" | "all",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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

          {d.kind === "check_documents" && (
            <>
              <div className="rounded-lg border border-teal-200 bg-teal-50/60 px-4 py-3 space-y-1 text-sm dark:border-teal-700/50 dark:bg-teal-900/20">
                <p className="font-medium text-teal-800 dark:text-teal-300">Check Documents tool</p>
                <p className="text-teal-700 dark:text-teal-400 text-xs leading-relaxed">
                  During the call the agent will look up whether the contact has uploaded any
                  documents. The tool response includes a ready-made <code className="font-mono bg-teal-100 dark:bg-teal-800 rounded px-1">summary</code> sentence
                  the agent can speak directly, plus counts of client- and admin-uploaded files.
                </p>
              </div>

              <div>
                <Label>Agent instruction</Label>
                <Textarea
                  rows={4}
                  value={d.dialogue}
                  onChange={(e) => updateNode(node.id, { dialogue: e.target.value })}
                  placeholder={
                    "Call check_documents to look up whether this contact has submitted their files.\n" +
                    "Read the returned summary aloud verbatim.\n" +
                    "If no documents are found and an upload_url is present, offer to send them the link via SMS."
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Speak during execution</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Say something while the lookup runs (recommended)
                  </p>
                </div>
                <Switch
                  checked={d.speakDuringExecution ?? true}
                  onCheckedChange={(v) => updateNode(node.id, { speakDuringExecution: v })}
                />
              </div>
            </>
          )}

          {d.kind === "send_upload_link" && (
            <>
              <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3 space-y-1 text-sm dark:border-sky-700/50 dark:bg-sky-900/20">
                <p className="font-medium text-sky-800 dark:text-sky-300">Send Upload Link tool</p>
                <p className="text-sky-700 dark:text-sky-400 text-xs leading-relaxed">
                  During the call the agent generates a unique, secure upload URL for the contact
                  and texts it to their mobile number via SMS. The tool returns a{" "}
                  <code className="font-mono bg-sky-100 dark:bg-sky-800 rounded px-1">summary</code>{" "}
                  the agent reads aloud, and a{" "}
                  <code className="font-mono bg-sky-100 dark:bg-sky-800 rounded px-1">sms_sent</code>{" "}
                  flag. Requires a Twilio phone number configured on this workspace.
                </p>
              </div>

              <div>
                <Label>Agent instruction</Label>
                <Textarea
                  rows={4}
                  value={d.dialogue}
                  onChange={(e) => updateNode(node.id, { dialogue: e.target.value })}
                  placeholder={
                    "Call send_upload_link to generate and text a secure document upload link to the caller.\n" +
                    "Read the returned summary aloud verbatim.\n" +
                    "If sms_sent is true, tell them to check their messages.\n" +
                    "If sms_sent is false, apologise and advise them to contact the office directly."
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Speak during execution</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Say something while the link is being generated (recommended)
                  </p>
                </div>
                <Switch
                  checked={d.speakDuringExecution ?? true}
                  onCheckedChange={(v) => updateNode(node.id, { speakDuringExecution: v })}
                />
              </div>
            </>
          )}

          {d.kind === "extract_variable" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Variables</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingVar({ id: crypto.randomUUID(), name: "", description: "", type: "string" });
                    setEditingVarIsNew(true);
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Variable
                </Button>
              </div>

              {(d.extractVariables ?? []).length === 0 && !editingVar && (
                <p className="text-sm text-muted-foreground italic py-1">
                  No variables yet — click Add Variable to begin.
                </p>
              )}

              <div className="space-y-1">
                {((d.extractVariables ?? []) as ExtractVariableItem[]).map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2"
                  >
                    <span className="font-mono text-xs font-bold text-indigo-500 shrink-0">{"{}"}</span>
                    <span className="flex-1 text-sm truncate">{v.name || "(unnamed)"}</span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">
                      {v.type === "string" ? "Text" : v.type === "number" ? "Num" : v.type === "boolean" ? "Bool" : v.type === "date" ? "Date" : "Enum"}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setEditingVar(v); setEditingVarIsNew(false); }}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Edit variable"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateNode(node.id, {
                          extractVariables: ((d.extractVariables ?? []) as ExtractVariableItem[]).filter((x) => x.id !== v.id),
                        })
                      }
                      className="rounded p-0.5 text-rose-500 hover:text-rose-700 transition-colors"
                      aria-label="Delete variable"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {editingVar && (
                <div className="rounded-lg border bg-background p-3 space-y-3 shadow-sm">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {editingVarIsNew ? "New Variable" : "Edit Variable"}
                  </p>
                  <div>
                    <Label>Variable Name</Label>
                    <Input
                      value={editingVar.name}
                      onChange={(e) => setEditingVar((prev) => prev ? { ...prev, name: e.target.value } : null)}
                      placeholder="e.g. customer_name"
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      rows={3}
                      value={editingVar.description}
                      onChange={(e) => setEditingVar((prev) => prev ? { ...prev, description: e.target.value } : null)}
                      placeholder="Describe what to collect from the caller…"
                    />
                  </div>
                  <div>
                    <Label>
                      Variable Type{" "}
                      <span className="text-muted-foreground font-normal">(Optional)</span>
                    </Label>
                    <Select
                      value={editingVar.type}
                      onValueChange={(v) =>
                        setEditingVar((prev) =>
                          prev ? { ...prev, type: v as ExtractVariableItem["type"] } : null,
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="string">Text</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="boolean">Boolean</SelectItem>
                        <SelectItem value="date">Date / Time</SelectItem>
                        <SelectItem value="enum">Enum</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => { setEditingVar(null); setEditingVarIsNew(false); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        if (!editingVar) return;
                        const current = (d.extractVariables ?? []) as ExtractVariableItem[];
                        const updated = editingVarIsNew
                          ? [...current, editingVar]
                          : current.map((x) => (x.id === editingVar.id ? editingVar : x));
                        updateNode(node.id, { extractVariables: updated });
                        setEditingVar(null);
                        setEditingVarIsNew(false);
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </div>
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

          {d.kind === "http_request" && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-semibold">Tool Name (shown to AI)</Label>
                <Input
                  placeholder="fetch_availability"
                  value={d.httpToolName ?? ""}
                  onChange={(e) => updateNode(node.id, { httpToolName: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-sm font-semibold">Tool Description</Label>
                <Textarea
                  rows={2}
                  placeholder="Describe when the AI should call this endpoint…"
                  value={d.httpToolDescription ?? d.dialogue ?? ""}
                  onChange={(e) => updateNode(node.id, { httpToolDescription: e.target.value, dialogue: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <div className="w-28 shrink-0">
                  <Label className="text-sm font-semibold">Method</Label>
                  <Select
                    value={d.httpMethod ?? "POST"}
                    onValueChange={(v) => updateNode(node.id, { httpMethod: v as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["GET","POST","PUT","PATCH","DELETE"].map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-sm font-semibold">URL <span className="text-rose-500">*</span></Label>
                  <Input
                    placeholder="https://api.yourapp.com/endpoint"
                    value={d.httpUrl ?? ""}
                    onChange={(e) => updateNode(node.id, { httpUrl: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label className="text-sm font-semibold">Headers (JSON)</Label>
                <Textarea
                  rows={2}
                  className="font-mono text-xs"
                  placeholder={'{"Authorization": "Bearer token", "X-Api-Key": "key"}'}
                  value={d.httpHeaders ?? ""}
                  onChange={(e) => updateNode(node.id, { httpHeaders: e.target.value })}
                />
              </div>
              {(d.httpMethod ?? "POST") !== "GET" && (
                <div>
                  <Label className="text-sm font-semibold">Request Body (JSON)</Label>
                  <Textarea
                    rows={3}
                    className="font-mono text-xs"
                    placeholder={'{"key": "{{variable}}"}'}
                    value={d.httpBody ?? ""}
                    onChange={(e) => updateNode(node.id, { httpBody: e.target.value })}
                  />
                </div>
              )}
              <div>
                <Label className="text-sm font-semibold">Response Variable Mapping</Label>
                <Textarea
                  rows={3}
                  className="font-mono text-xs"
                  placeholder={"response.status -> {{booking_status}}\nresponse.slots[0] -> {{first_slot}}"}
                  value={d.httpResponseMapping ?? ""}
                  onChange={(e) => updateNode(node.id, { httpResponseMapping: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Map response fields to agent variables. One mapping per line.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label className="text-sm font-semibold">Timeout (ms)</Label>
                  <Input
                    type="number"
                    min={1000}
                    max={30000}
                    value={d.httpTimeoutMs ?? 10000}
                    onChange={(e) => updateNode(node.id, { httpTimeoutMs: parseInt(e.target.value) || 10000 })}
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-sm font-semibold">Retries</Label>
                  <Select
                    value={String(d.httpRetryCount ?? 0)}
                    onValueChange={(v) => updateNode(node.id, { httpRetryCount: parseInt(v) })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[0,1,2,3].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
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

          {(d.kind === "wa_start" || d.kind === "wa_message") && (
            <div className="space-y-3">
              <div>
                <Label>Message / Prompt</Label>
                <Textarea
                  rows={4}
                  value={d.dialogue ?? ""}
                  onChange={(e) => updateNode(node.id, { dialogue: e.target.value })}
                  placeholder="What should the agent say at this step? Use {variable} placeholders."
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  This text is included in the AI's instructions for this step. The agent responds conversationally based on it.
                </p>
              </div>
            </div>
          )}

          {d.kind === "wa_media" && (
            <div className="space-y-3">
              <div>
                <Label>Media URL</Label>
                <Input
                  value={d.mediaUrl ?? ""}
                  onChange={(e) => updateNode(node.id, { mediaUrl: e.target.value })}
                  placeholder="https://example.com/image.jpg"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Publicly accessible URL of the image, video, audio, or document to send via WhatsApp.
                  Twilio supports JPEG, PNG, GIF, MP4, PDF, and more.
                </p>
              </div>
              <div>
                <Label>Caption (optional)</Label>
                <Textarea
                  rows={2}
                  value={d.mediaCaption ?? ""}
                  onChange={(e) => updateNode(node.id, { mediaCaption: e.target.value })}
                  placeholder="Caption shown below the media (optional)"
                />
              </div>
              <div>
                <Label>Follow-up prompt (optional)</Label>
                <Textarea
                  rows={3}
                  value={d.dialogue ?? ""}
                  onChange={(e) => updateNode(node.id, { dialogue: e.target.value })}
                  placeholder="What should the agent say after sending the media?"
                />
              </div>
            </div>
          )}

          {d.kind === "wa_booking" && (
            <div className="space-y-3">
              <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-[12px] text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
                When the conversation reaches this node, the agent automatically fetches available
                Cal.com slots (if a Cal.com API key is configured in Settings) and presents them
                to the contact. If no API key is set, it falls back to sending the booking link below.
              </div>
              <div>
                <Label>Booking link (fallback)</Label>
                <Input
                  value={d.bookingUrl ?? ""}
                  onChange={(e) => updateNode(node.id, { bookingUrl: e.target.value })}
                  placeholder="https://cal.com/your-name/30min"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Sent when live slot fetching is unavailable or as a confirmation link.
                </p>
              </div>
              <div>
                <Label>Cal.com Event Type ID (optional override)</Label>
                <Input
                  value={d.bookingEventTypeId ?? ""}
                  onChange={(e) => updateNode(node.id, { bookingEventTypeId: e.target.value })}
                  placeholder="e.g. 12345 — leave blank to use workspace default"
                />
              </div>
              <div>
                <Label>Days ahead to show slots</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={d.bookingLookaheadDays ?? 7}
                  onChange={(e) => updateNode(node.id, { bookingLookaheadDays: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Intro message</Label>
                <Textarea
                  rows={3}
                  value={d.dialogue ?? ""}
                  onChange={(e) => updateNode(node.id, { dialogue: e.target.value })}
                  placeholder="e.g. Let me check what slots are available for you..."
                />
              </div>
            </div>
          )}

          {d.kind === "wa_wait_reply" && (
            <div className="space-y-3">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                When the flow reaches this node, the agent sends the message below and
                <strong> pauses</strong>. The next message the contact sends resumes the flow
                and evaluates the transitions below.
              </div>
              <div>
                <Label>Question / prompt to send</Label>
                <Textarea
                  rows={3}
                  value={d.dialogue ?? ""}
                  onChange={(e) => updateNode(node.id, { dialogue: e.target.value })}
                  placeholder="e.g. What's your budget range?"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Sent verbatim — no AI, no modifications. Use {"{"}<em>variable</em>{"}"} placeholders.
                </p>
              </div>
              <div>
                <Label>Variable to extract from reply (optional)</Label>
                <Input
                  value={d.extractVarName ?? ""}
                  onChange={(e) => updateNode(node.id, { extractVarName: e.target.value })}
                  placeholder="e.g. budget"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  In AI-Assisted mode the runtime will attempt to extract this named variable from
                  the contact's reply and store it for use in later {"{"}<em>variable</em>{"}"} placeholders.
                </p>
              </div>
              <div>
                <Label>Extraction instruction (optional)</Label>
                <Input
                  value={d.extractVarPrompt ?? ""}
                  onChange={(e) => updateNode(node.id, { extractVarPrompt: e.target.value })}
                  placeholder="e.g. Extract the numeric budget the user mentioned"
                />
              </div>
            </div>
          )}

          {d.kind === "wa_extract_var" && (
            <div className="space-y-3">
              <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-[12px] text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
                Silently extracts a named variable from the contact's last message.
                No reply is sent. The flow advances to the next node automatically.
              </div>
              <div>
                <Label>Variable name</Label>
                <Input
                  value={d.extractVarName ?? ""}
                  onChange={(e) => updateNode(node.id, { extractVarName: e.target.value })}
                  placeholder="e.g. city"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Stored as <code>{"{"}<em>city</em>{"}"}</code> — use this in later WA Message or WA Template nodes.
                </p>
              </div>
              <div>
                <Label>Extraction instruction</Label>
                <Textarea
                  rows={2}
                  value={d.extractVarPrompt ?? ""}
                  onChange={(e) => updateNode(node.id, { extractVarPrompt: e.target.value })}
                  placeholder="e.g. Extract the city or location the user mentioned"
                />
              </div>
            </div>
          )}

          {d.kind === "wa_tag" && (
            <div className="space-y-3">
              <div className="rounded-md border border-purple-200 bg-purple-50 p-3 text-[12px] text-purple-800 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300">
                Applies a tag to this contact in the contacts table. No message is sent.
                Useful for segmenting contacts (e.g. "qualified", "high-intent").
              </div>
              <div>
                <Label>Tag name</Label>
                <Input
                  value={d.tagName ?? ""}
                  onChange={(e) => updateNode(node.id, { tagName: e.target.value })}
                  placeholder="e.g. qualified"
                />
              </div>
            </div>
          )}

          {d.kind === "wa_template" && (
            <div className="space-y-3">
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-[12px] text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                Sends a fixed message with variable substitution — no AI generation.
                Use <code>{"{"}<em>variable_name</em>{"}"}</code> placeholders for values collected earlier.
              </div>

              {watiTemplates && watiTemplates.length > 0 && (
                <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
                  <Label>WATI approved template (optional)</Label>
                  <Select
                    value={d.watiTemplateName ?? "__none__"}
                    onValueChange={(v) =>
                      updateNode(node.id, {
                        watiTemplateName: v === "__none__" ? undefined : v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Free text (no template)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Free text (no template)</SelectItem>
                      {watiTemplates.map((t: any) => (
                        <SelectItem key={t.id ?? t.wati_template_id ?? t.name} value={t.name}>
                          {t.name}
                          {t.language ? ` (${t.language})` : ""}
                          {t.status ? ` · ${t.status}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {d.watiTemplateName && (
                    <div>
                      <Label>Template parameters (one per line)</Label>
                      <Textarea
                        rows={3}
                        value={(d.watiTemplateParams ?? []).join("\n")}
                        onChange={(e) =>
                          updateNode(node.id, {
                            watiTemplateParams: e.target.value.split("\n"),
                          })
                        }
                        placeholder={"{name}\n{budget}"}
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Sent via WATI's approved-template API. Each line maps in order to{" "}
                        {"{{1}}"}, {"{{2}}"}… Supports {"{"}<em>variable</em>{"}"} placeholders.
                        Used whenever this workspace has WATI connected; otherwise the message
                        body below is sent instead.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className={d.watiTemplateName ? "opacity-60" : ""}>
                <Label>
                  Message body{d.watiTemplateName ? " (fallback when not deployed via WATI)" : ""}
                </Label>
                <Textarea
                  rows={4}
                  value={d.templateBody ?? ""}
                  onChange={(e) => updateNode(node.id, { templateBody: e.target.value })}
                  placeholder={`e.g. Hi {name}, thanks for reaching out! Your budget of {budget} looks good.`}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Variables in {"{"}<em>curly braces</em>{"}"} are replaced with extracted values at runtime.
                </p>
              </div>
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
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </div>
              <div className="space-y-2">
                {d.transitions.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Add conditions to label the connections leaving this node. They become edge{" "}
                    <code>transition_condition.prompt</code> values in the JSON.
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
                      onClick={() => setTransitions(d.transitions.filter((x) => x.id !== t.id))}
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

function GlobalNodeSettings({ nodeId, value }: { nodeId: string; value: Record<string, unknown> }) {
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
                      <p className="text-xs text-muted-foreground mt-0.5">{o.description}</p>
                    )}
                  </div>
                  <Switch checked={enabled} onCheckedChange={(v) => toggleOverride(o, v)} />
                </div>

                {enabled && o.control === "slider" && (
                  <div className="flex items-center gap-3 pt-1">
                    <input
                      type="range"
                      min={o.min}
                      max={o.max}
                      step={o.step}
                      value={Number(current ?? o.defaultValue)}
                      onChange={(e) => setOverride(o.key, parseFloat(e.target.value))}
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
                      transferExtensionNumber: e.target.checked
                        ? (d.transferExtensionNumber ?? "")
                        : undefined,
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
            {
              v: "warm_transfer",
              t: "Warm Transfer",
              desc: "AI gives a one-way brief to the agent",
            },
            {
              v: "agentic_warm_transfer",
              t: "Agentic Warm Transfer",
              desc: "AI has a 2-way conversation with agent, then bridges",
            },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() =>
                updateNode(nodeId, {
                  transferType: o.v as "cold_transfer" | "warm_transfer" | "agentic_warm_transfer",
                })
              }
              className={`w-full text-left rounded-md border bg-background px-3 py-2 flex items-center justify-between ${transferType === o.v ? "ring-2 ring-foreground" : ""}`}
            >
              <div>
                <div className="text-sm font-medium">{o.t}</div>
                <div className="text-[11px] text-muted-foreground">{o.desc}</div>
              </div>
              <div
                className={`h-3 w-3 rounded-full border ${transferType === o.v ? "bg-foreground border-foreground" : ""}`}
              />
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
              onClick={() =>
                updateNode(nodeId, { sipTransferMethod: o.v as "sip_invite" | "sip_refer" })
              }
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
            <div
              className={`h-3 w-3 rounded-full border ${callerId === o.v ? "bg-foreground border-foreground" : ""}`}
            />
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
            onChange={(e) =>
              updateNode(nodeId, { transferRingDurationSec: parseInt(e.target.value) })
            }
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
    throwOnError: false,
  });

  const deployed = (agents ?? []).filter(
    (a) => a.retell_agent_id && a.retell_agent_id !== currentRetellAgentId,
  );

  // If the saved value isn't in the list (custom ID), keep it selectable.
  const valueIsCustom = !!value && !deployed.some((a) => a.retell_agent_id === value);

  return (
    <div>
      <Label>Destination agent</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={isLoading ? "Loading agents…" : "Select an agent"} />
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
              <span className="ml-2 text-xs text-muted-foreground">{a.retell_agent_id}</span>
            </SelectItem>
          ))}
          {valueIsCustom && <SelectItem value={value}>{value} (manual)</SelectItem>}
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
