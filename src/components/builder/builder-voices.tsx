/** Builder — default voices, provider labels and the voice preview player. */
import { useRef, useState } from "react";
import { Play } from "lucide-react";

export type VoiceGroup = string;

/** Offline fallback only — the picker reads Retell's live catalogue when it can reach it. */
export const DEFAULT_VOICES: { id: string; label: string; group: VoiceGroup }[] = [
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

export const VOICE_PROVIDER_LABELS: Record<string, string> = {
  elevenlabs: "ElevenLabs",
  openai: "OpenAI",
  deepgram: "Deepgram",
  cartesia: "Cartesia",
  minimax: "MiniMax",
  fish_audio: "Fish Audio",
  platform: "Platform",
};

export function voiceProviderLabel(provider: string | undefined): string {
  const key = String(provider ?? "").toLowerCase();
  return VOICE_PROVIDER_LABELS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Other");
}

export function MiniAudioPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  function fmt(s: number) {
    if (!Number.isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); } else { a.play(); }
  }

  return (
    <div className="space-y-0.5">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">Recording</p>
      <audio
        ref={audioRef}
        src={url}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => {
          const d = audioRef.current?.duration ?? 0;
          setDuration(Number.isFinite(d) ? d : 0);
        }}
      />
      <div className="flex items-center gap-1.5">
        <button
          onClick={toggle}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted dark:bg-white/[0.06] hover:bg-muted dark:hover:bg-white/[0.1] text-foreground transition-colors"
        >
          {playing
            ? <span className="flex gap-px"><span className="w-[2px] h-2.5 bg-current rounded-sm" /><span className="w-[2px] h-2.5 bg-current rounded-sm" /></span>
            : <Play className="h-2.5 w-2.5 ml-px" />}
        </button>
        <div
          className="flex-1 h-0.5 rounded-full bg-muted dark:bg-white/[0.1] cursor-pointer"
          onClick={(e) => {
            if (!audioRef.current || !duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
          }}
        >
          <div
            className="h-full rounded-full bg-violet-400"
            style={{ width: duration ? `${(current / duration) * 100}%` : "0%" }}
          />
        </div>
        <span className="text-[9px] tabular-nums text-muted-foreground/70 shrink-0">
          {fmt(current)}{Number.isFinite(duration) && duration > 0 ? ` / ${fmt(duration)}` : ""}
        </span>
      </div>
    </div>
  );
}
