import { useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { toPng } from "html-to-image";
import { useBuilderStore } from "@/lib/builder/store";
import { resolveDeploymentMode, isRetellMode, isOpenAINativeMode, isElevenLabsNativeMode } from "@/lib/runtime/adapter";
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
import { ChevronDown, MoreHorizontal, FileJson, Upload, FileUp, Search, Check, ArrowLeftRight, Globe, Mic, MessageSquare as MsgSq, Settings2, Zap, Radio, Lock, Sparkles, Gem, Volume2, Play, Loader2, Download } from "lucide-react";
import { KnowledgeBaseSection } from "@/components/builder/KnowledgeBaseSection";
import { SpeechSettingsSection } from "@/components/builder/SpeechSettingsSection";
import { HyperStreamSettingsSection } from "@/components/builder/HyperStreamSettingsSection";
import { TranscriptionSettingsSection } from "@/components/builder/TranscriptionSettingsSection";
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
import { PostCallAnalysis } from "./PostCallAnalysis";
import { BookingConfigSection } from "./BookingConfigSection";
import { LeadGenSection } from "./LeadGenSection";
import { ClientQualificationSection } from "./ClientQualificationSection";
import type { BuilderSettings, NodeKind } from "@/lib/builder/types";
import { cn } from "@/lib/utils";
import { MODELS, HYPERSTREAM_MODELS } from "@/lib/builder/pricing";
import { searchElevenLabsVoices, previewElevenLabsVoice, previewRetellVoice } from "@/lib/builder/retell.functions";
import { listElevenLabsVoices, cloneElevenLabsVoice } from "@/lib/builder/elevenlabs-voices.functions";
import { extractPostCallVariables, type PostCallExtracted } from "@/lib/builder/post-call-extract.functions";
import { saveHyperStreamTestCall } from "@/lib/builder/save-hyperstream-call.functions";
import { useServerFn } from "@tanstack/react-start";
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
  const isElevenLabs = isElevenLabsNativeMode(activeMode);
  const preAutoLayoutPositions = useBuilderStore((s) => s.preAutoLayoutPositions);
  const [rf, setRf] = useState<ReturnType<typeof useReactFlow> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"node" | "components">("node");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [callActive, setCallActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<TxEntry[]>([]);
  const [postCallData, setPostCallData] = useState<PostCallExtracted | null>(null);
  const [postCallLoading, setPostCallLoading] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const recordingUrlRef = useRef<string | null>(null);
  const callStartedAtRef = useRef<number | null>(null);
  const saveHyperStreamTestCallFn = useServerFn(saveHyperStreamTestCall);
  const transcriptPanelRef = useRef<HTMLDivElement | null>(null);
  const [elVoiceQuery, setElVoiceQuery] = useState("");
  const [elVoiceResults, setElVoiceResults] = useState<Array<{ voice_id: string; name: string; description: string | null; labels: Record<string, string>; preview_url: string | null; public_owner_id?: string | null }>>([]);
  const [elVoiceSearching, setElVoiceSearching] = useState(false);
  const [elPlayingId, setElPlayingId] = useState<string | null>(null);
  const [elTtsLoadingId, setElTtsLoadingId] = useState<string | null>(null);
  const [elPreviewText, setElPreviewText] = useState("Hi there! How can I help you today?");
  const elAudioRef = useRef<HTMLAudioElement | null>(null);
  const elTtsCacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const cache = elTtsCacheRef.current;
    return () => {
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);

  const [retPreviewText, setRetPreviewText] = useState("Hi there! How can I help you today?");
  const [retPlaying, setRetPlaying] = useState(false);
  const [retTtsLoading, setRetTtsLoading] = useState(false);
  const [elHsVoicesList, setElHsVoicesList] = useState<{ voice_id: string; name: string; category: string }[]>([]);
  const [elHsVoicesLoading, setElHsVoicesLoading] = useState(false);
  const [elHsVoicesError, setElHsVoicesError] = useState<string | null>(null);
  const [elHsUploading, setElHsUploading] = useState(false);
  const elHsFileInputRef = useRef<HTMLInputElement | null>(null);
  const hsVoiceProvider = settings.voiceOutputProvider ?? "openai";

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleElHsVoiceUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setElHsUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const name = file.name.replace(/\.[^.]+$/, "");
      const result = await cloneElevenLabsVoice({
        data: { name, fileName: file.name, mimeType: file.type || "audio/mpeg", base64 },
      });
      setElHsVoicesList((prev) => [
        ...prev,
        { voice_id: result.voice_id, name: result.name, category: "cloned" },
      ]);
      setSettings({ voiceOutputId: result.voice_id, voiceOutputName: result.name });
      toast.success(`Voice "${result.name}" cloned`, {
        description: "Voice ready — selected automatically.",
      });
    } catch (err) {
      toast.error("Voice upload failed", { description: (err as Error).message });
    } finally {
      setElHsUploading(false);
    }
  }
  useEffect(() => {
    if (hsVoiceProvider !== "elevenlabs" || elHsVoicesList.length > 0) return;
    setElHsVoicesLoading(true);
    listElevenLabsVoices()
      .then((voices) => setElHsVoicesList(voices))
      .catch((e: Error) => setElHsVoicesError(e.message))
      .finally(() => setElHsVoicesLoading(false));
  }, [hsVoiceProvider]);
  const retAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (isElevenLabs && elVoiceResults.length === 0 && !elVoiceSearching) {
      setElVoiceSearching(true);
      searchElevenLabsVoices({ data: { query: "" } })
        .then((r) => setElVoiceResults(r.voices))
        .catch(() => {})
        .finally(() => setElVoiceSearching(false));
    }
  }, [isElevenLabs]);

  // Revoke the recording blob URL when it changes or on unmount.
  useEffect(() => {
    return () => {
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    };
  }, []);

  // Force the right panel open when a call starts; clear stale post-call data when a new call begins.
  useEffect(() => {
    if (callActive) {
      callStartedAtRef.current = Date.now();
      setRightOpen(true);
      setPostCallData(null);
      setPostCallLoading(false);
      if (recordingUrlRef.current) {
        URL.revokeObjectURL(recordingUrlRef.current);
        recordingUrlRef.current = null;
        setRecordingUrl(null);
      }
    } else {
      callStartedAtRef.current = null;
    }
  }, [callActive]);

  async function handleCallEnd(transcript: TxEntry[], blob: Blob | null) {
    // Compute call duration from start timestamp recorded when callActive became true.
    const callDuration = callStartedAtRef.current
      ? Math.max(0, Math.round((Date.now() - callStartedAtRef.current) / 1000))
      : 0;
    callStartedAtRef.current = null;

    // Store recording blob URL immediately for local playback.
    let localBlobUrl: string | null = null;
    if (blob) {
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
      localBlobUrl = URL.createObjectURL(blob);
      recordingUrlRef.current = localBlobUrl;
      setRecordingUrl(localBlobUrl);
    }

    // Save call to DB with recording upload in the background.
    const transcriptText = transcript
      .map((t) => `${t.role === "agent" ? "Agent" : "User"}: ${t.text}`)
      .join("\n");

    if (transcript.length > 0 || blob) {
      (async () => {
        try {
          let recordingBase64: string | null = null;
          let recordingMimeType = "audio/webm";
          if (blob && blob.size > 0) {
            recordingMimeType = blob.type || "audio/webm";
            const ab = await blob.arrayBuffer();
            const bytes = new Uint8Array(ab);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            recordingBase64 = btoa(binary);
          }
          const saved = await saveHyperStreamTestCallFn({
            data: {
              agentId: currentAgentRowId ?? null,
              agentName: settings.agentName ?? null,
              durationSeconds: callDuration,
              transcript: transcriptText || null,
              recordingBase64,
              recordingMimeType,
            },
          });
          // Replace blob URL with durable server URL if upload succeeded.
          if (saved.recordingUrl) {
            recordingUrlRef.current = saved.recordingUrl;
            setRecordingUrl(saved.recordingUrl);
            if (localBlobUrl) URL.revokeObjectURL(localBlobUrl);
          }
        } catch (e) {
          console.warn("[builder] saveHyperStreamTestCall failed:", e);
        }
      })();
    }

    // Run post-call extraction if there's anything to analyse.
    if (transcript.length === 0) return;
    setPostCallLoading(true);
    try {
      const result = await extractPostCallVariables({
        data: {
          transcript: transcript.map((t) => ({ role: t.role, text: t.text })),
          variables: settings.variables ?? [],
          agentName: settings.agentName ?? "Agent",
        },
      });
      setPostCallData(result);
    } catch (err) {
      toast.error("Post-call analysis failed", { description: (err as Error).message });
    } finally {
      setPostCallLoading(false);
    }
  }

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
              onCallEnd={handleCallEnd}
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
        {(rightOpen || callActive || liveTranscript.length > 0 || postCallData || postCallLoading) && (
          <aside data-tour="right-panel" className="w-[320px] min-w-[300px] max-w-[360px] shrink-0 border-l border-white/[0.04] bg-background/40 overflow-y-auto px-2.5 py-2 space-y-1.5 hidden md:block text-[11px] [&_label]:text-[10px] [&_label]:uppercase [&_label]:tracking-wider [&_label]:text-muted-foreground [&_textarea]:text-[11px] [&_button[role=combobox]]:h-7 [&_button[role=combobox]]:text-[11px] [&_input]:text-[11px] [&_select]:text-[11px]">

            {/* ── Live transcript view (replaces settings during/after a call) ── */}
            {(callActive || liveTranscript.length > 0 || postCallData || postCallLoading) ? (
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
                  {liveTranscript.length === 0 && !postCallData && !postCallLoading ? (
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

                {/* ── Post-call analysis section ── */}
                {!callActive && (postCallData || postCallLoading || recordingUrl) && (
                  <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2.5 shrink-0">
                    {/* Recording player */}
                    {recordingUrl && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recording</p>
                        <audio
                          controls
                          src={recordingUrl}
                          className="w-full h-8"
                          style={{ colorScheme: "dark" }}
                        />
                        <a
                          href={recordingUrl}
                          download="call-recording.webm"
                          className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-violet-300 transition-colors"
                        >
                          <Download className="h-3 w-3 shrink-0" />
                          Download recording
                        </a>
                      </div>
                    )}
                    {/* Extraction loading */}
                    {postCallLoading && (
                      <p className="text-[11px] text-muted-foreground animate-pulse">
                        Analysing call…
                      </p>
                    )}
                    {/* Extraction results */}
                    {postCallData && (
                      <PostCallAnalysis data={postCallData} />
                    )}
                  </div>
                )}
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
                    { mode: "RETELL"            as DeploymentMode, label: "OmniVoice",   sub: "Premium Catalog",  icon: Radio,    available: true  },
                    { mode: "OPENAI_NATIVE"     as DeploymentMode, label: "HyperStream", sub: "OpenAI Realtime",  icon: Zap,      available: true  },
                    { mode: "ELEVENLABS_NATIVE" as DeploymentMode, label: "VoxStream",   sub: "Coming Soon",      icon: Mic,      available: false },
                    { mode: "CLAUDE_NATIVE"     as DeploymentMode, label: "Claude",      sub: "Coming Soon",      icon: Sparkles, available: false },
                    { mode: "GEMINI_NATIVE"     as DeploymentMode, label: "Gemini",      sub: "Coming Soon",      icon: Gem,      available: false },
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
              {isElevenLabs && (
                <div className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 w-fit">
                  <Lock className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                  <span className="text-[9px] text-muted-foreground">Routed via ElevenLabs Conversational AI</span>
                </div>
              )}

              {/* Voice Output — shown inline below cards when HyperStream is active */}
              {isOpenAI && (
                <div className="pt-1 space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Voice Output</p>
                  <div className="flex gap-1.5">
                    {(["openai", "elevenlabs"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={cn(
                          "flex-1 text-[10px] py-1 rounded-md border font-medium transition-all duration-150",
                          hsVoiceProvider === p
                            ? "border-primary/60 bg-primary/10 text-primary ring-1 ring-primary/30"
                            : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:border-white/[0.16] hover:bg-white/[0.04] hover:text-foreground",
                        )}
                        onClick={() => setSettings({ voiceOutputProvider: p })}
                      >
                        {p === "openai" ? "OpenAI Built-in" : "ElevenLabs TTS"}
                      </button>
                    ))}
                  </div>

                  {hsVoiceProvider === "openai" && (
                    <Select
                      value={settings.openaiVoice ?? "alloy"}
                      onValueChange={(v) => setSettings({ openaiVoice: v as BuilderSettings["openaiVoice"] })}
                    >
                      <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
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
                  )}

                  {hsVoiceProvider === "elevenlabs" && (
                    <div className="space-y-1.5">
                      {elHsVoicesLoading ? (
                        <div className="flex items-center gap-1.5 py-1.5 text-[9px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />Loading ElevenLabs voices…
                        </div>
                      ) : elHsVoicesError ? (
                        <p className="text-[9px] text-destructive/80 leading-snug bg-destructive/5 border border-destructive/20 rounded px-2 py-1.5">{elHsVoicesError}</p>
                      ) : elHsVoicesList.length > 0 ? (
                        <Select
                          value={settings.voiceOutputId ?? ""}
                          onValueChange={(v) => {
                            const voice = elHsVoicesList.find((x) => x.voice_id === v);
                            setSettings({ voiceOutputId: v, voiceOutputName: voice?.name });
                          }}
                        >
                          <SelectTrigger className="h-7 text-[10px]">
                            <SelectValue placeholder="Select ElevenLabs voice…" />
                          </SelectTrigger>
                          <SelectContent>
                            {elHsVoicesList.map((v) => (
                              <SelectItem key={v.voice_id} value={v.voice_id}>
                                <span className="flex items-center justify-between gap-3 w-full">
                                  <span className="font-medium">{v.name}</span>
                                  <span className="text-muted-foreground text-[10px] capitalize">{v.category}</span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}

                      {/* Upload voice sample — available even when list API is restricted */}
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-px bg-white/[0.06]" />
                        <span className="text-[9px] text-muted-foreground/60 shrink-0">or upload</span>
                        <div className="flex-1 h-px bg-white/[0.06]" />
                      </div>
                      <button
                        type="button"
                        disabled={elHsUploading}
                        onClick={() => elHsFileInputRef.current?.click()}
                        className="w-full h-7 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-white/[0.12] bg-white/[0.01] text-[10px] text-muted-foreground hover:border-white/[0.22] hover:bg-white/[0.03] hover:text-foreground transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        {elHsUploading ? (
                          <><Loader2 className="h-3 w-3 animate-spin" />Cloning voice…</>
                        ) : (
                          <><Upload className="h-3 w-3" />Upload voice sample</>
                        )}
                      </button>
                      <input
                        ref={elHsFileInputRef}
                        type="file"
                        accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.webm"
                        className="hidden"
                        onChange={handleElHsVoiceUpload}
                      />
                      <p className="text-[8.5px] text-muted-foreground/50 leading-snug">
                        MP3, WAV, M4A, OGG — min 1 min of clear speech recommended
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Collapsible data-tour="voice-section" className="rounded-lg border border-white/[0.06] bg-white/[0.01]">
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
                    {settings.voiceId && (
                      <div className="space-y-1">
                        <Label className="text-[9px] text-muted-foreground">Preview text</Label>
                        <div className="flex gap-1">
                          <Input
                            value={retPreviewText}
                            onChange={(e) => setRetPreviewText(e.target.value)}
                            placeholder="Hi there! How can I help you today?"
                            className="h-6 text-[9px] flex-1"
                          />
                          <button
                            className="shrink-0 flex items-center justify-center h-6 w-6 rounded border border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors disabled:opacity-40"
                            title={retPlaying ? "Stop preview" : "Play preview"}
                            disabled={retTtsLoading}
                            onClick={async () => {
                              if (retPlaying) {
                                retAudioRef.current?.pause();
                                retAudioRef.current = null;
                                setRetPlaying(false);
                                return;
                              }
                              if (retAudioRef.current) { retAudioRef.current.pause(); retAudioRef.current = null; }
                              setRetTtsLoading(true);
                              try {
                                const result = await previewRetellVoice({
                                  data: { voiceId: settings.voiceId!, text: retPreviewText.trim() || "Hi there! How can I help you today?" },
                                });
                                if (result.audio) {
                                  const bytes = Uint8Array.from(atob(result.audio), (c) => c.charCodeAt(0));
                                  const blob = new Blob([bytes], { type: "audio/mpeg" });
                                  const url = URL.createObjectURL(blob);
                                  const audio = new Audio(url);
                                  retAudioRef.current = audio;
                                  setRetPlaying(true);
                                  audio.play().catch(() => {});
                                  audio.onended = () => { URL.revokeObjectURL(url); retAudioRef.current = null; setRetPlaying(false); };
                                } else {
                                  toast.error("Preview unavailable", { description: result.missingKey ? "No Retell API key configured." : "TTS returned no audio." });
                                }
                              } catch {
                                toast.error("Preview failed");
                              } finally {
                                setRetTtsLoading(false);
                              }
                            }}
                          >
                            {retTtsLoading
                              ? <span className="h-2.5 w-2.5 block rounded-full border border-current border-t-transparent animate-spin" />
                              : retPlaying
                                ? <Square className="h-2.5 w-2.5 fill-current" />
                                : <Play className="h-2.5 w-2.5" />}
                          </button>
                        </div>
                      </div>
                    )}
                    <CustomVoiceUploadDialog onUploaded={(voiceId) => setSettings({ voiceId })} />
                  </>
                )}
              </CollapsibleContent>
            </Collapsible>

            {isOpenAI && (
              <Collapsible className="rounded-lg border border-primary/20 bg-primary/[0.03]">
                <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                  <span className="flex items-center gap-1.5"><Zap className="h-3 w-3 text-primary" />OpenAI Engine</span>
                  <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2.5 px-2.5 pb-2.5">
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

            <Collapsible data-tour="global-prompt" className="rounded-lg border border-white/[0.06] bg-white/[0.01]">
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

            {isElevenLabs && (
              <Collapsible className="rounded-lg border border-primary/20 bg-primary/[0.03]">
                <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                  <span className="flex items-center gap-1.5"><Mic className="h-3 w-3 text-primary" />VoxStream Engine</span>
                  <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2.5 px-2.5 pb-2.5">
                  <div className="space-y-1.5">
                    <Label className="text-[9px]">Voice</Label>
                    {settings.elevenLabsVoiceId && (
                      <div className="flex items-center gap-1.5 rounded border border-primary/20 bg-primary/[0.04] px-2 py-1">
                        <Mic className="h-2.5 w-2.5 text-primary shrink-0" />
                        <div className="flex flex-col min-w-0 flex-1">
                          {settings.elevenLabsVoiceName ? (
                            <>
                              <span className="text-[9px] font-medium text-primary truncate leading-tight">{settings.elevenLabsVoiceName}</span>
                              <span className="text-[8px] font-mono text-muted-foreground truncate leading-tight">{settings.elevenLabsVoiceId}</span>
                            </>
                          ) : (
                            <>
                              <span className="text-[9px] font-mono text-primary truncate leading-tight">{settings.elevenLabsVoiceId}</span>
                              <span className="text-[8px] text-muted-foreground leading-tight">Re-search to load name</span>
                            </>
                          )}
                        </div>
                        <button className="text-[9px] text-muted-foreground hover:text-destructive shrink-0" onClick={() => setSettings({ elevenLabsVoiceId: "", elevenLabsVoiceName: "" })}>×</button>
                      </div>
                    )}
                    <div className="flex gap-1">
                      <Input
                        value={elVoiceQuery}
                        onChange={(e) => setElVoiceQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            setElVoiceSearching(true);
                            searchElevenLabsVoices({ data: { query: elVoiceQuery } })
                              .then((r) => setElVoiceResults(r.voices))
                              .catch(() => toast.error("Voice search failed"))
                              .finally(() => setElVoiceSearching(false));
                          }
                        }}
                        placeholder="Search voices…"
                        className="h-7 text-[10px] flex-1"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[9px] shrink-0"
                        disabled={elVoiceSearching}
                        onClick={() => {
                          setElVoiceSearching(true);
                          searchElevenLabsVoices({ data: { query: elVoiceQuery } })
                            .then((r) => setElVoiceResults(r.voices))
                            .catch(() => toast.error("Voice search failed"))
                            .finally(() => setElVoiceSearching(false));
                        }}
                      >
                        <Search className="h-2.5 w-2.5 mr-1" />
                        {elVoiceSearching ? "…" : "Search"}
                      </Button>
                    </div>
                    {elVoiceResults.length > 0 && (
                      <>
                        <div className="space-y-1">
                          <Label className="text-[9px] text-muted-foreground">Preview text</Label>
                          <Input
                            value={elPreviewText}
                            onChange={(e) => setElPreviewText(e.target.value)}
                            placeholder="Hi there! How can I help you today?"
                            className="h-6 text-[9px]"
                          />
                        </div>
                        <div className="max-h-36 overflow-y-auto rounded border border-white/[0.06] divide-y divide-white/[0.04]">
                          {elVoiceResults.map((v) => (
                            <div
                              key={v.voice_id}
                              className="flex w-full items-start gap-1.5 px-2 py-1.5 hover:bg-white/[0.04] transition-colors"
                            >
                              <button
                                className="flex flex-1 items-start gap-1.5 text-left min-w-0"
                                onClick={() => {
                                  setSettings({ elevenLabsVoiceId: v.voice_id, elevenLabsVoiceName: v.name });
                                  setElVoiceResults([]);
                                  setElVoiceQuery("");
                                  if (elAudioRef.current) { elAudioRef.current.pause(); elAudioRef.current = null; }
                                  setElPlayingId(null);
                                  setElTtsLoadingId(null);
                                }}
                              >
                                <Check className={cn("h-2.5 w-2.5 mt-0.5 shrink-0", settings.elevenLabsVoiceId === v.voice_id ? "text-primary" : "text-transparent")} />
                                <div className="min-w-0">
                                  <p className="text-[9px] font-medium leading-tight truncate">{v.name}</p>
                                  {v.description && <p className="text-[8px] text-muted-foreground leading-tight line-clamp-1">{v.description}</p>}
                                  {Object.keys(v.labels ?? {}).length > 0 && (
                                    <p className="text-[8px] text-muted-foreground/60 leading-tight">
                                      {Object.values(v.labels).slice(0, 3).join(" · ")}
                                    </p>
                                  )}
                                </div>
                              </button>
                              <button
                                className="shrink-0 mt-0.5 text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
                                title={elPlayingId === v.voice_id ? "Stop preview" : "Play preview"}
                                disabled={elTtsLoadingId === v.voice_id}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (elPlayingId === v.voice_id) {
                                    elAudioRef.current?.pause();
                                    elAudioRef.current = null;
                                    setElPlayingId(null);
                                    return;
                                  }
                                  if (elAudioRef.current) { elAudioRef.current.pause(); elAudioRef.current = null; }
                                  setElPlayingId(null);
                                  const ttsText = elPreviewText.trim() || "Hi there! How can I help you today?";
                                  const cacheKey = `${v.voice_id}|${ttsText}`;
                                  const cachedUrl = elTtsCacheRef.current.get(cacheKey);
                                  if (cachedUrl) {
                                    const audio = new Audio(cachedUrl);
                                    elAudioRef.current = audio;
                                    setElPlayingId(v.voice_id);
                                    audio.play().catch(() => {});
                                    audio.onended = () => { elAudioRef.current = null; setElPlayingId(null); };
                                  } else {
                                  setElTtsLoadingId(v.voice_id);
                                  try {
                                    const result = await previewElevenLabsVoice({
                                      data: { voiceId: v.voice_id, text: ttsText },
                                    });
                                    if (result.audio) {
                                      const bytes = Uint8Array.from(atob(result.audio), (c) => c.charCodeAt(0));
                                      const blob = new Blob([bytes], { type: "audio/mpeg" });
                                      const url = URL.createObjectURL(blob);
                                      elTtsCacheRef.current.set(cacheKey, url);
                                      const audio = new Audio(url);
                                      elAudioRef.current = audio;
                                      setElPlayingId(v.voice_id);
                                      audio.play().catch(() => {});
                                      audio.onended = () => { elAudioRef.current = null; setElPlayingId(null); };
                                    } else if (v.preview_url) {
                                      const audio = new Audio(v.preview_url);
                                      elAudioRef.current = audio;
                                      setElPlayingId(v.voice_id);
                                      audio.play().catch(() => {});
                                      audio.onended = () => { elAudioRef.current = null; setElPlayingId(null); };
                                    }
                                  } catch {
                                    if (v.preview_url) {
                                      const audio = new Audio(v.preview_url);
                                      elAudioRef.current = audio;
                                      setElPlayingId(v.voice_id);
                                      audio.play().catch(() => {});
                                      audio.onended = () => { elAudioRef.current = null; setElPlayingId(null); };
                                    } else {
                                      toast.error("Preview unavailable");
                                    }
                                  } finally {
                                    setElTtsLoadingId(null);
                                  }
                                  }
                                }}
                              >
                                {elTtsLoadingId === v.voice_id
                                  ? <span className="h-2.5 w-2.5 block rounded-full border border-current border-t-transparent animate-spin" />
                                  : elPlayingId === v.voice_id
                                    ? <Square className="h-2.5 w-2.5 fill-current" />
                                    : <Play className="h-2.5 w-2.5" />}
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    <p className="text-[8px] text-muted-foreground">
                      Search ElevenLabs shared voices or paste a voice ID directly above.
                    </p>
                  </div>
                  <SliderField label="Temperature" value={settings.temperature ?? 1} min={0} max={2} step={0.1} onChange={(v) => setSettings({ temperature: v })} />
                  <Textarea rows={4} value={settings.globalPrompt} onChange={(e) => setSettings({ globalPrompt: e.target.value })} placeholder="Enter your global prompt here" className="text-[10px] leading-relaxed" />
                </CollapsibleContent>
              </Collapsible>
            )}

            <KnowledgeBaseSection isRetell={isRetell} isHyperStream={isOpenAI || isElevenLabs} />

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
            <Collapsible data-tour="agent-type-select" className="rounded-lg border border-white/[0.06] bg-white/[0.01]">
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

            <SpeechSettingsSection isRetell={isRetell} />
            <TranscriptionSettingsSection isRetell={isRetell} isHyperStream={isOpenAI} />
            {isOpenAI && <HyperStreamSettingsSection />}
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
