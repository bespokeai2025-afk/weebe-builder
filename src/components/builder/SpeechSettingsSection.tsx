import { useState } from "react";
import {
  ChevronDown,
  RefreshCw,
  AlertTriangle,
  Settings,
  Pencil,
  Trash2,
  Plus,
  Globe,
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
      <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.08]" />
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

type PronEntry = { word: string; alphabet: "ipa" | "cmu"; phoneme: string };

function PronunciationDialog({
  open,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  initial?: PronEntry;
  onSave: (e: PronEntry) => void;
  onClose: () => void;
}) {
  const [word, setWord] = useState(initial?.word ?? "");
  const [alphabet, setAlphabet] = useState<"ipa" | "cmu">(initial?.alphabet ?? "ipa");
  const [phoneme, setPhoneme] = useState(initial?.phoneme ?? "");

  function handleSave() {
    if (!word.trim()) return;
    onSave({ word: word.trim(), alphabet, phoneme: phoneme.trim() });
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
            <Label className="text-xs mb-1 block">Alphabet</Label>
            <Select value={alphabet} onValueChange={(v) => setAlphabet(v as "ipa" | "cmu")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ipa">IPA</SelectItem>
                <SelectItem value="cmu">CMU</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Phoneme</Label>
            <Input
              value={phoneme}
              onChange={(e) => setPhoneme(e.target.value)}
              placeholder={alphabet === "ipa" ? "e.g. wɪˈbiː" : "e.g. W IH0 B IY1"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!word.trim()}>
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

  const [pronDialog, setPronDialog] = useState<{ open: boolean; index?: number }>({
    open: false,
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
    if (index === undefined) {
      setSettings({ pronunciationDictionary: [...pronunciationDictionary, entry] });
    } else {
      setSettings({
        pronunciationDictionary: pronunciationDictionary.map((e, i) =>
          i === index ? entry : e,
        ),
      });
    }
  }

  const reminderSec = Math.round((settings.reminderTriggerMs ?? 10000) / 1000);
  const reminderCount = settings.reminderMaxCount ?? 1;

  return (
    <>
      <Collapsible className="rounded-lg border border-white/[0.06] bg-white/[0.01]">
        <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
          <span>Speech Settings</span>
          <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-4 px-3 pb-4 pt-1">

          {/* Background Sound (Retell-only) */}
          {isRetell && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] font-medium text-foreground">Background Sound</span>
              </div>
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
              How quickly the agent starts responding after the user finishes.
            </p>
            <SpeechSlider
              value={settings.responsiveness ?? 1}
              min={0}
              max={1}
              step={0.01}
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
                onCheckedChange={(v) => set({ enableBackchannel: v })}
              />
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed -mt-1">
              Enables the agent to use affirmations like &lsquo;yeah&rsquo; or &lsquo;uh-huh&rsquo; during
              conversations, indicating active listening and engagement.
            </p>

            {settings.enableBackchannel && (
              <div className="mt-2 space-y-3 rounded-md border border-white/[0.06] bg-white/[0.02] p-3">
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
                    className="w-full rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
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
              Guide the model to pronounce a word, name, or phrase in a specific way.
            </p>

            {pronunciationDictionary.length > 0 && (
              <div className="space-y-1">
                {pronunciationDictionary.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.04]">
                      <Globe className="h-2.5 w-2.5 text-muted-foreground" />
                    </div>
                    <span className="flex-1 text-[11px] text-foreground truncate">{entry.word}</span>
                    <button
                      className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                      onClick={() => setPronDialog({ open: true, index: i })}
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
              onClick={() => setPronDialog({ open: true, index: undefined })}
            >
              <Plus className="h-3 w-3" />
              Add
            </Button>
          </div>

          {/* Advanced ——————————————————————————————————————— */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
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
        open={pronDialog.open}
        initial={
          pronDialog.index !== undefined ? pronunciationDictionary[pronDialog.index] : undefined
        }
        onSave={(entry) => savePron(entry, pronDialog.index)}
        onClose={() => setPronDialog({ open: false })}
      />
    </>
  );
}
