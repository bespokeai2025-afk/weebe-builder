import { useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { toPng } from "html-to-image";
import { useBuilderStore } from "@/lib/builder/store";
import { resolveDeploymentMode, isRetellMode, isOpenAINativeMode } from "@/lib/runtime/adapter";
import type { DeploymentMode } from "@/lib/runtime/types";
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
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, MoreHorizontal, FileJson, Upload, FileUp, Search, Check, ArrowLeftRight, Globe, Mic, MessageSquare as MsgSq, Settings2, Zap, Radio, Lock, Sparkles, Gem } from "lucide-react";
import { KnowledgeBaseSection } from "@/components/builder/KnowledgeBaseSection";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  ChevronLeft,
  ChevronRight,
  CalendarClock,
  LayoutGrid,
  Undo2,
} from "lucide-react";
import { FlowCanvas } from "./FlowCanvas";
import { NodeEditorDialog } from "./NodeEditorDialog";
import { ExportJsonDialog } from "./ExportJsonDialog";
import { ImportJsonDialog } from "./ImportJsonDialog";
import { ImportPDFDialog } from "./ImportPDFDialog";
import { RetellDeployDialog, type TxEntry } from "./RetellDeployDialog";
import { VoiceCopilotButton } from "./VoiceCopilot";
import { PlatformGuideDrawer } from "./PlatformGuideDrawer";
import { PostCallDataSection } from "./PostCallDataSection";
import { BookingConfigSection } from "./BookingConfigSection";
import { LeadGenSection } from "./LeadGenSection";
import { ClientQualificationSection } from "./ClientQualificationSection";
import type { BuilderSettings, NodeKind } from "@/lib/builder/types";
import { cn } from "@/lib/utils";
import { MODELS, HYPERSTREAM_MODELS } from "@/lib/builder/pricing";
import { toast } from "sonner";

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

const LANGUAGES: { code: string; flag: string; name: string; region: string }[] = [
  { code: "en-US",  flag: "🇺🇸", name: "English",    region: "US"            },
  { code: "es-ES",  flag: "🇪🇸", name: "Spanish",    region: "Spain"         },
  { code: "es-419", flag: "🇲🇽", name: "Spanish",    region: "Latin America" },
  { code: "en-IN",  flag: "🇮🇳", name: "English",    region: "India"         },
  { code: "en-GB",  flag: "🇬🇧", name: "English",    region: "UK"            },
  { code: "en-AU",  flag: "🇦🇺", name: "English",    region: "Australia"     },
  { code: "en-NZ",  flag: "🇳🇿", name: "English",    region: "New Zealand"   },
  { code: "fr-FR",  flag: "🇫🇷", name: "French",     region: "France"        },
  { code: "fr-CA",  flag: "🇨🇦", name: "French",     region: "Canada"        },
  { code: "zh-CN",  flag: "🇨🇳", name: "Chinese",    region: "China"         },
  { code: "de-DE",  flag: "🇩🇪", name: "German",     region: "Germany"       },
  { code: "hi-IN",  flag: "🇮🇳", name: "Hindi",      region: "India"         },
  { code: "it-IT",  flag: "🇮🇹", name: "Italian",    region: "Italy"         },
  { code: "ja-JP",  flag: "🇯🇵", name: "Japanese",   region: "Japan"         },
  { code: "ko-KR",  flag: "🇰🇷", name: "Korean",     region: "Korea"         },
  { code: "nl-NL",  flag: "🇳🇱", name: "Dutch",      region: "Netherlands"   },
  { code: "pl-PL",  flag: "🇵🇱", name: "Polish",     region: "Poland"        },
  { code: "pt-BR",  flag: "🇧🇷", name: "Portuguese", region: "Brazil"        },
  { code: "pt-PT",  flag: "🇵🇹", name: "Portuguese", region: "Portugal"      },
  { code: "ru-RU",  flag: "🇷🇺", name: "Russian",    region: "Russia"        },
  { code: "tr-TR",  flag: "🇹🇷", name: "Turkish",    region: "Turkey"        },
  { code: "vi-VN",  flag: "🇻🇳", name: "Vietnamese", region: "Vietnam"       },
  { code: "ar-AE",  flag: "🇦🇪", name: "Arabic",     region: "UAE"           },
];

function langLabel(codes: string[]): string {
  if (!codes.length) return "English (US)";
  if (codes[0] === "multi") return "Flex Mode";
  if (codes.length > 1) return `Multilingual (${codes.length})`;
  const l = LANGUAGES.find((x) => x.code === codes[0]);
  return l ? `${l.flag} ${l.name} (${l.region})` : codes[0];
}

function LanguagePicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [multi, setMulti] = useState(value.length > 1);
  const [search, setSearch] = useState("");

  const isFlex = value.includes("multi");
  const filtered = LANGUAGES.filter(
    (l) =>
      !search ||
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.region.toLowerCase().includes(search.toLowerCase()),
  );

  function toggleLang(code: string) {
    if (multi) {
      if (value.includes(code)) {
        const next = value.filter((c) => c !== code);
        onChange(next.length ? next : [code]);
      } else {
        onChange([...value.filter((c) => c !== "multi"), code]);
      }
    } else {
      onChange([code]);
      setOpen(false);
    }
  }

  function pickFlex() {
    onChange(["multi"]);
    setOpen(false);
  }

  function switchMode() {
    const next = !multi;
    setMulti(next);
    if (!next && value.length > 1) onChange([value[0]]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 w-full justify-between text-xs font-normal px-2">
          <span className="truncate">{langLabel(value)}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="flex items-center justify-between px-3 pt-3 pb-1">
          <span className="text-[11px] font-medium">
            {multi ? "Speech Languages" : "Speech Language"}
          </span>
          <button
            onClick={switchMode}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeftRight className="h-3 w-3" />
            {multi ? "Single-select" : "Multiselect"}
          </button>
        </div>
        {multi && (
          <p className="px-3 pb-1 text-[10px] text-muted-foreground leading-snug">
            Single language mode is recommended for best accuracy.
          </p>
        )}
        <div className="px-2 pb-1">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-6 pr-2 py-1 text-xs bg-muted/40 rounded border-0 outline-none ring-0 placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="max-h-52 overflow-y-auto">
          {filtered.map((l) => {
            const selected = value.includes(l.code);
            return (
              <button
                key={l.code}
                onClick={() => toggleLang(l.code)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors"
              >
                <span className="text-base leading-none w-5 text-center">{l.flag}</span>
                <span className="font-medium">{l.name}</span>
                <span className="text-muted-foreground">({l.region})</span>
                <span className="ml-auto">
                  {multi ? (
                    <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center ${selected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                      {selected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </span>
                  ) : (
                    selected && <Check className="h-3 w-3 text-primary" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className="border-t">
          <button
            onClick={pickFlex}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted/60 transition-colors"
          >
            <Globe className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="font-medium">Flex Mode</span>
            <span className="ml-auto">
              {isFlex && <Check className="h-3 w-3 text-primary" />}
            </span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

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
  const currentAgentRowId = useBuilderStore((s) => s.currentAgentRowId);
  const saveVersion = useBuilderStore((s) => s.saveVersion);
  const [pendingEngine, setPendingEngine] = useState<DeploymentMode | null>(null);
  const undoToastIdRef = useRef<string | number | null>(null);
  const saveVersionRef = useRef(saveVersion);

  useEffect(() => {
    if (saveVersion !== saveVersionRef.current) {
      saveVersionRef.current = saveVersion;
      if (undoToastIdRef.current !== null) {
        toast.dismiss(undoToastIdRef.current);
        undoToastIdRef.current = null;
      }
    }
  }, [saveVersion]);

  // All runtime branching goes through the adapter — never read voiceProvider directly.
  // resolveDeploymentMode() handles legacy agents (voiceProvider="OPENAI_REALTIME") and
  // new agents (deploymentMode="OPENAI_NATIVE") transparently.
  const activeMode = resolveDeploymentMode(settings);
  const isRetell = isRetellMode(activeMode);
  const isOpenAI = isOpenAINativeMode(activeMode);
  const preAutoLayoutPositions = useBuilderStore((s) => s.preAutoLayoutPositions);
  const [rf, setRf] = useState<ReturnType<typeof useReactFlow> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"node" | "components">("node");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [callActive, setCallActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<TxEntry[]>([]);
  const transcriptPanelRef = useRef<HTMLDivElement | null>(null);

  // Force the right panel open when a call starts; auto-clear transcript when it ends.
  useEffect(() => {
    if (callActive) {
      setRightOpen(true);
    } else {
      setLiveTranscript([]);
    }
  }, [callActive]);

  useEffect(() => {
    if (transcriptPanelRef.current) {
      transcriptPanelRef.current.scrollTop = transcriptPanelRef.current.scrollHeight;
    }
  }, [liveTranscript]);
  const [guideOpen, setGuideOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPdfOpen, setImportPdfOpen] = useState(false);
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

  const SliderField = ({
    label,
    value,
    min,
    max,
    step,
    onChange,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (v: number) => void;
  }) => {
    const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
          <span className="text-[10px] tabular-nums text-foreground/70 font-mono">{value.toFixed(decimals)}</span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full h-[3px] cursor-pointer rounded-full appearance-none bg-white/[0.08]
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
            [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_hsl(var(--background))]
            [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3
            [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary
            [&::-moz-range-thumb]:border-0"
        />
      </div>
    );
  };

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm",
        heightClass,
      )}
    >
      {/* Canvas toolbar */}
      <div className="flex flex-nowrap items-center gap-1.5 border-b border-white/[0.04] bg-background/60 px-2 py-1 backdrop-blur-sm [&_button]:h-7 [&_button]:px-2 [&_button]:text-[11px] [&_button]:gap-1 [&_button_svg]:h-3.5 [&_button_svg]:w-3.5">
        {/* Left: panel toggle + agent name + status */}
        <div className="flex flex-1 items-center gap-1 min-w-0">
          {toolbarStart}
          <Input
            data-tour="agent-name-input"
            value={settings.agentName}
            onChange={(e) => setSettings({ agentName: e.target.value })}
            className="h-7 max-w-[180px] border-transparent bg-transparent px-1.5 text-[11px] font-semibold text-foreground hover:border-white/[0.06] focus-visible:border-white/[0.1]"
            placeholder="Agent name"
          />
          {settings.voiceProvider === "OPENAI_REALTIME" && (
            <Badge
              variant="outline"
              className="shrink-0 border-violet-500/40 bg-violet-500/10 text-violet-300 text-[10px] gap-1 px-1.5 py-0.5 h-5"
            >
              <Zap className="h-2.5 w-2.5" />
              Enterprise Line
            </Badge>
          )}
          {toolbarLeading}
        </div>

        {/* Right: canvas utilities + primary actions */}
        <div className="flex flex-nowrap items-center gap-1.5">
          {/* Canvas utility cluster */}
          <div className="flex items-center gap-0.5 rounded-md border border-white/[0.05] bg-white/[0.02] px-1 py-0.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                autoLayout();
                requestAnimationFrame(() => rf?.fitView({ padding: 0.2, duration: 200 }));
              }}
              title="Auto-arrange nodes"
              className="!w-8 !p-0 text-muted-foreground/60 hover:text-foreground"
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
              className="!w-8 !p-0 text-muted-foreground/60 hover:text-foreground"
            >
              <Undo2 />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => rf?.fitView({ padding: 0.2 })}
              title="Fit canvas"
              className="!w-8 !p-0 text-muted-foreground/60 hover:text-foreground"
            >
              <Maximize />
            </Button>
            {/* Import / Export dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" title="Import / Export" className="!w-8 !p-0 text-muted-foreground/60 hover:text-foreground">
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
                <DropdownMenuItem onSelect={() => setImportPdfOpen(true)}>
                  <FileUp className="mr-2 h-3.5 w-3.5" /> Upload Script (PDF)
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
            {/* Divider */}
            <div className="h-3.5 w-px bg-white/[0.07] mx-0.5" />
            {/* Clear canvas (trash) — reveals destructive color on hover only */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  title="Clear canvas"
                  className="!w-8 !p-0 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
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
          </div>
          <ImportJsonDialog open={importOpen} onOpenChange={setImportOpen} hideTrigger />
          <ImportPDFDialog open={importPdfOpen} onOpenChange={setImportPdfOpen} />
          <ExportJsonDialog open={exportOpen} onOpenChange={setExportOpen} hideTrigger />

          {/* Engine-switch confirmation dialog */}
          <AlertDialog open={pendingEngine !== null} onOpenChange={(open) => { if (!open) setPendingEngine(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Switch voice engine?</AlertDialogTitle>
                <AlertDialogDescription>
                  This agent is already saved. Switching to a different voice engine will reset engine-specific settings such as voice selection and reasoning effort. This change takes effect the next time you save the agent.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setPendingEngine(null)}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (pendingEngine) {
                      const snapshot = { ...settings };
                      // Write deploymentMode (new) AND keep voiceProvider in sync
                      // (legacy field) so existing Retell code that reads voiceProvider
                      // continues to work without modification.
                      setSettings({
                        deploymentMode: pendingEngine,
                        voiceProvider: pendingEngine === "OPENAI_NATIVE" ? "OPENAI_REALTIME" : "RETELL",
                      });
                      setPendingEngine(null);
                      const id = toast("Voice engine switched", {
                        description: "Engine-specific settings have been reset.",
                        duration: 5000,
                        action: {
                          label: "Undo",
                          onClick: () => {
                            setSettings(snapshot);
                            undoToastIdRef.current = null;
                          },
                        },
                        onDismiss: () => {
                          undoToastIdRef.current = null;
                        },
                      });
                      undoToastIdRef.current = id;
                    } else {
                      setPendingEngine(null);
                    }
                  }}
                >
                  Switch engine
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Voice Copilot — own small capsule */}
          <div className="flex items-center rounded-md bg-white/[0.03] border border-white/[0.05] px-0.5 gap-0.5">
            <VoiceCopilotButton
              onModeChange={(m) => setGuideOpen(m === "PLATFORM_HELP")}
            />
          </div>

          {/* Separator */}
          <div className="h-4 w-px bg-white/[0.06]" />

          {/* Deploy / utility cluster + trailing save actions */}
          <div data-tour="deploy-btn" className="inline-flex items-center">
            <RetellDeployDialog
              onCallActive={setCallActive}
              onTranscriptUpdate={setLiveTranscript}
            />
          </div>
          {toolbarTrailing}

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

        {/* Minimized icon strip — shown when left panel is collapsed */}
        {!leftOpen && (
          <aside className="w-9 shrink-0 border-r border-white/[0.04] bg-background/40 overflow-y-auto flex flex-col items-center py-1 gap-0.5 scrollbar-thin">
            {PALETTE.map((p) => (
              <button
                key={p.kind}
                title={p.label}
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
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/[0.06] text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <p.icon className={cn("h-3.5 w-3.5", p.color)} />
              </button>
            ))}
          </aside>
        )}

        {/* Canvas */}
        <div className="flex-1 min-w-0 relative">
          {/* Left panel toggle — anchored to the left border */}
          <button
            onClick={() => setLeftOpen((v) => !v)}
            title={leftOpen ? "Collapse panel" : "Expand panel"}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-30 flex h-12 w-4 items-center justify-center rounded-sm border border-white/[0.07] bg-background/80 text-white/40 hover:text-white/80 hover:bg-white/[0.07] hover:border-white/[0.14] transition-all duration-200 backdrop-blur-sm"
          >
            {leftOpen
              ? <ChevronLeft className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              : <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={1.5} />}
          </button>

          {/* Right panel toggle — anchored to the right border */}
          <button
            onClick={() => setRightOpen((v) => !v)}
            title={rightOpen ? "Collapse settings" : "Expand settings"}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-30 flex h-12 w-4 items-center justify-center rounded-sm border border-white/[0.07] bg-background/80 text-white/40 hover:text-white/80 hover:bg-white/[0.07] hover:border-white/[0.14] transition-all duration-200 backdrop-blur-sm"
          >
            {rightOpen
              ? <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              : <ChevronLeft className="h-3 w-3 shrink-0" strokeWidth={1.5} />}
          </button>

          <FlowCanvas canvasRef={canvasRef} onReady={setRf} />
        </div>

        {/* Right global settings / live transcript */}
        {(rightOpen || callActive || liveTranscript.length > 0) && (
          <aside data-tour="right-panel" className="w-[320px] min-w-[300px] max-w-[360px] shrink-0 border-l border-white/[0.04] bg-background/40 overflow-y-auto px-2.5 py-2 space-y-1.5 hidden md:block text-[11px] [&_label]:text-[10px] [&_label]:uppercase [&_label]:tracking-wider [&_label]:text-muted-foreground [&_textarea]:text-[11px] [&_button[role=combobox]]:h-7 [&_button[role=combobox]]:text-[11px] [&_input]:text-[11px] [&_select]:text-[11px]">

            {/* ── Live transcript view (replaces settings during/after a call) ── */}
            {(callActive || liveTranscript.length > 0) ? (
              <div className="flex flex-col h-full">
                {/* Header */}
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.06] mb-2">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-violet-400" />
                    <span className="text-[11px] font-semibold tracking-tight text-foreground">Live Transcript</span>
                    {callActive && <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse ml-0.5" />}
                    {!callActive && <span className="text-[10px] text-muted-foreground ml-1">· ended</span>}
                  </div>
                  {!callActive && (
                    <button
                      type="button"
                      onClick={() => setLiveTranscript([])}
                      className="text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-white/[0.06]"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {/* Conversation */}
                <div
                  ref={transcriptPanelRef}
                  className="flex-1 overflow-y-auto space-y-2 pr-0.5"
                  style={{ maxHeight: "calc(100% - 32px)" }}
                >
                  {liveTranscript.length === 0 ? (
                    <p className="py-8 text-center text-[11px] text-muted-foreground">
                      Waiting for conversation…
                    </p>
                  ) : (
                    liveTranscript.map((entry) => (
                      <div
                        key={entry.id}
                        className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[90%] rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${
                            entry.role === "user"
                              ? entry.partial
                                ? "bg-violet-500/10 text-violet-300/60 italic"
                                : "bg-violet-500/15 text-violet-200"
                              : "bg-white/[0.06] text-foreground/80"
                          }`}
                        >
                          {entry.text}
                          {entry.partial && entry.role === "agent" && (
                            <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-current align-middle opacity-70" />
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
            <>
            {/* Panel header */}
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
              <h3 className="text-[11px] font-semibold tracking-tight text-foreground">Agent Settings</h3>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex h-5 w-5 items-center justify-center rounded hover:bg-white/[0.06] text-muted-foreground hover:text-foreground transition-colors">
                    <MoreHorizontal className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => rf?.fitView({ padding: 0.2 })}>
                    Fit canvas view
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Voice Infrastructure Routing */}
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.01] p-2.5 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Voice Infrastructure</p>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { mode: "RETELL"        as DeploymentMode, label: "OmniVoice",   sub: "Premium Catalog",  icon: Radio,    available: true  },
                    { mode: "OPENAI_NATIVE" as DeploymentMode, label: "HyperStream", sub: "Instant Response", icon: Zap,      available: true  },
                    { mode: "CLAUDE_NATIVE" as DeploymentMode, label: "Claude",      sub: "Coming Soon",      icon: Sparkles, available: false },
                    { mode: "GEMINI_NATIVE" as DeploymentMode, label: "Gemini",      sub: "Coming Soon",      icon: Gem,      available: false },
                  ]
                ).map(({ mode, label, sub, icon: Icon, available }) => {
                  const active = activeMode === mode;
                  return (
                    <button
                      key={mode}
                      disabled={!available}
                      onClick={() => {
                        if (active || !available) return;
                        if (currentAgentRowId) {
                          setPendingEngine(mode);
                        } else {
                          // Keep voiceProvider in sync for backward compat.
                          setSettings({
                            deploymentMode: mode,
                            voiceProvider: mode === "OPENAI_NATIVE" ? "OPENAI_REALTIME" : "RETELL",
                          });
                        }
                      }}
                      className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-all duration-150 ${
                        active
                          ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30"
                          : !available
                            ? "border-white/[0.04] bg-white/[0.01] opacity-40 cursor-not-allowed"
                            : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] hover:bg-white/[0.04]"
                      }`}
                    >
                      <Icon className={`h-3 w-3 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="min-w-0">
                        <div className={`text-[10px] font-medium truncate ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</div>
                        <div className="text-[9px] text-muted-foreground/60">{sub}</div>
                      </div>
                      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
              {isOpenAI && (
                <div className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 w-fit">
                  <Lock className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                  <span className="text-[9px] text-muted-foreground">Routed via Master Admin Enterprise Line</span>
                </div>
              )}
            </div>

            <Collapsible data-tour="voice-section" className="rounded-lg border border-white/[0.06] bg-white/[0.01]" defaultOpen>
              <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                <span className="flex items-center gap-1.5"><Mic className="h-3 w-3" />Voice & Language</span>
                <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 px-2.5 pb-2.5">
                <div>
                  <Label className="text-[9px]">Language</Label>
                  <LanguagePicker
                    value={settings.speechLanguages ?? [settings.language ?? "en-US"]}
                    onChange={(v) => setSettings({ speechLanguages: v, language: v[0] === "multi" ? "en-US" : v[0] })}
                  />
                </div>
                {isRetell && (
                  <>
                    <div>
                      <Label className="text-[9px]">Voice</Label>
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
                        <SelectTrigger className="h-6 text-[10px]">
                          <SelectValue placeholder="Pick a voice" />
                        </SelectTrigger>
                        <SelectContent>
                          {VOICE_GROUPS.map((group) => (
                            <SelectGroup key={group}>
                              <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">{group}</SelectLabel>
                              {DEFAULT_VOICES.filter((v) => v.group === group).map((v) => (
                                <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                          {settings.voiceId && !DEFAULT_VOICES.some((v) => v.id === settings.voiceId) && (
                            <SelectGroup>
                              <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Custom</SelectLabel>
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
                    <CustomVoiceUploadDialog onUploaded={(voiceId) => setSettings({ voiceId })} />
                  </>
                )}
              </CollapsibleContent>
            </Collapsible>

            {isOpenAI && (
              <Collapsible className="rounded-lg border border-primary/20 bg-primary/[0.03]" defaultOpen>
                <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                  <span className="flex items-center gap-1.5"><Zap className="h-3 w-3 text-primary" />OpenAI Engine</span>
                  <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2.5 px-2.5 pb-2.5">
                  {/* Native Voice Profile */}
                  <div>
                    <Label className="text-[9px]">Native Voice Profile</Label>
                    <Select
                      value={settings.openaiVoice ?? "alloy"}
                      onValueChange={(v) => setSettings({ openaiVoice: v as BuilderSettings["openaiVoice"] })}
                    >
                      <SelectTrigger className="h-7 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(
                          [
                            { id: "alloy",   desc: "Neutral, Balanced" },
                            { id: "ash",     desc: "Casual, Warm" },
                            { id: "ballad",  desc: "Professional, Deep" },
                            { id: "coral",   desc: "Clear, Friendly" },
                            { id: "echo",    desc: "Confident, Crispy" },
                            { id: "shimmer", desc: "Bright, Professional" },
                            { id: "sage",    desc: "Calm, Measured" },
                            { id: "verse",   desc: "Expressive, Dynamic" },
                            { id: "marine",  desc: "Smooth, Polite" },
                          ] as const
                        ).map(({ id, desc }) => (
                          <SelectItem key={id} value={id}>
                            <span className="flex items-center justify-between gap-3 w-full">
                              <span className="capitalize font-medium">{id.charAt(0).toUpperCase() + id.slice(1)}</span>
                              <span className="text-muted-foreground text-[10px]">{desc}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Realtime LLM Model */}
                  <div>
                    <Label className="text-[9px] flex items-center gap-1">
                      LLM Model
                      <span
                        className="text-[8px] uppercase tracking-wide px-1 py-0.5 rounded bg-muted text-muted-foreground"
                        title="Estimated OpenAI audio token cost at typical ~800 tok/min talk ratio. Actual cost varies by call length."
                      >
                        est. cost
                      </span>
                    </Label>
                    <Select
                      value={settings.openaiRealtimeModel ?? "gpt-4o-realtime-preview"}
                      onValueChange={(v) => setSettings({ openaiRealtimeModel: v })}
                    >
                      <SelectTrigger className="h-7 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {HYPERSTREAM_MODELS.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            <span className="flex items-center justify-between gap-3 w-full">
                              <span className="flex flex-col gap-0.5">
                                <span className="flex items-center gap-1.5 font-medium text-[10px]">
                                  {m.label}
                                  {m.recommended && (
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">
                                      Recommended
                                    </span>
                                  )}
                                </span>
                                <span className="text-muted-foreground text-[9px] leading-tight">{m.desc}</span>
                              </span>
                              <span className="text-muted-foreground text-[10px] shrink-0">
                                ${m.costPerMin.toFixed(3)}/min
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Model Reasoning Optimization Profile */}
                  <div>
                    <Label className="text-[9px]">Model Reasoning Optimization Profile</Label>
                    <Select
                      value={settings.openaiReasoningEffort ?? "low"}
                      onValueChange={(v) => setSettings({ openaiReasoningEffort: v as BuilderSettings["openaiReasoningEffort"] })}
                    >
                      <SelectTrigger className="h-7 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(
                          [
                            { id: "minimal", label: "Minimal",  desc: "Lowest Latency — Ideal for basic smart triggers" },
                            { id: "low",     label: "Low",      desc: "Optimized Balanced — Recommended for fast receptionists" },
                            { id: "medium",  label: "Medium",   desc: "Multi-Step Logic — Best for advanced CRM lookups" },
                            { id: "high",    label: "High",     desc: "Deep Analytical — Higher accuracy, slightly slower start" },
                            { id: "xhigh",   label: "X-High",   desc: "Maximum Reasoning — Complex multi-branch tool handling" },
                          ] as const
                        ).map(({ id, label, desc }) => (
                          <SelectItem key={id} value={id}>
                            <span className="flex flex-col gap-0.5">
                              <span className="font-medium text-[10px]">{label}</span>
                              <span className="text-muted-foreground text-[9px] leading-tight">{desc}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[9px] text-muted-foreground/50 mt-1">Default: Low (Optimized Balanced)</p>
                  </div>

                  <div className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 w-fit">
                    <Lock className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                    <span className="text-[9px] text-muted-foreground">Engine Routed via Master Admin Enterprise Line</span>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            <Collapsible data-tour="global-prompt" className="rounded-lg border border-white/[0.06] bg-white/[0.01]" defaultOpen>
              <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                <span className="flex items-center gap-1.5"><MsgSq className="h-3 w-3" />Global Prompt</span>
                <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 px-2.5 pb-2.5">
                {isRetell && (
                <div>
                  <Label className="text-[9px] flex items-center gap-1">
                    Model
                    <span className="text-[8px] uppercase tracking-wide px-1 py-0.5 rounded bg-muted text-muted-foreground" title="Internal cost (Retell rate + $0.15/min margin). Not shown to customers.">
                      builder cost
                    </span>
                  </Label>
                  <Select value={settings.model} onValueChange={(v) => setSettings({ model: v })}>
                    <SelectTrigger className="h-6 text-[10px]">
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
                                {m.recommended && <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">Recommended</span>}
                              </span>
                              <span className="text-muted-foreground text-[11px]">${m.costPerMin.toFixed(3)}/min</span>
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
                                {m.recommended && <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">Recommended</span>}
                                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">Fast</span>
                              </span>
                              <span className="text-muted-foreground text-[11px]">${m.costPerMin.toFixed(3)}/min</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                )}
                <SliderField label="Temperature" value={settings.temperature ?? 1} min={0} max={2} step={0.1} onChange={(v) => setSettings({ temperature: v })} />
                <Textarea rows={4} value={settings.globalPrompt} onChange={(e) => setSettings({ globalPrompt: e.target.value })} placeholder="Enter your global prompt here" className="text-[10px] leading-relaxed" />
              </CollapsibleContent>
            </Collapsible>

            <KnowledgeBaseSection isRetell={isRetell} isHyperStream={isOpenAI} />

            <Collapsible className="rounded-lg border border-white/[0.06] bg-white/[0.01]">
              <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                <span className="flex items-center gap-1.5"><ArrowLeftRight className="h-3 w-3" />Transition</span>
                <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-2.5 pb-2.5">
                <Select value={settings.transitionFlexibility ?? "flex"} onValueChange={(v) => setSettings({ transitionFlexibility: v as "flex" | "strict" })}>
                  <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flex">Flex Mode</SelectItem>
                    <SelectItem value="strict">Strict Mode</SelectItem>
                  </SelectContent>
                </Select>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible className="rounded-lg border border-white/[0.06] bg-white/[0.01]">
              <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                <span className="flex items-center gap-1.5"><Settings2 className="h-3 w-3" />Agent</span>
                <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 px-2.5 pb-2.5">
                {isRetell && (
                  <div>
                    <Label className="text-[9px]">Webhook URL</Label>
                    <Input value={settings.webhookUrl ?? ""} onChange={(e) => setSettings({ webhookUrl: e.target.value })} className="h-6 text-[10px]" placeholder="https://…" />
                  </div>
                )}
                <div>
                  <Label className="text-[9px]">Start speaker</Label>
                  <Select value={settings.startSpeaker ?? "agent"} onValueChange={(v) => setSettings({ startSpeaker: v as "agent" | "user" })}>
                    <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agent">Agent</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <PostCallDataSection />

            <BookingConfigSection />

            {/* Agent type selector — controls which sections appear below */}
            <Collapsible data-tour="agent-type-select" className="rounded-lg border border-white/[0.06] bg-white/[0.01]" defaultOpen>
              <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                <span className="flex items-center gap-1.5"><Globe className="h-3 w-3" />Agent Type</span>
                <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 px-2.5 pb-2.5">
                <Select
                  value={settings.agentType ?? "receptionist"}
                  onValueChange={(v) => setSettings({ agentType: v as BuilderSettings["agentType"] })}
                >
                  <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="receptionist">Receptionist</SelectItem>
                    <SelectItem value="lead_generation">Lead Generation</SelectItem>
                    <SelectItem value="client_qualification">Client Qualification</SelectItem>
                  </SelectContent>
                </Select>
                {settings.agentType === "lead_generation" && (
                  <p className="text-[10px] text-violet-500 dark:text-violet-400">Lead Gen sections active ↓</p>
                )}
                {settings.agentType === "client_qualification" && (
                  <p className="text-[10px] text-blue-500 dark:text-blue-400">Client Qualification sections active ↓</p>
                )}
              </CollapsibleContent>
            </Collapsible>

            {settings.agentType === "lead_generation" && <LeadGenSection />}
            {settings.agentType === "client_qualification" && <ClientQualificationSection />}

            <Collapsible className="rounded-lg border border-white/[0.06] bg-white/[0.01]">
              <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                <span>Agent Handbook</span>
                <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 px-2.5 pb-2.5">
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
                    <Label className="text-[9px]">{label}</Label>
                    <Switch
                      checked={Boolean(settings[key])}
                      onCheckedChange={(v) => setSettings({ [key]: v })}
                    />
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>

            <Collapsible className="rounded-lg border border-white/[0.06] bg-white/[0.01]">
              <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                <span>Speech Settings</span>
                <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 px-2.5 pb-2.5">
                <SliderField
                  label="Voice Speed"
                  value={settings.voiceSpeed ?? 1}
                  min={0.5}
                  max={2}
                  step={0.1}
                  onChange={(v) => setNumericSetting("voiceSpeed", String(v), 1)}
                />
                <SliderField
                  label="Voice Temp"
                  value={settings.voiceTemperature ?? 1}
                  min={0}
                  max={2}
                  step={0.1}
                  onChange={(v) => setNumericSetting("voiceTemperature", String(v), 1)}
                />
                <SliderField
                  label="Volume"
                  value={settings.volume ?? 1}
                  min={0}
                  max={2}
                  step={0.1}
                  onChange={(v) => setNumericSetting("volume", String(v), 1)}
                />
                <SliderField
                  label="Responsiveness"
                  value={settings.responsiveness ?? 1}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => setNumericSetting("responsiveness", String(v), 1)}
                />
                <SliderField
                  label="Interruption"
                  value={settings.interruptionSensitivity ?? 0.7}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => setNumericSetting("interruptionSensitivity", String(v), 0.7)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[9px]">Emotion</Label>
                    <Select
                      value={settings.voiceEmotion ?? "none"}
                      onValueChange={(v) =>
                        setSettings({ voiceEmotion: v as BuilderSettings["voiceEmotion"] })
                      }
                    >
                      <SelectTrigger className="h-6 text-[10px]">
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
                    <Label className="text-[9px]">STT mode</Label>
                    <Select
                      value={settings.sttMode ?? "fast"}
                      onValueChange={(v) =>
                        setSettings({ sttMode: v as BuilderSettings["sttMode"] })
                      }
                    >
                      <SelectTrigger className="h-6 text-[10px]">
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
                    <Label className="text-[9px]">Vocabulary</Label>
                    <Select
                      value={settings.vocabSpecialization ?? "general"}
                      onValueChange={(v) =>
                        setSettings({
                          vocabSpecialization: v as BuilderSettings["vocabSpecialization"],
                        })
                      }
                    >
                      <SelectTrigger className="h-6 text-[10px]">
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
                  <Label className="text-[9px]">Boosted keywords</Label>
                  <Input
                    value={(settings.boostedKeywords ?? []).join(", ")}
                    onChange={(e) => setCsvSetting("boostedKeywords", e.target.value)}
                    placeholder="names, brands, specialist words"
                    className="h-6 text-[10px]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[9px]">Reminder (ms)</Label>
                    <Input
                      type="number"
                      step="1000"
                      min={0}
                      value={settings.reminderTriggerMs ?? 10000}
                      onChange={(e) =>
                        setNumericSetting("reminderTriggerMs", e.target.value, 10000)
                      }
                      className="h-6 text-[10px]"
                    />
                  </div>
                  <div>
                    <Label className="text-[9px]">Reminder count</Label>
                    <Input
                      type="number"
                      step="1"
                      min={0}
                      value={settings.reminderMaxCount ?? 1}
                      onChange={(e) => setNumericSetting("reminderMaxCount", e.target.value, 1)}
                      className="h-6 text-[10px]"
                    />
                  </div>
                  <div>
                    <Label className="text-[9px]">Silence end (ms)</Label>
                    <Input
                      type="number"
                      step="1000"
                      min={10000}
                      value={settings.endCallAfterSilenceMs ?? 600000}
                      onChange={(e) =>
                        setNumericSetting("endCallAfterSilenceMs", e.target.value, 600000)
                      }
                      className="h-6 text-[10px]"
                    />
                  </div>
                  <div>
                    <Label className="text-[9px]">Begin delay (ms)</Label>
                    <Input
                      type="number"
                      step="100"
                      min={0}
                      max={5000}
                      value={settings.beginMessageDelayMs ?? 0}
                      onChange={(e) => setNumericSetting("beginMessageDelayMs", e.target.value, 0)}
                      className="h-6 text-[10px]"
                    />
                  </div>
                  <div>
                    <Label className="text-[9px]">Max call (ms)</Label>
                    <Input
                      type="number"
                      step="1000"
                      min={60000}
                      value={settings.maxCallDurationMs ?? 1800000}
                      onChange={(e) =>
                        setNumericSetting("maxCallDurationMs", e.target.value, 1800000)
                      }
                      className="h-6 text-[10px]"
                    />
                  </div>
                  <div>
                    <Label className="text-[9px]">Ring (ms)</Label>
                    <Input
                      type="number"
                      step="1000"
                      min={5000}
                      value={settings.ringDurationMs ?? 30000}
                      onChange={(e) => setNumericSetting("ringDurationMs", e.target.value, 30000)}
                      className="h-6 text-[10px]"
                    />
                  </div>
                </div>
                {isRetell && (
                  <div>
                    <Label className="text-[9px]">Ambient sound</Label>
                    <Select
                      value={settings.ambientSound ?? "none"}
                      onValueChange={(v) =>
                        setSettings({ ambientSound: v as BuilderSettings["ambientSound"] })
                      }
                    >
                      <SelectTrigger className="h-6 text-[10px]">
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
                )}
                <div className="grid grid-cols-2 gap-2">
                  {isRetell && (
                  <div>
                    <Label className="text-[9px]">Ambient volume</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min={0}
                      max={2}
                      value={settings.ambientSoundVolume ?? 1}
                      onChange={(e) => setNumericSetting("ambientSoundVolume", e.target.value, 1)}
                      className="h-6 text-[10px]"
                    />
                  </div>
                  )}
                  <div>
                    <Label className="text-[9px]">Denoising</Label>
                    <Select
                      value={settings.denoisingMode ?? "noise-and-background-speech-cancellation"}
                      onValueChange={(v) =>
                        setSettings({ denoisingMode: v as BuilderSettings["denoisingMode"] })
                      }
                    >
                      <SelectTrigger className="h-6 text-[10px]">
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
                  <Label className="text-[9px]">Dynamic voice speed</Label>
                  <Switch
                    checked={Boolean(settings.enableDynamicVoiceSpeed)}
                    onCheckedChange={(v) => setSettings({ enableDynamicVoiceSpeed: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-[9px]">Dynamic responsiveness</Label>
                  <Switch
                    checked={Boolean(settings.enableDynamicResponsiveness)}
                    onCheckedChange={(v) => setSettings({ enableDynamicResponsiveness: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-[9px]">Normalize for speech</Label>
                  <Switch
                    checked={settings.normalizeForSpeech ?? true}
                    onCheckedChange={(v) => setSettings({ normalizeForSpeech: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-[9px]">Backchannel</Label>
                  <Switch
                    checked={Boolean(settings.enableBackchannel)}
                    onCheckedChange={(v) => setSettings({ enableBackchannel: v })}
                  />
                </div>
                {settings.enableBackchannel && (
                  <div className="space-y-2 rounded-md bg-muted/50 p-2">
                    <div>
                      <Label className="text-[9px]">Backchannel frequency</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min={0}
                        max={1}
                        value={settings.backchannelFrequency ?? 0.8}
                        onChange={(e) =>
                          setNumericSetting("backchannelFrequency", e.target.value, 0.8)
                        }
                        className="h-6 text-[10px]"
                      />
                    </div>
                    <div>
                      <Label className="text-[9px]">Backchannel words</Label>
                      <Input
                        value={(settings.backchannelWords ?? []).join(", ")}
                        onChange={(e) => setCsvSetting("backchannelWords", e.target.value)}
                        placeholder="yeah, uh-huh, okay"
                        className="h-6 text-[10px]"
                      />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label className="text-[9px]">Allow user DTMF</Label>
                  <Switch
                    checked={Boolean(settings.allowUserDtmf)}
                    onCheckedChange={(v) => setSettings({ allowUserDtmf: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-[9px]">DTMF can interrupt</Label>
                  <Switch
                    checked={Boolean(settings.allowDtmfInterruption)}
                    onCheckedChange={(v) => setSettings({ allowDtmfInterruption: v })}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[9px]">Pronunciation dictionary</Label>
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
                          <SelectTrigger className="h-6 text-[10px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ipa">IPA</SelectItem>
                            <SelectItem value="cmu">CMU</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          className="h-6 text-[10px]"
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
            </>
            )}
          </aside>
        )}

        {/* Platform Guide Drawer — 4th flex column, pushes canvas on open */}
        <PlatformGuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} />
      </div>

      <NodeEditorDialog />
    </div>
  );
}
