import { EngineSupportNote, useSettingSupported } from "./EngineSupportNote";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ChevronDown,
  RefreshCw,
  AlertTriangle,
  Settings,
  Pencil,
  Trash2,
  Plus,
  Globe,
  Play,
  Loader2,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useBuilderStore } from "@/lib/builder/store";
import { resolveDeploymentMode } from "@/lib/runtime/adapter";
import { getAgentVoice } from "@/lib/builder/agent-voice.shared";
import { previewPronunciation } from "@/lib/builder/pronunciation-preview.functions";
import {
  renderPronunciation,
  validatePronunciationEntry,
  type PronunciationEntry,
} from "@/lib/voice/tts/pronunciation-dictionary.shared";
import type { BuilderSettings } from "@/lib/builder/types";

function SpeechSlider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="relative h-5 flex items-center">
      <div className="absolute inset-x-0 h-[3px] rounded-full bg-muted dark:bg-white/[0.08]" />
      <div
        className="absolute left-0 h-[3px] rounded-full bg-primary"
        style={{ width: `${pct}%` }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="relative w-full h-[3px] cursor-pointer rounded-full appearance-none bg-transparent
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:h-[14px] [&::-webkit-slider-thumb]:w-[14px]
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
          [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_hsl(var(--background))]
          [&::-moz-range-thumb]:h-[14px] [&::-moz-range-thumb]:w-[14px]
          [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary
          [&::-moz-range-thumb]:border-0"
      />
    </div>
  );
}

type PronEntry = PronunciationEntry;

const ALPHABET_LABEL: Record<PronEntry["alphabet"], string> = {
  respell: "Sounds like",
  ipa: "IPA",
  cmu: "CMU",
};

const ALPHABET_HELP: Record<PronEntry["alphabet"], string> = {
  respell: "Spell it the way it sounds, e.g. “ZEER-oh”. Works with every voice.",
  ipa: "International Phonetic Alphabet. Needs a Fish Audio or Cartesia voice (or Retell).",
  cmu: "Space-separated CMU symbols; digits mark stress. Needs a Fish Audio or Cartesia voice (or Retell).",
};

const ALPHABET_PLACEHOLDER: Record<PronEntry["alphabet"], string> = {
  respell: "e.g. WEE-bee",
  ipa: "e.g. ˈwiːbiː",
  cmu: "e.g. W IY1 B IY0",
};

/** Why this entry won't be spoken as written on the agent's current engine/voice, or null. */
function pronunciationIssue(
  entry: PronEntry,
  settings: ReturnType<typeof useBuilderStore.getState>["settings"],
): string | null {
  const invalid = validatePronunciationEntry(entry);
  if (invalid) return invalid;
  const mode = resolveDeploymentMode(settings);
  if (mode === "RETELL") {
    return entry.alphabet === "respell"
      ? "Retell voices take IPA or CMU only — “Sounds like” entries are skipped."
      : null;
  }
  if (mode !== "WEBEE_NATIVE") return "Pronunciations aren't applied on this engine.";
  const provider = settings.webeeTtsProvider ?? "fish";
  if (renderPronunciation(entry, { provider }) === null) {
    return `${provider === "openai" ? "OpenAI" : provider} voices can't take phonemes — rewrite it as “Sounds like”.`;
  }
  return null;
}

