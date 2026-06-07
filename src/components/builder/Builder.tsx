import { useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { toPng } from "html-to-image";
import { useBuilderStore } from "@/lib/builder/store";
import { CustomVoiceUploadDialog } from "@/components/builder/CustomVoiceUploadDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, MoreHorizontal, FileJson, Upload } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  MessageCircle,
  Cpu,
  PhoneForwarded,
  Hash,
  GitBranch,
  Users,
  MessageSquare,
  Braces,
  Code as CodeIcon,
  Square,
  StickyNote,
  Maximize,
  Trash,
  Image as ImageIcon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  CalendarClock,
  LayoutGrid,
  Undo2,
} from "lucide-react";
import { FlowCanvas } from "./FlowCanvas";
import { NodeEditorDialog } from "./NodeEditorDialog";
import { ExportJsonDialog } from "./ExportJsonDialog";
import { ImportJsonDialog } from "./ImportJsonDialog";
import { RetellDeployDialog } from "./RetellDeployDialog";
import { PostCallDataSection } from "./PostCallDataSection";
import { BookingConfigSection } from "./BookingConfigSection";
import type { BuilderSettings, NodeKind } from "@/lib/builder/types";
import { cn } from "@/lib/utils";
import { MODELS } from "@/lib/builder/pricing";

const PALETTE: { kind: NodeKind; label: string; icon: React.ElementType; color: string }[] = [
  { kind: "conversation", label: "Conversation", icon: MessageCircle, color: "text-sky-600" },
  { kind: "function", label: "Function", icon: Cpu, color: "text-violet-600" },
  {
    kind: "call_transfer",
    label: "Call Transfer",
    icon: PhoneForwarded,
    color: "text-emerald-600",
  },
  { kind: "press_digit", label: "Press Digit", icon: Hash, color: "text-cyan-600" },
  { kind: "logic_split", label: "Logic Split", icon: GitBranch, color: "text-pink-600" },
  { kind: "agent_transfer", label: "Agent Transfer", icon: Users, color: "text-orange-600" },
  { kind: "sms", label: "In-Call SMS", icon: MessageSquare, color: "text-amber-600" },
  { kind: "extract_variable", label: "Extract Variable", icon: Braces, color: "text-indigo-600" },
  { kind: "code", label: "Code", icon: CodeIcon, color: "text-slate-700" },
  { kind: "ending", label: "Ending", icon: Square, color: "text-rose-600" },
  { kind: "note", label: "Note", icon: StickyNote, color: "text-yellow-700" },
];

type VoiceGroup = "ElevenLabs" | "OpenAI" | "Deepgram";

const DEFAULT_VOICES: { id: string; label: string; group: VoiceGroup }[] = [
  // ElevenLabs
  { id: "11labs-Adrian", label: "Adrian — male, US", group: "ElevenLabs" },
  { id: "11labs-Anthony", label: "Anthony — male, US", group: "ElevenLabs" },
  { id: "11labs-Brian", label: "Brian — male, US", group: "ElevenLabs" },
  { id: "11labs-Chloe", label: "Chloe — female, US", group: "ElevenLabs" },
  { id: "11labs-Cimo", label: "Cimo — male, IT", group: "ElevenLabs" },
  { id: "11labs-Lily", label: "Lily — female, UK", group: "ElevenLabs" },
  { id: "11labs-Marissa", label: "Marissa — female, US", group: "ElevenLabs" },
  { id: "11labs-Myra", label: "Myra — female, US", group: "ElevenLabs" },
  { id: "11labs-Paul", label: "Paul — male, US", group: "ElevenLabs" },
  { id: "11labs-Zuri", label: "Zuri — female, US", group: "ElevenLabs" },
  // OpenAI
  { id: "openai-Alloy", label: "Alloy — neutral", group: "OpenAI" },
  { id: "openai-Echo", label: "Echo — male", group: "OpenAI" },
  { id: "openai-Nova", label: "Nova — female", group: "OpenAI" },
  { id: "openai-Shimmer", label: "Shimmer — female", group: "OpenAI" },
  { id: "openai-Onyx", label: "Onyx — male", group: "OpenAI" },
  // Deepgram
  { id: "deepgram-Angus", label: "Angus — male", group: "Deepgram" },
  { id: "deepgram-Asteria", label: "Asteria — female", group: "Deepgram" },
  { id: "deepgram-Luna", label: "Luna — female", group: "Deepgram" },
  { id: "deepgram-Orion", label: "Orion — male", group: "Deepgram" },
];

