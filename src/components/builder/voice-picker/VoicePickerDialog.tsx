/**
 * The agent's voice, in one place: pick a text-to-speech provider, browse the voices it offers
 * (with gender, accent, language and "my voices" filters where the provider's data supports them),
 * hear any voice, clone one where the provider can, and set speed, volume and the other voice
 * settings the provider applies on calls.
 *
 * Changes are a draft until "Use this voice", so browsing another provider never changes the
 * agent by accident.
 */
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AudioLines,
  Check,
  Loader2,
  Mic,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useBuilderStore } from "@/lib/builder/store";
import type { BuilderSettings } from "@/lib/builder/types";
import { listLibraryVoices } from "@/lib/voice/voice-library.functions";
import {
  accentById,
  DEFAULT_PREVIEW_TEXT,
  storedVoiceId,
  VOICE_ACCENTS,
  VOICE_LIBRARY_PROVIDERS,
  VOICE_PROVIDERS,
  voiceSelectionPatch,
  type LibraryVoice,
  type VoiceGender,
  type VoiceLibraryProvider,
  type VoiceSource,
  type VoiceTuningKey,
} from "@/lib/voice/voice-library.shared";
import { VoiceCloneDialog } from "./VoiceCloneDialog";
import { useVoicePreview, type VoicePreviewPlayer } from "./useVoicePreview";

const EMOTIONS = [
  "none",
  "calm",
  "sympathetic",
  "happy",
  "sad",
  "angry",
  "fearful",
  "surprised",
] as const;

interface Tuning {
  voiceSpeed: number;
  volume: number;
  voiceTemperature: number;
  voiceEmotion: string;
  enableDynamicVoiceSpeed: boolean;
  webeeTtsInstructions: string;
}

const TUNING_DEFAULTS: Tuning = {
  voiceSpeed: 1,
  volume: 1,
  voiceTemperature: 1,
  voiceEmotion: "none",
  enableDynamicVoiceSpeed: false,
  webeeTtsInstructions: "",
};

interface Filters {
  search: string;
  gender: VoiceGender | "";
  accent: string;
  language: "en" | "all";
  source: VoiceSource;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  gender: "",
  accent: "",
  language: "en",
  source: "all",
};

type Picked = Pick<LibraryVoice, "id" | "name" | "owned"> & Partial<LibraryVoice>;

function currentProvider(settings: BuilderSettings): VoiceLibraryProvider {
  const p = settings.webeeTtsProvider;
  return p === "cartesia" || p === "openai" ? p : "fish";
}

function initialPicks(settings: BuilderSettings): Partial<Record<VoiceLibraryProvider, Picked>> {
  const s = settings as unknown as Record<string, unknown>;
  const out: Partial<Record<VoiceLibraryProvider, Picked>> = {};
  const fish = storedVoiceId(s, "fish");
  if (fish)
    out.fish = {
      id: fish,
      name: settings.webeeVoiceName || "Selected voice",
      owned: !!settings.webeeVoiceOwned,
    };
  const cartesia = storedVoiceId(s, "cartesia");
  if (cartesia)
    out.cartesia = {
      id: cartesia,
      name: settings.cartesiaVoiceName || "Selected voice",
      owned: false,
    };
  const openai = storedVoiceId(s, "openai") || "alloy";
  out.openai = { id: openai, name: openai.charAt(0).toUpperCase() + openai.slice(1), owned: false };
  return out;
}

function initialTuning(settings: BuilderSettings): Tuning {
  return {
    voiceSpeed: settings.voiceSpeed ?? TUNING_DEFAULTS.voiceSpeed,
    volume: settings.volume ?? TUNING_DEFAULTS.volume,
    voiceTemperature: settings.voiceTemperature ?? TUNING_DEFAULTS.voiceTemperature,
    voiceEmotion: settings.voiceEmotion ?? TUNING_DEFAULTS.voiceEmotion,
    enableDynamicVoiceSpeed:
      settings.enableDynamicVoiceSpeed ?? TUNING_DEFAULTS.enableDynamicVoiceSpeed,
    webeeTtsInstructions: settings.webeeTtsInstructions ?? TUNING_DEFAULTS.webeeTtsInstructions,
  };
}

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

const GENDER_LABEL: Record<VoiceGender, string> = {
  male: "Male",
  female: "Female",
  neutral: "Neutral",
};

function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  return (words[0]![0]! + (words[1]?.[0] ?? "")).toUpperCase();
}

