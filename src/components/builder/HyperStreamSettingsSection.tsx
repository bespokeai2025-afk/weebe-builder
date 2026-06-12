import { useState } from "react";
import { ChevronDown, Zap } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBuilderStore } from "@/lib/builder/store";
import type { BuilderSettings } from "@/lib/builder/types";

function HSSlider({
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
        className="absolute left-0 h-[3px] rounded-full bg-violet-500"
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
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500
          [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_hsl(var(--background))]
          [&::-moz-range-thumb]:h-[14px] [&::-moz-range-thumb]:w-[14px]
          [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-500
          [&::-moz-range-thumb]:border-0"
      />
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function HyperStreamSettingsSection() {
  const settings = useBuilderStore((s) => s.settings);
  const setSettings = useBuilderStore((s) => s.setSettings);
  const [open, setOpen] = useState(false);

  function set(patch: Partial<BuilderSettings>) {
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

  const turnDetection = settings.hyperstreamTurnDetection ?? "server_vad";
  const isServerVad = turnDetection === "server_vad";

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-violet-500/20 bg-violet-500/[0.03]"
    >
      <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3 w-3 text-violet-400" />
          <span>HyperStream Settings</span>
        </div>
        <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 px-3 pb-4 pt-1">

        {/* Turn Detection Mode */}
        <FieldRow label="Turn Detection">
          <Select
            value={turnDetection}
            onValueChange={(v) =>
              set({ hyperstreamTurnDetection: v as BuilderSettings["hyperstreamTurnDetection"] })
            }
          >
            <SelectTrigger className="h-8 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="server_vad">
                <div className="flex flex-col">
                  <span>Server VAD</span>
                  <span className="text-[10px] text-muted-foreground">Voice activity detection — low latency</span>
                </div>
              </SelectItem>
              <SelectItem value="semantic_vad">
                <div className="flex flex-col">
                  <span>Semantic VAD</span>
                  <span className="text-[10px] text-muted-foreground">Waits for natural speech end</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>

        {/* Server VAD fields */}
        {isServerVad && (
          <div className="space-y-3 rounded-md border border-white/[0.06] bg-white/[0.02] p-3">
            {/* VAD Threshold */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  VAD Threshold
                </span>
                <span className="text-[11px] tabular-nums text-foreground/70 font-mono">
                  {(settings.hyperstreamVadThreshold ?? 0.5).toFixed(2)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Sensitivity for voice activity detection. Lower = more sensitive.
              </p>
              <HSSlider
                value={settings.hyperstreamVadThreshold ?? 0.5}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => set({ hyperstreamVadThreshold: v })}
              />
            </div>

            {/* Silence Duration */}
            <div>
              <Label className="text-[9px]">Silence Duration (ms)</Label>
              <p className="text-[10px] text-muted-foreground mb-1">
                Milliseconds of silence to detect end of speech. Min: 200ms.
              </p>
              <Input
                type="number"
                min={200}
                max={3000}
                step={50}
                value={settings.hyperstreamSilenceDurationMs ?? 200}
                onChange={(e) => intNum("hyperstreamSilenceDurationMs", e.target.value, 200)}
                className="h-7 text-[11px] w-32"
              />
            </div>

            {/* Prefix Padding */}
            <div>
              <Label className="text-[9px]">Prefix Padding (ms)</Label>
              <p className="text-[10px] text-muted-foreground mb-1">
                Audio included before speech is detected. Default: 200ms.
              </p>
              <Input
                type="number"
                min={0}
                max={2000}
                step={50}
                value={settings.hyperstreamPrefixPaddingMs ?? 200}
                onChange={(e) => intNum("hyperstreamPrefixPaddingMs", e.target.value, 200)}
                className="h-7 text-[11px] w-32"
              />
            </div>
          </div>
        )}

        {/* Semantic VAD: Eagerness */}
        {!isServerVad && (
          <FieldRow label="Eagerness">
            <Select
              value={settings.hyperstreamEagerness ?? "auto"}
              onValueChange={(v) =>
                set({ hyperstreamEagerness: v as BuilderSettings["hyperstreamEagerness"] })
              }
            >
              <SelectTrigger className="h-8 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (recommended)</SelectItem>
                <SelectItem value="low">Low — waits longer</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High — responds faster</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
        )}

        {/* Noise Reduction */}
        <FieldRow label="Input Noise Reduction">
          <Select
            value={settings.hyperstreamNoiseReduction ?? "none"}
            onValueChange={(v) =>
              set({ hyperstreamNoiseReduction: v as BuilderSettings["hyperstreamNoiseReduction"] })
            }
          >
            <SelectTrigger className="h-8 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                <div className="flex flex-col">
                  <span>None</span>
                  <span className="text-[10px] text-muted-foreground">No noise processing</span>
                </div>
              </SelectItem>
              <SelectItem value="near_field">
                <div className="flex flex-col">
                  <span>Near Field</span>
                  <span className="text-[10px] text-muted-foreground">Phone / close mic</span>
                </div>
              </SelectItem>
              <SelectItem value="far_field">
                <div className="flex flex-col">
                  <span>Far Field</span>
                  <span className="text-[10px] text-muted-foreground">Room / speakerphone</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>

        {/* Max Response Tokens */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Max Response Tokens
          </Label>
          <p className="text-[10px] text-muted-foreground">
            Maximum tokens per response. Leave blank for unlimited.
          </p>
          <Input
            type="number"
            min={1}
            max={4096}
            step={1}
            placeholder="Unlimited"
            value={settings.hyperstreamMaxTokens ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) {
                setSettings({ hyperstreamMaxTokens: undefined });
              } else {
                intNum("hyperstreamMaxTokens", val, 2048);
              }
            }}
            className="h-7 text-[11px] w-32"
          />
        </div>

      </CollapsibleContent>
    </Collapsible>
  );
}
