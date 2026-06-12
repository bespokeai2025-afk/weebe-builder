import { Mic2, Info } from "lucide-react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBuilderStore } from "@/lib/builder/store";
import type { BuilderSettings } from "@/lib/builder/types";

function SectionLabel({
  label,
  description,
}: {
  label: string;
  description?: string;
}) {
  return (
    <div className="space-y-0.5 mb-2">
      <p className="text-[11px] font-medium text-foreground">{label}</p>
      {description && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">{description}</p>
      )}
    </div>
  );
}

function RadioRow({
  value,
  label,
  badge,
  info,
}: {
  value: string;
  label: string;
  badge?: string;
  info?: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <RadioGroupItem value={value} id={`tss-${value}`} className="h-3.5 w-3.5 shrink-0" />
      <label
        htmlFor={`tss-${value}`}
        className="flex items-center gap-1.5 text-[11px] text-foreground cursor-pointer"
      >
        {label}
        {badge && (
          <span className="rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-medium text-blue-400">
            {badge}
          </span>
        )}
        {info && <Info className="h-3 w-3 text-muted-foreground" title={info} />}
      </label>
    </div>
  );
}

function RetellTranscriptionSettings() {
  const settings = useBuilderStore((s) => s.settings);
  const setSettings = useBuilderStore((s) => s.setSettings);

  function csv(key: keyof BuilderSettings, val: string) {
    const arr = val.split(",").map((s) => s.trim()).filter(Boolean);
    setSettings({ [key]: arr });
  }

  return (
    <div className="space-y-5">
      {/* Denoising Mode */}
      <div>
        <SectionLabel
          label="Denoising Mode"
          description="Filter out unwanted background noise or speech."
        />
        <RadioGroup
          value={settings.denoisingMode ?? "noise-and-background-speech-cancellation"}
          onValueChange={(v) =>
            setSettings({ denoisingMode: v as BuilderSettings["denoisingMode"] })
          }
          className="space-y-0.5"
        >
          <RadioRow value="noise-cancellation" label="Remove noise" />
          <RadioRow
            value="noise-and-background-speech-cancellation"
            label="Remove noise + background speech"
            info="Removes both environmental noise and background speech"
          />
          <RadioRow
            value="no-denoise"
            label="No denoising"
            info="Pass audio through without processing"
          />
        </RadioGroup>
      </div>

      {/* Transcription Mode */}
      <div>
        <SectionLabel
          label="Transcription Mode"
          description="Balance between speed and accuracy."
        />
        <RadioGroup
          value={settings.sttMode ?? "fast"}
          onValueChange={(v) => setSettings({ sttMode: v as BuilderSettings["sttMode"] })}
          className="space-y-0.5"
        >
          <RadioRow
            value="fast"
            label="Optimize for speed"
            badge="Provider Config"
          />
          <RadioRow
            value="accurate"
            label="Optimize for accuracy"
            badge="Provider Config"
          />
          <RadioRow value="custom" label="Custom Settings" />
        </RadioGroup>
      </div>

      {/* Vocabulary Specialization */}
      <div>
        <SectionLabel
          label="Vocabulary Specialization"
          description="Choose the vocabulary set to use for transcription."
        />
        <RadioGroup
          value={settings.vocabSpecialization ?? "general"}
          onValueChange={(v) =>
            setSettings({ vocabSpecialization: v as BuilderSettings["vocabSpecialization"] })
          }
          className="space-y-0.5"
        >
          <RadioRow value="general" label="General (Works well across most industries)" />
          <RadioRow
            value="medical"
            label="Medical (Optimized for healthcare terms)"
            info="Uses medical-specific vocabulary for better accuracy with clinical terminology"
          />
        </RadioGroup>
      </div>

      {/* Boosted Keywords */}
      <div>
        <SectionLabel
          label="Boosted Keywords"
          description="Provide a customized list of keywords to expand our models' vocabulary."
        />
        <input
          type="text"
          className="w-full rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          placeholder="Split by comma. Example: Retell, Walmart"
          value={(settings.boostedKeywords ?? []).join(", ")}
          onChange={(e) => csv("boostedKeywords", e.target.value)}
        />
      </div>
    </div>
  );
}

function HyperStreamTranscriptionSettings() {
  const settings = useBuilderStore((s) => s.settings);
  const setSettings = useBuilderStore((s) => s.setSettings);

  return (
    <div className="space-y-5">
      {/* Noise Reduction */}
      <div>
        <SectionLabel
          label="Input Noise Reduction"
          description="Filter out background noise from the caller's microphone."
        />
        <RadioGroup
          value={settings.hyperstreamNoiseReduction ?? "none"}
          onValueChange={(v) =>
            setSettings({ hyperstreamNoiseReduction: v as BuilderSettings["hyperstreamNoiseReduction"] })
          }
          className="space-y-0.5"
        >
          <RadioRow value="none" label="None — pass audio through unprocessed" />
          <RadioRow
            value="near_field"
            label="Near Field"
            info="Optimised for phone handsets and close-mic setups"
          />
          <RadioRow
            value="far_field"
            label="Far Field"
            info="Optimised for speakerphone, room mics, and VOIP"
          />
        </RadioGroup>
      </div>

      {/* Transcription Model */}
      <div>
        <SectionLabel
          label="Transcription Model"
          description="Model used to transcribe the caller's speech to text."
        />
        <Select
          value={settings.hyperstreamTranscriptionModel ?? "whisper-1"}
          onValueChange={(v) =>
            setSettings({ hyperstreamTranscriptionModel: v as BuilderSettings["hyperstreamTranscriptionModel"] })
          }
        >
          <SelectTrigger className="h-8 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="whisper-1">
              <div className="flex flex-col">
                <span>Whisper-1</span>
                <span className="text-[10px] text-muted-foreground">
                  Reliable, widely tested
                </span>
              </div>
            </SelectItem>
            <SelectItem value="gpt-4o-transcribe">
              <div className="flex flex-col">
                <span>GPT-4o Transcribe</span>
                <span className="text-[10px] text-muted-foreground">
                  Higher accuracy, newer model
                </span>
              </div>
            </SelectItem>
            <SelectItem value="gpt-4o-mini-transcribe">
              <div className="flex flex-col">
                <span>GPT-4o Mini Transcribe</span>
                <span className="text-[10px] text-muted-foreground">
                  Faster, cost-efficient
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function TranscriptionSettingsSection({
  isRetell,
  isHyperStream,
}: {
  isRetell: boolean;
  isHyperStream: boolean;
}) {
  if (!isRetell && !isHyperStream) return null;

  return (
    <Collapsible className="rounded-lg border border-white/[0.06] bg-white/[0.01]">
      <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
        <div className="flex items-center gap-1.5">
          <Mic2 className="h-3 w-3" />
          <span>Realtime Transcription Settings</span>
        </div>
        <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent className="px-3 pb-4 pt-1">
        {isRetell && <RetellTranscriptionSettings />}
        {isHyperStream && <HyperStreamTranscriptionSettings />}
      </CollapsibleContent>
    </Collapsible>
  );
}