// ── Small pieces ────────────────────────────────────────────────────────────────────────────────

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-7 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PlayButton({
  playing,
  loading,
  onClick,
  label,
  size = "md",
}: {
  playing: boolean;
  loading: boolean;
  onClick: () => void;
  label: string;
  size?: "md" | "lg";
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={playing ? `Stop ${label}` : `Play ${label}`}
      title={playing ? "Stop" : "Play sample"}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        size === "lg" ? "h-10 w-10" : "h-8 w-8",
        playing
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:border-primary hover:text-primary",
      )}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : playing ? (
        <Pause className="h-3.5 w-3.5 fill-current" />
      ) : (
        <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
      )}
    </button>
  );
}

function TuningSlider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs font-medium">{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">{format(value)}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v!)}
      />
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── Voice row ───────────────────────────────────────────────────────────────────────────────────

function VoiceRow({
  voice,
  selected,
  onSelect,
  player,
  playKey,
  onPlay,
}: {
  voice: LibraryVoice;
  selected: boolean;
  onSelect: () => void;
  player: VoicePreviewPlayer;
  playKey: string;
  onPlay: () => void;
}) {
  const accent = accentById(voice.accent);
  const meta = [
    voice.gender ? GENDER_LABEL[voice.gender] : null,
    accent?.label ?? null,
    voice.language && voice.language !== "en" ? voice.language.toUpperCase() : null,
  ].filter(Boolean) as string[];
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary bg-primary/[0.06]"
          : "border-transparent hover:border-border hover:bg-muted/50",
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          selected ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
        )}
        aria-hidden
      >
        {voice.owned ? <Mic className="h-4 w-4" /> : initials(voice.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{voice.name}</span>
          {voice.owned && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              Your clone
            </span>
          )}
        </div>
        {(meta.length > 0 || voice.description) && (
          <p className="truncate text-xs text-muted-foreground">
            {meta.join(" · ")}
            {meta.length > 0 && voice.description ? " — " : ""}
            {voice.description}
          </p>
        )}
      </div>
      {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
      <PlayButton
        label={voice.name}
        playing={player.playingKey === playKey}
        loading={player.loadingKey === playKey}
        onClick={onPlay}
      />
    </div>
  );
}

// ── Dialog ──────────────────────────────────────────────────────────────────────────────────────