const VOICE_GROUPS: VoiceGroup[] = ["ElevenLabs", "OpenAI", "Deepgram"];

/**
 * Small inline widget that lets users paste their own ElevenLabs voice ID
 * and have it applied immediately. The platform handles the `11labs-` prefix
 * internally so no provider branding is exposed to end users.
 */
function ElevenLabsVoiceInserter({ onSelect }: { onSelect: (voiceId: string) => void }) {
  const [value, setValue] = useState("");

  function apply() {
    const raw = value.trim();
    if (!raw) return;
    // Accept either a bare ElevenLabs ID or one already prefixed.
    const voiceId = raw.startsWith("11labs-") ? raw : `11labs-${raw}`;
    onSelect(voiceId);
    setValue("");
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs">Your ElevenLabs Voice ID</Label>
      <div className="flex items-center gap-1">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
          className="h-7 text-xs flex-1"
          placeholder="Paste your ElevenLabs voice ID"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 px-2 text-xs shrink-0"
          onClick={apply}
          disabled={!value.trim()}
        >
          Use
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Find it in your ElevenLabs dashboard → Voices. This voice is used when you Go Live with your own Retell key; the builder preview may use a fallback voice if the ID isn't in the platform workspace.
      </p>
    </div>
  );
}

export function Builder({
  heightClass = "h-[78vh]",
  toolbarStart,
  toolbarLeading,
  toolbarTrailing,
}: {
  heightClass?: string;
  toolbarStart?: React.ReactNode;
  toolbarLeading?: React.ReactNode;
  toolbarTrailing?: React.ReactNode;
}) {
  const { addNode, addBookingNode, clearAll, autoLayout, revertLayout, settings, setSettings } =
    useBuilderStore();
  const preAutoLayoutPositions = useBuilderStore((s) => s.preAutoLayoutPositions);
  const [rf, setRf] = useState<ReturnType<typeof useReactFlow> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"node" | "components">("node");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const setNumericSetting = (key: keyof BuilderSettings, value: string, fallback: number) => {
    const parsed = Number(value);
    setSettings({ [key]: Number.isFinite(parsed) ? parsed : fallback } as Partial<BuilderSettings>);
  };

  const setCsvSetting = (key: keyof BuilderSettings, value: string) => {
    setSettings({
      [key]: value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    } as Partial<BuilderSettings>);
  };

  const pronunciationDictionary = settings.pronunciationDictionary ?? [];
  const updatePronunciation = (
    index: number,
    patch: Partial<(typeof pronunciationDictionary)[number]>,
  ) => {
    setSettings({
      pronunciationDictionary: pronunciationDictionary.map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry,
      ),
    });
  };

  const downloadPng = async () => {
    if (!canvasRef.current) return;
    const viewport = canvasRef.current.querySelector<HTMLElement>(".react-flow__viewport");
    const target = viewport ?? canvasRef.current;
    const dataUrl = await toPng(target, { backgroundColor: "#ffffff", pixelRatio: 2 });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "script-flow.png";
    a.click();
  };

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm",
        heightClass,
      )}
    >
      {/* Canvas toolbar — panel toggles + canvas actions only */}
      <div className="flex flex-nowrap items-center gap-1 border-b border-white/[0.04] bg-background/60 px-2 py-1 backdrop-blur-sm [&_button]:h-7 [&_button]:px-2 [&_button]:text-[11px] [&_button]:gap-1 [&_button_svg]:h-3.5 [&_button_svg]:w-3.5">
        {toolbarStart}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setLeftOpen((v) => !v)}
          title={leftOpen ? "Hide nodes panel" : "Show nodes panel"}
          className="!w-7 !p-0"
        >
          {leftOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
        <Input
          value={settings.agentName}
          onChange={(e) => setSettings({ agentName: e.target.value })}
          className="h-7 max-w-[160px] border-transparent bg-transparent px-1.5 text-[11px] font-medium text-foreground hover:border-white/[0.06] focus-visible:border-white/[0.1]"
          placeholder="Agent name"
        />
        {toolbarLeading}
        <div className="ml-auto flex flex-nowrap items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              autoLayout();
              requestAnimationFrame(() => rf?.fitView({ padding: 0.2, duration: 200 }));
            }}
            title="Auto-arrange nodes"
            className="!w-7 !p-0"
          >
            <LayoutGrid />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              revertLayout();
              requestAnimationFrame(() => rf?.fitView({ padding: 0.2, duration: 200 }));
            }}
            disabled={!preAutoLayoutPositions}
            title="Revert to original layout"
            className="!w-7 !p-0"
          >
            <Undo2 />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => rf?.fitView({ padding: 0.2 })}
            title="Fit canvas"
            className="!w-7 !p-0"
          >
            <Maximize />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                title="Clear canvas"
                className="!w-7 !p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear the canvas?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes all nodes and leaves only an empty Start Call and End Call.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={clearAll}>Clear</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {/* Import / Export grouped dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" title="Import / Export">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Import
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                <Upload className="mr-2 h-3.5 w-3.5" /> Import JSON
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Export
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setExportOpen(true)}>
                <FileJson className="mr-2 h-3.5 w-3.5" /> Download JSON
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={downloadPng}>
                <ImageIcon className="mr-2 h-3.5 w-3.5" /> Export PNG
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ImportJsonDialog open={importOpen} onOpenChange={setImportOpen} hideTrigger />
          <ExportJsonDialog open={exportOpen} onOpenChange={setExportOpen} hideTrigger />
          <div className="mx-0.5 h-4 w-px bg-white/[0.06]" />
          <RetellDeployDialog />
          {toolbarTrailing}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRightOpen((v) => !v)}
            title={rightOpen ? "Hide settings panel" : "Show settings panel"}
            className="!w-7 !p-0"
          >
            {rightOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left palette */}
        {leftOpen && (
          <aside className="w-36 shrink-0 border-r border-white/[0.04] bg-background/40 overflow-y-auto">
            <div className="flex border-b border-white/[0.04] text-[10px] uppercase tracking-wider">
              <button
                className={cn(
                  "flex-1 py-1.5 font-medium transition-colors",
                  tab === "node"
                    ? "bg-white/[0.04] text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setTab("node")}
              >
                Node
              </button>
              <button
                className={cn(
                  "flex-1 py-1.5 font-medium transition-colors",
                  tab === "components"
                    ? "bg-white/[0.04] text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setTab("components")}
              >
                Components
              </button>
            </div>
            <div className="p-1.5 space-y-0.5">
              {tab === "node" ? (
                PALETTE.map((p) => (
                  <button
                    key={p.kind}
                    onClick={() => {
                      let position: { x: number; y: number } | undefined;
                      if (rf && canvasRef.current) {
                        const b = canvasRef.current.getBoundingClientRect();
                        position = rf.screenToFlowPosition({
                          x: b.left + b.width / 2,
                          y: b.top + b.height / 2,
                        });
                      }
                      const id = addNode(p.kind, position);
                      if (rf && position) {
                        setTimeout(() => {
                          rf.setCenter(position!.x + 140, position!.y + 80, {
                            zoom: Math.max(rf.getZoom(), 0.8),
                            duration: 400,
                          });
                        }, 30);
                      }
                      void id;
                    }}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground text-left transition-colors"
                  >
                    <p.icon className={cn("h-3 w-3", p.color)} />
                    <span className="truncate">{p.label}</span>
                  </button>
                ))
              ) : (
                <>
                  <button
                    onClick={() => {
                      let position: { x: number; y: number } | undefined;
                      if (rf && canvasRef.current) {
                        const b = canvasRef.current.getBoundingClientRect();
                        position = rf.screenToFlowPosition({
                          x: b.left + b.width / 2,
                          y: b.top + b.height / 2,
                        });
                      }
                      addBookingNode(position);
                      if (rf && position) {
                        setTimeout(() => {
                          rf.setCenter(position!.x + 140, position!.y + 80, {
                            zoom: Math.max(rf.getZoom(), 0.8),
                            duration: 400,
                          });
                        }, 30);
                      }
                    }}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground text-left transition-colors"
                  >
                    <CalendarClock className="h-3 w-3 text-emerald-600" />
                    <span>Booking</span>
                  </button>
                  <p className="text-[10px] text-muted-foreground px-2 pt-1 leading-snug">
                    Drops a conversation node prefilled with instructions for when to call the
                    booking tools. Requires Cal.com connected and booking enabled in settings.
                  </p>
                </>
              )}
            </div>
          </aside>
        )}

        {/* Canvas */}
        <div className="flex-1 min-w-0">
          <FlowCanvas canvasRef={canvasRef} onReady={setRf} />
        </div>

        {/* Right global settings */}
        {rightOpen && (
          <aside className="w-60 shrink-0 border-l border-white/[0.04] bg-background/40 overflow-y-auto p-2 space-y-2 hidden md:block text-xs [&_label]:text-[10px] [&_label]:uppercase [&_label]:tracking-wider [&_label]:text-muted-foreground [&_textarea]:text-[11px] [&_button[role=combobox]]:h-7 [&_button[role=combobox]]:text-[11px]">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Global Settings
            </h3>

            <div className="rounded-lg border p-2 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Voice & Language</div>
              <div>
                <Label className="text-xs">Language</Label>
                <Input
                  value={settings.language}
                  onChange={(e) => setSettings({ language: e.target.value })}
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Voice</Label>
                <Select
                  value={
                    DEFAULT_VOICES.some((v) => v.id === settings.voiceId)
                      ? settings.voiceId
                      : settings.voiceId
                        ? "__custom__"
                        : ""
                  }
                  onValueChange={(v) => {
                    if (v !== "__custom__") setSettings({ voiceId: v });
                  }}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Pick a voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {VOICE_GROUPS.map((group) => (
                      <SelectGroup key={group}>
                        <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {group}
                        </SelectLabel>
                        {DEFAULT_VOICES.filter((v) => v.group === group).map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                    {settings.voiceId &&
                      !DEFAULT_VOICES.some((v) => v.id === settings.voiceId) && (
                        <SelectGroup>
                          <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Custom
                          </SelectLabel>
                          <SelectItem value="__custom__">
                            {(() => {
                              const id = settings.voiceId;
                              if (id.startsWith("11labs-")) return `ElevenLabs: ${id.slice(7)}`;
                              if (id.startsWith("custom_voice_")) return `Cloned voice: ${id.slice(13)}`;
                              return id;
                            })()}
                          </SelectItem>
                        </SelectGroup>
                      )}
                  </SelectContent>
                </Select>
              </div>
              <ElevenLabsVoiceInserter onSelect={(id) => setSettings({ voiceId: id })} />
              <div className="flex items-center gap-1 pt-0.5">
                <CustomVoiceUploadDialog onUploaded={(voiceId) => setSettings({ voiceId })} />
              </div>
            </div>

            <div className="rounded-lg border p-2 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Global Prompt</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs flex items-center gap-1.5">
                    Model
                    <span
                      className="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded bg-muted text-muted-foreground"
                      title="Internal cost (Retell rate + $0.15/min margin). Not shown to customers."
                    >
                      builder cost
                    </span>
                  </Label>
                  <Select value={settings.model} onValueChange={(v) => setSettings({ model: v })}>
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Standard</SelectLabel>
                        {MODELS.filter((m) => m.tier === "standard").map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            <span className="flex items-center justify-between gap-3 w-full">
                              <span className="flex items-center gap-1.5">
                                {m.label}
                                {m.recommended && (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">
                                    Recommended
                                  </span>
                                )}
                              </span>
                              <span className="text-muted-foreground text-[11px]">
                                ${m.costPerMin.toFixed(3)}/min
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Fast Tier — lower latency</SelectLabel>
                        {MODELS.filter((m) => m.tier === "fast").map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            <span className="flex items-center justify-between gap-3 w-full">
                              <span className="flex items-center gap-1.5">
                                {m.label}
                                {m.recommended && (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">
                                    Recommended
                                  </span>
                                )}
                                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
                                  Fast
                                </span>
                              </span>
                              <span className="text-muted-foreground text-[11px]">
                                ${m.costPerMin.toFixed(3)}/min
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Temperature</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    max={2}
                    value={settings.temperature}
                    onChange={(e) => setSettings({ temperature: parseFloat(e.target.value) || 0 })}
                    className="h-7 text-xs"
                  />
                </div>
              </div>
              <Textarea
                rows={5}
                value={settings.globalPrompt}
                onChange={(e) => setSettings({ globalPrompt: e.target.value })}
                placeholder="Enter your global prompt here"
                className="text-xs"
              />
            </div>

            <div className="rounded-lg border p-2 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Transition Flexibility
              </div>
              <Select
                value={settings.transitionFlexibility ?? "flex"}
                onValueChange={(v) =>
                  setSettings({ transitionFlexibility: v as "flex" | "strict" })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flex">Flex Mode</SelectItem>
                  <SelectItem value="strict">Strict Mode</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border p-2 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Agent</div>
              <div>
                <Label className="text-xs">Webhook URL</Label>
                <Input
                  value={settings.webhookUrl ?? ""}
                  onChange={(e) => setSettings({ webhookUrl: e.target.value })}
                  className="h-7 text-xs"
                  placeholder="https://…"
                />
              </div>
              <div>
                <Label className="text-xs">Start speaker</Label>
                <Select
                  value={settings.startSpeaker ?? "agent"}
                  onValueChange={(v) => setSettings({ startSpeaker: v as "agent" | "user" })}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <PostCallDataSection />

            <BookingConfigSection />

            <Collapsible className="rounded-lg border">
              <CollapsibleTrigger className="flex w-full items-center justify-between p-2 text-xs font-medium text-muted-foreground">
                <span>Agent Handbook</span>
                <ChevronDown className="h-4 w-4" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 px-2 pb-2">
                {(
                  [
                    ["handbookEchoVerification", "Echo verification"],
                    ["handbookSpeechNormalization", "Speech normalization"],
                    ["handbookDefaultPersonality", "Default personality"],
                    ["handbookScopeBoundaries", "Scope boundaries"],
                    ["handbookNaturalFillerWords", "Natural filler words"],
                    ["handbookNatoPhoneticAlphabet", "NATO phonetic alphabet"],
                    ["handbookHighEmpathy", "High empathy"],
                    ["handbookAiDisclosure", "AI disclosure"],
                    ["handbookSmartMatching", "Smart matching"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between">
                    <Label className="text-xs">{label}</Label>
                    <Switch
                      checked={Boolean(settings[key])}
                      onCheckedChange={(v) => setSettings({ [key]: v })}
                    />
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>

            <Collapsible className="rounded-lg border">
              <CollapsibleTrigger className="flex w-full items-center justify-between p-2 text-xs font-medium text-muted-foreground">
                <span>Speech Settings</span>
                <ChevronDown className="h-4 w-4" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 px-2 pb-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Voice speed</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min={0.5}
                      max={2}
                      value={settings.voiceSpeed ?? 1}
                      onChange={(e) => setNumericSetting("voiceSpeed", e.target.value, 1)}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Voice temp</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min={0}
                      max={2}
                      value={settings.voiceTemperature ?? 1}
                      onChange={(e) => setNumericSetting("voiceTemperature", e.target.value, 1)}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Volume</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min={0}
                      max={2}
                      value={settings.volume ?? 1}
                      onChange={(e) => setNumericSetting("volume", e.target.value, 1)}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Responsiveness</Label>
                    <Input
                      type="number"
                      step="0.05"
                      min={0}
                      max={1}
                      value={settings.responsiveness ?? 1}
                      onChange={(e) => setNumericSetting("responsiveness", e.target.value, 1)}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Interruption</Label>
                    <Input
                      type="number"
                      step="0.05"
                      min={0}
                      max={1}
                      value={settings.interruptionSensitivity ?? 0.7}
                      onChange={(e) =>
                        setNumericSetting("interruptionSensitivity", e.target.value, 0.7)
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Emotion</Label>
                    <Select
                      value={settings.voiceEmotion ?? "none"}
                      onValueChange={(v) =>
                        setSettings({ voiceEmotion: v as BuilderSettings["voiceEmotion"] })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(
                          [
                            "none",
                            "calm",
                            "sympathetic",
                            "happy",
                            "sad",
                            "angry",
                            "fearful",
                            "surprised",
                          ] as const
                        ).map((v) => (
                          <SelectItem key={v} value={v}>
                            {v === "none" ? "None" : v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">STT mode</Label>
                    <Select
                      value={settings.sttMode ?? "fast"}
                      onValueChange={(v) =>
                        setSettings({ sttMode: v as BuilderSettings["sttMode"] })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fast">Fast</SelectItem>
                        <SelectItem value="accurate">Accurate</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Vocabulary</Label>
                    <Select
                      value={settings.vocabSpecialization ?? "general"}
                      onValueChange={(v) =>
                        setSettings({
                          vocabSpecialization: v as BuilderSettings["vocabSpecialization"],
                        })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="medical">Medical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Boosted keywords</Label>
                  <Input
                    value={(settings.boostedKeywords ?? []).join(", ")}
                    onChange={(e) => setCsvSetting("boostedKeywords", e.target.value)}
                    placeholder="names, brands, specialist words"
                    className="h-7 text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Reminder (ms)</Label>
                    <Input
                      type="number"
                      step="1000"
                      min={0}
                      value={settings.reminderTriggerMs ?? 10000}
                      onChange={(e) =>
                        setNumericSetting("reminderTriggerMs", e.target.value, 10000)
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Reminder count</Label>
                    <Input
                      type="number"
                      step="1"
                      min={0}
                      value={settings.reminderMaxCount ?? 1}
                      onChange={(e) => setNumericSetting("reminderMaxCount", e.target.value, 1)}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Silence end (ms)</Label>
                    <Input
                      type="number"
                      step="1000"
                      min={10000}
                      value={settings.endCallAfterSilenceMs ?? 600000}
                      onChange={(e) =>
                        setNumericSetting("endCallAfterSilenceMs", e.target.value, 600000)
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Begin delay (ms)</Label>
                    <Input
                      type="number"
                      step="100"
                      min={0}
                      max={5000}
                      value={settings.beginMessageDelayMs ?? 0}
                      onChange={(e) => setNumericSetting("beginMessageDelayMs", e.target.value, 0)}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Max call (ms)</Label>
                    <Input
                      type="number"
                      step="1000"
                      min={60000}
                      value={settings.maxCallDurationMs ?? 1800000}
                      onChange={(e) =>
                        setNumericSetting("maxCallDurationMs", e.target.value, 1800000)
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Ring (ms)</Label>
                    <Input
                      type="number"
                      step="1000"
                      min={5000}
                      value={settings.ringDurationMs ?? 30000}
                      onChange={(e) => setNumericSetting("ringDurationMs", e.target.value, 30000)}
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Ambient sound</Label>
                  <Select
                    value={settings.ambientSound ?? "none"}
                    onValueChange={(v) =>
                      setSettings({ ambientSound: v as BuilderSettings["ambientSound"] })
                    }
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="coffee-shop">Coffee shop</SelectItem>
                      <SelectItem value="convention-hall">Convention hall</SelectItem>
                      <SelectItem value="summer-outdoor">Summer outdoor</SelectItem>
                      <SelectItem value="mountain-outdoor">Mountain outdoor</SelectItem>
                      <SelectItem value="static-noise">Static noise</SelectItem>
                      <SelectItem value="call-center">Call center</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Ambient volume</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min={0}
                      max={2}
                      value={settings.ambientSoundVolume ?? 1}
                      onChange={(e) => setNumericSetting("ambientSoundVolume", e.target.value, 1)}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Denoising</Label>
                    <Select
                      value={settings.denoisingMode ?? "noise-and-background-speech-cancellation"}
                      onValueChange={(v) =>
                        setSettings({ denoisingMode: v as BuilderSettings["denoisingMode"] })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no-denoise">No denoise</SelectItem>
                        <SelectItem value="noise-cancellation">Noise cancellation</SelectItem>
                        <SelectItem value="noise-and-background-speech-cancellation">
                          Noise + speech
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Dynamic voice speed</Label>
                  <Switch
                    checked={Boolean(settings.enableDynamicVoiceSpeed)}
                    onCheckedChange={(v) => setSettings({ enableDynamicVoiceSpeed: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Dynamic responsiveness</Label>
                  <Switch
                    checked={Boolean(settings.enableDynamicResponsiveness)}
                    onCheckedChange={(v) => setSettings({ enableDynamicResponsiveness: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Normalize for speech</Label>
                  <Switch
                    checked={settings.normalizeForSpeech ?? true}
                    onCheckedChange={(v) => setSettings({ normalizeForSpeech: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Backchannel</Label>
                  <Switch
                    checked={Boolean(settings.enableBackchannel)}
                    onCheckedChange={(v) => setSettings({ enableBackchannel: v })}
                  />
                </div>
                {settings.enableBackchannel && (
                  <div className="space-y-2 rounded-md bg-muted/50 p-2">
                    <div>
                      <Label className="text-xs">Backchannel frequency</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min={0}
                        max={1}
                        value={settings.backchannelFrequency ?? 0.8}
                        onChange={(e) =>
                          setNumericSetting("backchannelFrequency", e.target.value, 0.8)
                        }
                        className="h-7 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Backchannel words</Label>
                      <Input
                        value={(settings.backchannelWords ?? []).join(", ")}
                        onChange={(e) => setCsvSetting("backchannelWords", e.target.value)}
                        placeholder="yeah, uh-huh, okay"
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Allow user DTMF</Label>
                  <Switch
                    checked={Boolean(settings.allowUserDtmf)}
                    onCheckedChange={(v) => setSettings({ allowUserDtmf: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">DTMF can interrupt</Label>
                  <Switch
                    checked={Boolean(settings.allowDtmfInterruption)}
                    onCheckedChange={(v) => setSettings({ allowDtmfInterruption: v })}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Pronunciation dictionary</Label>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setSettings({
                          pronunciationDictionary: [
                            ...pronunciationDictionary,
                            { word: "", alphabet: "ipa", phoneme: "" },
                          ],
                        })
                      }
                    >
                      Add
                    </Button>
                  </div>
                  {pronunciationDictionary.map((entry, index) => (
                    <div key={index} className="space-y-1 rounded-md bg-muted/50 p-2">
                      <div className="flex items-center gap-1">
                        <Input
                          className="h-8 flex-1"
                          placeholder="Word"
                          value={entry.word}
                          onChange={(e) => updatePronunciation(index, { word: e.target.value })}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          title="Remove entry"
                          onClick={() =>
                            setSettings({
                              pronunciationDictionary: pronunciationDictionary.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          ✕
                        </Button>
                      </div>
                      <div className="grid grid-cols-[76px_1fr] gap-1">
                        <Select
                          value={entry.alphabet}
                          onValueChange={(v) =>
                            updatePronunciation(index, { alphabet: v as "ipa" | "cmu" })
                          }
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ipa">IPA</SelectItem>
                            <SelectItem value="cmu">CMU</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          className="h-7 text-xs"
                          placeholder="Phoneme"
                          value={entry.phoneme}
                          onChange={(e) => updatePronunciation(index, { phoneme: e.target.value })}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </aside>
        )}
      </div>

      <NodeEditorDialog />
    </div>
  );
}