/** Plays a sample line through the agent's real voice with the given entries applied. */
function usePronunciationPlayer() {
  const preview = useServerFn(previewPronunciation);
  const settings = useBuilderStore((s) => s.settings);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canPreview = resolveDeploymentMode(settings) === "WEBEE_NATIVE";

  async function play(key: string, entries: PronEntry[], text: string) {
    if (busyKey) return;
    setBusyKey(key);
    try {
      const voice = getAgentVoice(settings as unknown as Record<string, unknown>);
      const out = await preview({
        data: {
          text,
          entries,
          provider: settings.webeeTtsProvider ?? "fish",
          voiceId: voice.id,
          model: settings.webeeTtsModel,
        },
      });
      audioRef.current?.pause();
      const audio = new Audio(`data:${out.mimeType};base64,${out.audio}`);
      audioRef.current = audio;
      await audio.play();
    } catch (err) {
      toast.error("Couldn't play preview", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyKey(null);
    }
  }

  return { play, busyKey, canPreview };
}

function PronunciationDialog({
  open,
  initial,
  onSave,
  onClose,
  player,
}: {
  open: boolean;
  initial?: PronEntry;
  onSave: (e: PronEntry) => void;
  onClose: () => void;
  player: ReturnType<typeof usePronunciationPlayer>;
}) {
  const settings = useBuilderStore((s) => s.settings);
  const [word, setWord] = useState(initial?.word ?? "");
  const [alphabet, setAlphabet] = useState<PronEntry["alphabet"]>(initial?.alphabet ?? "respell");
  const [phoneme, setPhoneme] = useState(initial?.phoneme ?? "");

  const draft: PronEntry = { word: word.trim(), alphabet, phoneme: phoneme.trim() };
  const problem = word.trim() || phoneme.trim() ? validatePronunciationEntry(draft) : null;
  const engineIssue = !problem && draft.word && draft.phoneme ? pronunciationIssue(draft, settings) : null;

  function handleSave() {
    if (validatePronunciationEntry(draft)) return;
    onSave(draft);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit pronunciation" : "Add pronunciation"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <Label className="text-xs mb-1 block">Word or phrase</Label>
            <Input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="e.g. Webee"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Write it as</Label>
            <Select value={alphabet} onValueChange={(v) => setAlphabet(v as PronEntry["alphabet"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="respell">Sounds like</SelectItem>
                <SelectItem value="ipa">IPA</SelectItem>
                <SelectItem value="cmu">CMU</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{ALPHABET_HELP[alphabet]}</p>
          </div>
          <div>
            <Label className="text-xs mb-1 block">How it sounds</Label>
            <Input
              value={phoneme}
              onChange={(e) => setPhoneme(e.target.value)}
              placeholder={ALPHABET_PLACEHOLDER[alphabet]}
            />
            {problem && <p className="mt-1 text-[10px] text-destructive">{problem}</p>}
            {engineIssue && (
              <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">{engineIssue}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          {player.canPreview && (
            <Button
              variant="outline"
              className="mr-auto gap-1.5"
              disabled={!!problem || !draft.word || !draft.phoneme || !!player.busyKey}
              onClick={() =>
                void player.play("dialog", [draft], `Hi, this is ${draft.word}. Nice to meet you.`)
              }
            >
              {player.busyKey === "dialog" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Hear it
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!!problem || !draft.word || !draft.phoneme}>
            {initial ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SpeechSettingsSection({ isRetell }: { isRetell: boolean }) {
  const settings = useBuilderStore((s) => s.settings);
  const setSettings = useBuilderStore((s) => s.setSettings);

  const [pronDialog, setPronDialog] = useState<{ open: boolean; index?: number; seq?: number }>({
    open: false,
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const player = usePronunciationPlayer();
  const backchannelSupported = useSettingSupported("enableBackchannel");

  const pronunciationDictionary = settings.pronunciationDictionary ?? [];

  function set<K extends keyof BuilderSettings>(patch: Partial<BuilderSettings>) {
    setSettings(patch);
  }

  function numeric(key: keyof BuilderSettings, val: string, fallback: number) {
    const n = parseFloat(val);
    setSettings({ [key]: isNaN(n) ? fallback : n });
  }

  function intNum(key: keyof BuilderSettings, val: string, fallback: number) {
    const n = parseInt(val, 10);
    setSettings({ [key]: isNaN(n) ? fallback : n });
  }

  function csv(key: keyof BuilderSettings, val: string) {
    const arr = val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setSettings({ [key]: arr });
  }

  function savePron(entry: PronEntry, index?: number) {
    // Read the list at save time, not from this render's closure, so a save can never write back
    // a stale copy over entries added or edited since.
    const current = useBuilderStore.getState().settings.pronunciationDictionary ?? [];
    setSettings({
      pronunciationDictionary:
        index === undefined
          ? [...current, entry]
          : current.map((e, i) => (i === index ? entry : e)),
    });
  }

  const reminderSec = Math.round((settings.reminderTriggerMs ?? 10000) / 1000);
  const reminderCount = settings.reminderMaxCount ?? 1;

  return (
    <>
      <Collapsible className="rounded-lg border border-border dark:border-white/[0.06] bg-muted/20 dark:bg-white/[0.01]">
        <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
          <span>Speech Settings</span>
          <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-4 px-3 pb-4 pt-1">

          {/* Background Sound — Retell, and WEBEE Native phone calls */}
          {(
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] font-medium text-foreground">Background Sound</span>
              </div>
              <div className="mb-1.5"><EngineSupportNote setting="ambientSound" /></div>
              <div className="flex items-center gap-1.5">
                <Select
                  value={settings.ambientSound ?? "none"}
                  onValueChange={(v) =>
                    set({ ambientSound: v as BuilderSettings["ambientSound"] })
                  }
                >
                  <SelectTrigger className="h-8 text-[11px] flex-1">
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
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground">
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-52 p-3 space-y-2" side="left">
                    <p className="text-[11px] font-medium">Ambient Volume</p>
                    <div className="flex items-center gap-2">
                      <SpeechSlider
                        value={settings.ambientSoundVolume ?? 1}
                        min={0}
                        max={2}
                        step={0.05}
                        onChange={(v) => set({ ambientSoundVolume: v })}
                      />
                      <span className="text-[10px] tabular-nums text-muted-foreground w-6 text-right">
                        {(settings.ambientSoundVolume ?? 1).toFixed(2)}
                      </span>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          {/* Response Eagerness */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-medium text-foreground">Response Eagerness</span>
                <RefreshCw className="h-3 w-3 text-muted-foreground" />
              </div>
              <span className="text-[11px] tabular-nums text-foreground/70 font-mono">
                {(settings.responsiveness ?? 1).toFixed(2)}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed -mt-1">
              How quickly the agent starts responding after the user finishes. 1.2+ uses the
              shortest silence window (400ms); 0.8–1.19 uses 500ms; below 0.8 uses 700ms.
            </p>
            {/* Range is 0–2, matching resolveCascadeTuning()'s own clamp and its documented
                scale. It was capped at 1 here, which made the fastest tier (>= 1.2 -> 400ms
                silence window) unreachable from the builder entirely. */}
            <SpeechSlider
              value={settings.responsiveness ?? 1}
              min={0}
              max={2}
              step={0.05}
              onChange={(v) => set({ responsiveness: v })}
            />
            <div className="flex items-center gap-2 pt-0.5">
              <Checkbox
                id="dynamic-eagerness"
                checked={Boolean(settings.enableDynamicResponsiveness)}
                onCheckedChange={(v) => set({ enableDynamicResponsiveness: Boolean(v) })}
                className="h-3.5 w-3.5"
              />
              <label htmlFor="dynamic-eagerness" className="text-[10px] text-muted-foreground cursor-pointer">
                Dynamically adjust based on user input
              </label>
            </div>
          </div>

          {/* Interruption Sensitivity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-foreground">Interruption Sensitivity</span>
              <span className="text-[11px] tabular-nums text-foreground/70 font-mono">
                {(settings.interruptionSensitivity ?? 0.7).toFixed(2)}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed -mt-1">
              How quickly the agent stops when user talks over it.
            </p>
            <SpeechSlider
              value={settings.interruptionSensitivity ?? 0.7}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => set({ interruptionSensitivity: v })}
            />
          </div>

          {/* Enable Backchanneling */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-foreground">Enable Backchanneling</span>
                <AlertTriangle className="h-3 w-3 text-amber-500" />
              </div>
              <Switch
                checked={Boolean(settings.enableBackchannel)}
                disabled={!backchannelSupported}
                onCheckedChange={(v) => set({ enableBackchannel: v })}
              />
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed -mt-1">
              Enables the agent to use affirmations like &lsquo;yeah&rsquo; or &lsquo;uh-huh&rsquo; during
              conversations, indicating active listening and engagement.
            </p>
            <EngineSupportNote setting="enableBackchannel" />

            {settings.enableBackchannel && (
              <div className="mt-2 space-y-3 rounded-md border border-border dark:border-white/[0.06] bg-muted/40 dark:bg-white/[0.02] p-3">
                {/* Backchannel Frequency */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-foreground">Backchannel Frequency</span>
                    <span className="text-[11px] tabular-nums text-foreground/70 font-mono">
                      {(settings.backchannelFrequency ?? 0.3).toFixed(2)}
                    </span>
                  </div>
                  <SpeechSlider
                    value={settings.backchannelFrequency ?? 0.3}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(v) => set({ backchannelFrequency: v })}
                  />
                </div>

                {/* Backchannel Words */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-foreground">Backchannel Words</span>
                  <p className="text-[10px] text-muted-foreground">
                    A list of words that the agent would use for backchanneling.
                  </p>
                  <textarea
                    rows={2}
                    className="w-full rounded-md border border-border dark:border-white/[0.08] bg-muted/60 dark:bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
                    placeholder="yeah, okay, hmmm, uh-huh"
                    value={(settings.backchannelWords ?? []).join(", ")}
                    onChange={(e) => csv("backchannelWords", e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Reminder Message Frequency */}
          <div className="space-y-2">
            <span className="text-[11px] font-medium text-foreground">Reminder Message Frequency</span>
            <p className="text-[10px] text-muted-foreground leading-relaxed -mt-1">
              Control how often AI will send a reminder message.
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={300}
                value={reminderSec}
                onChange={(e) => intNum("reminderTriggerMs", String(parseInt(e.target.value, 10) * 1000), 10000)}
                className="h-7 w-16 text-[11px] text-center"
              />
              <span className="text-[10px] text-muted-foreground">seconds</span>
              <Input
                type="number"
                min={0}
                max={10}
                value={reminderCount}
                onChange={(e) => intNum("reminderMaxCount", e.target.value, 1)}
                className="h-7 w-12 text-[11px] text-center"
              />
              <span className="text-[10px] text-muted-foreground">times</span>
            </div>
          </div>

          {/* Pronunciation */}
          <div className="space-y-2">
            <span className="text-[11px] font-medium text-foreground">Pronunciation</span>
            <p className="text-[10px] text-muted-foreground leading-relaxed -mt-1">
              Say a word, name, or phrase your way. Write it as “sounds like” text, or exact IPA/CMU phonemes.
            </p>

            {pronunciationDictionary.length > 0 && (
              <div className="space-y-1">
                {pronunciationDictionary.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md border border-border dark:border-white/[0.06] bg-muted/40 dark:bg-white/[0.02] px-2.5 py-1.5"
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border dark:border-white/[0.10] bg-muted dark:bg-white/[0.04]">
                      <Globe className="h-2.5 w-2.5 text-muted-foreground" />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                      {entry.word}
                      <span className="ml-1.5 text-muted-foreground">
                        → {entry.phoneme || "—"}
                      </span>
                    </span>
                    <span className="shrink-0 rounded border border-white/[0.10] px-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                      {ALPHABET_LABEL[entry.alphabet] ?? entry.alphabet}
                    </span>
                    {pronunciationIssue(entry, settings) && (
                      <span title={pronunciationIssue(entry, settings) ?? undefined}>
                        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
                      </span>
                    )}
                    {player.canPreview && !pronunciationIssue(entry, settings) && (
                      <button
                        className="text-muted-foreground hover:text-foreground transition-colors p-0.5 disabled:opacity-50"
                        disabled={!!player.busyKey}
                        onClick={() =>
                          void player.play(
                            `row-${i}`,
                            [entry],
                            `Hi, this is ${entry.word}. Nice to meet you.`,
                          )
                        }
                        title="Hear it"
                      >
                        {player.busyKey === `row-${i}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                      </button>
                    )}
                    <button
                      className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                      onClick={() => setPronDialog({ open: true, index: i, seq: Date.now() })}
                      title="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                      onClick={() =>
                        setSettings({
                          pronunciationDictionary: pronunciationDictionary.filter((_, j) => j !== i),
                        })
                      }
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-[11px]"
              onClick={() => setPronDialog({ open: true, index: undefined, seq: Date.now() })}
            >
              <Plus className="h-3 w-3" />
              Add
            </Button>
          </div>

          {/* Advanced ——————————————————————————————————————— */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md border border-border dark:border-white/[0.06] bg-muted/40 dark:bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
              <span>Advanced</span>
              <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">

              {/* Voice Speed */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Voice Speed</span>
                  <span className="text-[10px] tabular-nums text-foreground/70 font-mono">{(settings.voiceSpeed ?? 1).toFixed(1)}</span>
                </div>
                <SpeechSlider value={settings.voiceSpeed ?? 1} min={0.5} max={2} step={0.1} onChange={(v) => set({ voiceSpeed: v })} />
              </div>

              {/* Voice Temp */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Voice Temp</span>
                  <span className="text-[10px] tabular-nums text-foreground/70 font-mono">{(settings.voiceTemperature ?? 1).toFixed(1)}</span>
                </div>
                <SpeechSlider value={settings.voiceTemperature ?? 1} min={0} max={2} step={0.1} onChange={(v) => set({ voiceTemperature: v })} />
                <EngineSupportNote setting="voiceTemperature" />
              </div>

              {/* Volume */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Volume</span>
                  <span className="text-[10px] tabular-nums text-foreground/70 font-mono">{(settings.volume ?? 1).toFixed(1)}</span>
                </div>
                <SpeechSlider value={settings.volume ?? 1} min={0} max={2} step={0.1} onChange={(v) => set({ volume: v })} />
              </div>

              {/* Grid selects */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[9px]">Emotion</Label>
                  <Select
                    value={settings.voiceEmotion ?? "none"}
                    onValueChange={(v) => set({ voiceEmotion: v as BuilderSettings["voiceEmotion"] })}
                  >
                    <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["none","calm","sympathetic","happy","sad","angry","fearful","surprised"] as const).map((v) => (
                        <SelectItem key={v} value={v}>{v === "none" ? "None" : v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <EngineSupportNote setting="voiceEmotion" />
                </div>
              </div>

              {/* Call timings grid */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[9px]">Silence end (ms)</Label>
                  <Input type="number" step="1000" min={10000} value={settings.endCallAfterSilenceMs ?? 600000} onChange={(e) => numeric("endCallAfterSilenceMs", e.target.value, 600000)} className="h-6 text-[10px]" />
                </div>
                <div>
                  <Label className="text-[9px]">Begin delay (ms)</Label>
                  <Input type="number" step="100" min={0} max={5000} value={settings.beginMessageDelayMs ?? 0} onChange={(e) => numeric("beginMessageDelayMs", e.target.value, 0)} className="h-6 text-[10px]" />
                </div>
                <div>
                  <Label className="text-[9px]">Max call (ms)</Label>
                  <Input type="number" step="1000" min={60000} value={settings.maxCallDurationMs ?? 1800000} onChange={(e) => numeric("maxCallDurationMs", e.target.value, 1800000)} className="h-6 text-[10px]" />
                </div>
                <div>
                  <Label className="text-[9px]">Ring (ms)</Label>
                  <Input type="number" step="1000" min={5000} value={settings.ringDurationMs ?? 30000} onChange={(e) => numeric("ringDurationMs", e.target.value, 30000)} className="h-6 text-[10px]" />
                </div>
              </div>

              {/* Voicemail */}
              <div className="space-y-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] p-2">
                <Label className="text-[9px]">If voicemail answers</Label>
                <Select
                  value={settings.voicemailAction ?? "none"}
                  onValueChange={(v) => set({ voicemailAction: v as BuilderSettings["voicemailAction"] })}
                >
                  <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Keep talking</SelectItem>
                    <SelectItem value="hangup">Hang up</SelectItem>
                    <SelectItem value="leave_message">Leave a message</SelectItem>
                  </SelectContent>
                </Select>
                {settings.voicemailAction === "leave_message" && (
                  <textarea
                    value={settings.voicemailMessage ?? ""}
                    onChange={(e) => set({ voicemailMessage: e.target.value })}
                    placeholder="Hi {{first_name}}, this is Clare from We Buy Any House. Please call us back on…"
                    rows={3}
                    className="w-full rounded-md border border-white/[0.08] bg-transparent px-2 py-1 text-[10px]"
                  />
                )}
                {(settings.voicemailAction === "hangup" || settings.voicemailAction === "leave_message") && (
                  <div>
                    <Label className="text-[9px]">Listen for voicemail for (ms)</Label>
                    <Input
                      type="number"
                      step="1000"
                      min={5000}
                      max={180000}
                      value={settings.voicemailDetectionTimeoutMs ?? 30000}
                      onChange={(e) => numeric("voicemailDetectionTimeoutMs", e.target.value, 30000)}
                      className="h-6 text-[10px]"
                    />
                  </div>
                )}
                <p className="text-[9px] leading-snug text-muted-foreground">
                  Phone calls only. The agent hears the greeting, then{" "}
                  {settings.voicemailAction === "leave_message"
                    ? "waits for it to finish and speaks your message"
                    : settings.voicemailAction === "hangup"
                      ? "hangs up"
                      : "carries on as if a person answered"}
                  .
                </p>
              </div>

              {/* Toggles */}
              <div className="space-y-2">
                {([
                  ["Dynamic voice speed", "enableDynamicVoiceSpeed"],
                  ["Normalize for speech", "normalizeForSpeech"],
                  ["Allow user DTMF", "allowUserDtmf"],
                  ["DTMF can interrupt", "allowDtmfInterruption"],
                ] as [string, keyof BuilderSettings][]).map(([label, key]) => (
                  <div key={key} className="flex items-center justify-between">
                    <Label className="text-[9px]">{label}</Label>
                    <Switch
                      checked={Boolean(settings[key])}
                      onCheckedChange={(v) => setSettings({ [key]: v })}
                    />
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CollapsibleContent>
      </Collapsible>

      {/* Pronunciation dialog */}
      <PronunciationDialog
        // A new key per opening gives every Add/Edit a fresh form; the dialog reads its starting
        // values once, so without it an edit showed (and saved) the previous form's data.
        key={pronDialog.seq ?? "closed"}
        open={pronDialog.open}
        initial={
          pronDialog.index !== undefined ? pronunciationDictionary[pronDialog.index] : undefined
        }
        onSave={(entry) => savePron(entry, pronDialog.index)}
        onClose={() => setPronDialog((d) => ({ ...d, open: false }))}
        player={player}
      />
    </>
  );
}