export function VoicePickerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useBuilderStore((s) => s.settings);
  const setSettings = useBuilderStore((s) => s.setSettings);
  const fetchVoices = useServerFn(listLibraryVoices);
  const player = useVoicePreview();

  const [provider, setProvider] = useState<VoiceLibraryProvider>(() => currentProvider(settings));
  const [picks, setPicks] = useState(() => initialPicks(settings));
  const [tuning, setTuning] = useState<Tuning>(() => initialTuning(settings));
  const [touched, setTouched] = useState<Set<VoiceTuningKey>>(new Set());
  const [filters, setFilters] = useState<Record<VoiceLibraryProvider, Filters>>({
    fish: EMPTY_FILTERS,
    cartesia: EMPTY_FILTERS,
    openai: EMPTY_FILTERS,
  });
  const [previewText, setPreviewText] = useState(DEFAULT_PREVIEW_TEXT);
  const [cloneOpen, setCloneOpen] = useState(false);

  // Each opening starts from what the agent has saved.
  useEffect(() => {
    if (!open) return;
    setProvider(currentProvider(settings));
    setPicks(initialPicks(settings));
    setTuning(initialTuning(settings));
    setTouched(new Set());
    setFilters({ fish: EMPTY_FILTERS, cartesia: EMPTY_FILTERS, openai: EMPTY_FILTERS });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const stopPreview = player.stop;
  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  const caps = VOICE_PROVIDERS[provider];
  const f = filters[provider];
  const search = useDebounced(f.search.trim(), 350);
  const picked = picks[provider];

  const query = useInfiniteQuery({
    queryKey: ["voice-library", provider, search, f.gender, f.accent, f.language, f.source],
    queryFn: ({ pageParam }) =>
      fetchVoices({
        data: {
          provider,
          search: search || undefined,
          gender: f.gender || undefined,
          accent: f.accent || undefined,
          language: f.language,
          source: f.source,
          page: pageParam,
        },
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: open,
    staleTime: 10 * 60_000,
    retry: 1,
  });

  const voices = useMemo(() => {
    const seen = new Set<string>();
    const out: LibraryVoice[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const v of page.voices) {
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        out.push(v);
      }
    }
    return out;
  }, [query.data]);

  // Fill in the saved voice's details (name, sample) once it shows up in the list.
  useEffect(() => {
    if (!picked) return;
    const match = voices.find((v) => v.id === picked.id);
    if (match && (match.name !== picked.name || match.sampleUrl !== picked.sampleUrl)) {
      setPicks((p) => ({ ...p, [provider]: { ...match } }));
    }
  }, [voices, picked, provider]);

  function setFilter(patch: Partial<Filters>) {
    setFilters((all) => ({ ...all, [provider]: { ...all[provider], ...patch } }));
  }

  function setTune<K extends VoiceTuningKey>(key: K, value: Tuning[K]) {
    setTuning((t) => ({ ...t, [key]: value }));
    setTouched((s) => new Set(s).add(key));
  }

  /** The settings a preview is spoken with: the agent's, with this draft's changes on top. */
  const previewSettings = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const key of caps.tuning) {
      const saved = (settings as unknown as Record<string, unknown>)[key];
      const value = touched.has(key) ? tuning[key] : saved;
      if (value !== undefined && value !== "") out[key] = value;
    }
    return out;
  }, [caps.tuning, settings, touched, tuning]);

  // Each provider's own model field, so a preview sounds like the call will.
  const model =
    provider === "openai" ? settings.webeeTtsModel : provider === "cartesia" ? settings.cartesiaTtsModel : undefined;
  const customLine = previewText.trim() && previewText.trim() !== DEFAULT_PREVIEW_TEXT;

  function playRow(voice: LibraryVoice) {
    void player.toggle(`row:${provider}:${voice.id}`, {
      provider,
      voice,
      text: previewText,
      model,
      settings: previewSettings,
      preferSample: !customLine && touched.size === 0,
    });
  }

  function playPicked() {
    if (!picked) return;
    void player.toggle(`picked:${provider}:${picked.id}`, {
      provider,
      voice: picked,
      text: previewText,
      model,
      settings: previewSettings,
      preferSample: false,
    });
  }

  const savedProvider = currentProvider(settings);
  // An OpenAI agent with no voice stored speaks in "alloy", so that counts as already chosen.
  const savedId =
    storedVoiceId(settings as unknown as Record<string, unknown>, savedProvider) ||
    (savedProvider === "openai" ? "alloy" : "");
  const dirty =
    provider !== savedProvider ||
    (picked?.id ?? "") !== savedId ||
    [...touched].some((k) => caps.tuning.includes(k));

  function save() {
    if (!picked) return;
    const patch: Record<string, unknown> = voiceSelectionPatch(provider, picked);
    for (const key of caps.tuning) if (touched.has(key)) patch[key] = tuning[key];
    setSettings(patch as Partial<BuilderSettings>);
    onOpenChange(false);
  }

  const hasFilters = !!(
    f.search ||
    f.gender ||
    f.accent ||
    f.source !== "all" ||
    f.language !== "en"
  );
  const genders: VoiceGender[] =
    provider === "cartesia" ? ["male", "female", "neutral"] : ["male", "female"];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4 text-left">
            <DialogTitle className="text-base">Agent voice</DialogTitle>
            <DialogDescription className="text-xs">
              Choose a provider, listen to its voices, and set how your agent sounds on calls.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[210px_minmax(0,1fr)_300px] lg:overflow-hidden">
            {/* Providers */}
            <nav
              aria-label="Voice providers"
              className="flex gap-2 overflow-x-auto border-b border-border p-3 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:border-b-0 lg:border-r"
            >
              <p className="hidden px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground lg:block">
                Provider
              </p>
              {VOICE_LIBRARY_PROVIDERS.map((p) => {
                const c = VOICE_PROVIDERS[p];
                const active = p === provider;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      player.stop();
                      setProvider(p);
                    }}
                    aria-current={active}
                    className={cn(
                      "min-w-[170px] rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-w-0",
                      active
                        ? "border-primary bg-primary/[0.06]"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("text-sm font-medium", active && "text-primary")}>
                        {c.label}
                      </span>
                      {p === savedProvider && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          In use
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                      {c.tagline}
                    </span>
                    {c.clone && (
                      <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-primary">
                        <Sparkles className="h-3 w-3" />
                        Voice cloning
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Voices */}
            <section
              aria-label={`${caps.label} voices`}
              className="flex min-h-[420px] min-w-0 flex-col lg:min-h-0"
            >
              <div className="space-y-3 border-b border-border p-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={f.search}
                      onChange={(e) => setFilter({ search: e.target.value })}
                      placeholder={
                        provider === "openai"
                          ? "Search OpenAI voices"
                          : `Search ${caps.label} by name, style or accent`
                      }
                      className="pl-8"
                      aria-label="Search voices"
                    />
                  </div>
                  {caps.clone && (
                    <Button
                      variant="outline"
                      className="shrink-0 gap-1.5"
                      onClick={() => setCloneOpen(true)}
                    >
                      <Plus className="h-4 w-4" />
                      <span className="hidden sm:inline">Clone voice</span>
                    </Button>
                  )}
                </div>

                {(caps.filters.gender ||
                  caps.filters.accent ||
                  caps.filters.language ||
                  caps.filters.source) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {caps.filters.source && (
                      <>
                        <Chip
                          active={f.source === "all"}
                          onClick={() => setFilter({ source: "all" })}
                        >
                          All voices
                        </Chip>
                        <Chip
                          active={f.source === "mine"}
                          onClick={() => setFilter({ source: "mine" })}
                        >
                          My voices
                        </Chip>
                        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                      </>
                    )}
                    {caps.filters.gender &&
                      genders.map((g) => (
                        <Chip
                          key={g}
                          active={f.gender === g}
                          onClick={() => setFilter({ gender: f.gender === g ? "" : g })}
                        >
                          {GENDER_LABEL[g]}
                        </Chip>
                      ))}
                    {caps.filters.accent && (
                      <Select
                        value={f.accent || "any"}
                        onValueChange={(v) => setFilter({ accent: v === "any" ? "" : v })}
                      >
                        <SelectTrigger
                          className="h-7 w-auto gap-1 rounded-full px-3 text-xs"
                          aria-label="Accent"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any accent</SelectItem>
                          {VOICE_ACCENTS.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {caps.filters.language && (
                      <Select
                        value={f.language}
                        onValueChange={(v) => setFilter({ language: v as Filters["language"] })}
                      >
                        <SelectTrigger
                          className="h-7 w-auto gap-1 rounded-full px-3 text-xs"
                          aria-label="Language"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="en">English</SelectItem>
                          <SelectItem value="all">All languages</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    {hasFilters && (
                      <button
                        type="button"
                        onClick={() => setFilters((all) => ({ ...all, [provider]: EMPTY_FILTERS }))}
                        className="inline-flex h-7 items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div
                role="listbox"
                aria-label="Voices"
                className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2"
              >
                {query.isPending ? (
                  Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                        <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
                      </div>
                    </div>
                  ))
                ) : query.isError ? (
                  <div className="m-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                    <p className="font-medium text-destructive">
                      Couldn't load {caps.label} voices
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {(query.error as Error).message}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onClick={() => void query.refetch()}
                    >
                      Try again
                    </Button>
                  </div>
                ) : voices.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                    <AudioLines className="h-8 w-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">No voices match</p>
                    <p className="text-xs text-muted-foreground">
                      {f.source === "mine"
                        ? caps.clone
                          ? "You haven't cloned a voice here yet."
                          : "This provider has no voices of your own."
                        : "Try a different search or clear the filters."}
                    </p>
                  </div>
                ) : (
                  <>
                    {voices.map((v) => (
                      <VoiceRow
                        key={v.id}
                        voice={v}
                        selected={picked?.id === v.id}
                        onSelect={() => setPicks((p) => ({ ...p, [provider]: v }))}
                        player={player}
                        playKey={`row:${provider}:${v.id}`}
                        onPlay={() => playRow(v)}
                      />
                    ))}
                    {query.hasNextPage && (
                      <div className="flex justify-center py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={query.isFetchingNextPage}
                          onClick={() => void query.fetchNextPage()}
                        >
                          {query.isFetchingNextPage && (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          )}
                          Load more voices
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            {/* Settings */}
            <aside
              aria-label="Voice settings"
              className="space-y-5 border-t border-border bg-muted/30 p-4 lg:overflow-y-auto lg:border-l lg:border-t-0"
            >
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Selected voice
                </p>
                {picked ? (
                  <div className="mt-2 flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                    <PlayButton
                      size="lg"
                      label={picked.name}
                      playing={player.playingKey === `picked:${provider}:${picked.id}`}
                      loading={player.loadingKey === `picked:${provider}:${picked.id}`}
                      onClick={playPicked}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{picked.name}</p>
                      <p className="text-xs text-muted-foreground">Hear it with these settings</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                    Pick a voice from the list.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="voice-preview-text" className="text-xs font-medium">
                  Preview line
                </Label>
                <Textarea
                  id="voice-preview-text"
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  rows={2}
                  maxLength={300}
                  className="resize-none bg-background text-sm"
                />
                {customLine && (
                  <button
                    type="button"
                    onClick={() => setPreviewText(DEFAULT_PREVIEW_TEXT)}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Use the default line
                  </button>
                )}
              </div>

              {caps.tuning.length === 0 && caps.tuningNote && (
                <p className="rounded-lg border border-border bg-background p-3 text-xs leading-relaxed text-muted-foreground">
                  {caps.tuningNote}
                </p>
              )}

              {caps.tuning.includes("voiceSpeed") && (
                <TuningSlider
                  label="Speed"
                  value={tuning.voiceSpeed}
                  min={0.5}
                  max={2}
                  step={0.05}
                  format={(v) => `${v.toFixed(2)}×`}
                  onChange={(v) => setTune("voiceSpeed", v)}
                />
              )}
              {caps.tuning.includes("enableDynamicVoiceSpeed") && (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label htmlFor="dynamic-speed" className="text-xs font-medium">
                      Adapt speed to each line
                    </Label>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Short replies a little quicker, long ones a little slower.
                    </p>
                  </div>
                  <Switch
                    id="dynamic-speed"
                    checked={tuning.enableDynamicVoiceSpeed}
                    onCheckedChange={(v) => setTune("enableDynamicVoiceSpeed", v)}
                  />
                </div>
              )}
              {caps.tuning.includes("volume") && (
                <TuningSlider
                  label="Volume"
                  value={tuning.volume}
                  min={0}
                  max={2}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => setTune("volume", v)}
                />
              )}
              {caps.tuning.includes("voiceTemperature") && (
                <TuningSlider
                  label="Expressiveness"
                  hint="Lower is steadier and more consistent; higher varies the delivery more. Clones stay steady either way."
                  value={tuning.voiceTemperature}
                  min={0}
                  max={2}
                  step={0.05}
                  format={(v) => v.toFixed(2)}
                  onChange={(v) => setTune("voiceTemperature", v)}
                />
              )}
              {caps.tuning.includes("voiceEmotion") && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Emotion</Label>
                  <Select
                    value={tuning.voiceEmotion}
                    onValueChange={(v) => setTune("voiceEmotion", v)}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EMOTIONS.map((e) => (
                        <SelectItem key={e} value={e} className="capitalize">
                          {e === "none" ? "Natural" : e}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {caps.tuning.includes("webeeTtsInstructions") && (
                <div className="space-y-1.5">
                  <Label htmlFor="voice-direction" className="text-xs font-medium">
                    Delivery direction
                  </Label>
                  <Textarea
                    id="voice-direction"
                    value={tuning.webeeTtsInstructions}
                    onChange={(e) => setTune("webeeTtsInstructions", e.target.value)}
                    placeholder="Warm, unhurried, British English."
                    rows={2}
                    className="resize-none bg-background text-sm"
                  />
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    How the voice should sound, in plain words. Used by the gpt-4o voices.
                  </p>
                </div>
              )}
            </aside>
          </div>

          <DialogFooter className="flex-row items-center gap-2 border-t border-border px-5 py-3 sm:justify-between">
            <p className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">
              {picked ? (
                <>
                  <span className="font-medium text-foreground">{picked.name}</span> on {caps.label}
                  {!dirty && " · already in use"}
                </>
              ) : (
                "No voice selected"
              )}
            </p>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={!picked || !dirty}>
                Use this voice
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {caps.clone && (
        <VoiceCloneDialog
          provider={provider}
          open={cloneOpen}
          onOpenChange={setCloneOpen}
          onCloned={(v) => {
            const voice: LibraryVoice = { id: v.id, name: v.name, owned: true, tags: [] };
            setPicks((p) => ({ ...p, [provider]: voice }));
            setFilter({ source: "mine" });
            void query.refetch();
          }}
        />
      )}
    </>
  );
}

/** The voice row on the settings rail; opens the picker. */
export function VoiceSummaryButton({ onClick }: { onClick: () => void }) {
  const settings = useBuilderStore((s) => s.settings);
  const provider = currentProvider(settings);
  const s = settings as unknown as Record<string, unknown>;
  const id = storedVoiceId(s, provider);
  const name =
    provider === "fish"
      ? settings.webeeVoiceName
      : provider === "cartesia"
        ? settings.cartesiaVoiceName
        : (id || "alloy").replace(/^./, (c) => c.toUpperCase());
  const speed = settings.voiceSpeed ?? 1;
  const details = [
    VOICE_PROVIDERS[provider].label,
    VOICE_PROVIDERS[provider].tuning.includes("voiceSpeed") && speed !== 1
      ? `${speed.toFixed(2)}× speed`
      : null,
  ].filter(Boolean);
  const missing = provider !== "openai" && !id;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/[0.08] dark:bg-white/[0.02]"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <AudioLines className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium">
          {missing
            ? "Choose a voice"
            : name || (provider === "cartesia" ? "Cartesia voice" : "Selected voice")}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {details.join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-[10px] font-medium text-primary">Change</span>
    </button>
  );
}
