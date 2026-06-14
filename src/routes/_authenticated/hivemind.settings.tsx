import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  User, Brain, Mic, Zap, Eye, MessageSquare, Lightbulb,
  Save, CheckCircle2, DollarSign, Info, Volume2, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import { listHiveMindVoices } from "@/lib/hivemind/hivemind.ai";
import { getHiveMindMode, setHiveMindMode, type HiveMindMode } from "@/lib/hivemind/hivemind.actions";

export const Route = createFileRoute("/_authenticated/hivemind/settings")({
  head: () => ({ meta: [{ title: "HiveMind Settings — Webee" }] }),
  component: HiveMindSettings,
});

// ── Types ──────────────────────────────────────────────────────────────────────
type VoiceSettings = {
  voiceId:     string;
  voiceName:   string;
  speed:       number;
  personality: "professional" | "friendly" | "concise";
  autoPlay:    boolean;
};

const DEFAULT_VOICE: VoiceSettings = {
  voiceId:     "21m00Tcm4TlvDq8ikWAM",
  voiceName:   "Rachel",
  speed:       1.0,
  personality: "friendly",
  autoPlay:    false,
};

const SPEED_OPTIONS = [0.7, 0.85, 1.0, 1.15, 1.3, 1.5];

const MODE_CONFIG: Record<HiveMindMode, {
  icon: React.ElementType; label: string; desc: string;
  color: string; ring: string; bg: string;
}> = {
  observe:   { icon: Eye,           label: "Observe Only",   desc: "View dashboards and briefings only — no AI interaction",     color: "text-slate-400",  ring: "ring-slate-500/30",  bg: "bg-slate-500/10" },
  recommend: { icon: Lightbulb,     label: "Recommend",      desc: "Unlocks AI recommendations and reports",                     color: "text-blue-400",   ring: "ring-blue-500/30",   bg: "bg-blue-500/10" },
  assistant: { icon: MessageSquare, label: "Assistant",       desc: "Full AI chat and voice + task management",                   color: "text-violet-400", ring: "ring-violet-500/30", bg: "bg-violet-500/10" },
  operator:  { icon: Zap,           label: "Operator",        desc: "Propose and approve automated platform actions",             color: "text-amber-400",  ring: "ring-amber-500/30",  bg: "bg-amber-500/10" },
};

const PERSONALITY_OPTIONS = [
  { key: "friendly"     as const, label: "Friendly",      desc: "Warm, natural, conversational — like a smart colleague" },
  { key: "professional" as const, label: "Professional",   desc: "Precise and structured, leads with key numbers" },
  { key: "concise"      as const, label: "Concise",        desc: "3 sentences max — facts first, no padding" },
];

// ── Cost breakdown data ────────────────────────────────────────────────────────
const COST_ROWS = [
  { service: "Speech-to-Text",  provider: "OpenAI Whisper",      cost: "$0.006",  unit: "/ min",   note: "Every turn you speak" },
  { service: "AI Brain",        provider: "GPT-4.1",             cost: "~$0.01",  unit: "/ min",   note: "Estimated — varies with response length" },
  { service: "Text-to-Speech",  provider: "ElevenLabs",          cost: "~$0.04",  unit: "/ min",   note: "~200 chars per response × plan rate" },
  { service: "Total estimate",  provider: "",                     cost: "~$0.05",  unit: "/ min",   note: "Per active voice minute", highlight: true },
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function loadVoiceSettings(): VoiceSettings {
  try {
    const s = localStorage.getItem("hivemind-voice-settings");
    return s ? { ...DEFAULT_VOICE, ...JSON.parse(s) } : DEFAULT_VOICE;
  } catch { return DEFAULT_VOICE; }
}
function saveVoiceSettings(s: VoiceSettings) {
  try { localStorage.setItem("hivemind-voice-settings", JSON.stringify(s)); } catch {}
}
function loadUserName(): string {
  try { return localStorage.getItem("hivemind-user-name") ?? ""; } catch { return ""; }
}
function saveUserName(n: string) {
  try { localStorage.setItem("hivemind-user-name", n); } catch {}
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ icon: Icon, title, desc, children }: {
  icon: React.ElementType; title: string; desc?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[hsl(var(--card))] overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-start gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/15 ring-1 ring-violet-500/20 shrink-0 mt-0.5">
          <Icon className="h-3.5 w-3.5 text-violet-400" />
        </div>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
function HiveMindSettings() {
  const voicesFn  = useServerFn(listHiveMindVoices);
  const modeFn    = useServerFn(getHiveMindMode);
  const setModeFn = useServerFn(setHiveMindMode);
  const qc        = useQueryClient();

  const [voiceSettings, setVoiceSettingsState] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [userName, setUserNameState]            = useState("");
  const [userNameInput, setUserNameInput]       = useState("");
  const [nameSaved, setNameSaved]               = useState(false);
  const [modeSaving, setModeSaving]             = useState(false);

  const { data: voices = [] } = useQuery({
    queryKey: ["hivemind-voices"],
    queryFn:  () => voicesFn().then(r => r.voices ?? []),
    staleTime: 300_000,
  });

  const { data: modeData } = useQuery({
    queryKey: ["hivemind-mode"],
    queryFn:  () => modeFn(),
    staleTime: Infinity,
  });
  const mode: HiveMindMode = modeData?.mode ?? "assistant";

  useEffect(() => {
    setVoiceSettingsState(loadVoiceSettings());
    const n = loadUserName();
    setUserNameState(n);
    setUserNameInput(n);
  }, []);

  function updateVoice(patch: Partial<VoiceSettings>) {
    const updated = { ...voiceSettings, ...patch };
    setVoiceSettingsState(updated);
    saveVoiceSettings(updated);
  }

  function saveName() {
    const trimmed = userNameInput.trim();
    saveUserName(trimmed);
    setUserNameState(trimmed);
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  }

  async function changeMode(m: HiveMindMode) {
    setModeSaving(true);
    try {
      await setModeFn({ data: { mode: m } });
      qc.setQueryData(["hivemind-mode"], { mode: m });
    } finally { setModeSaving(false); }
  }

  const currentVoice = voices.find(v => v.id === voiceSettings.voiceId);

  return (
    <HiveMindShell>
      <div className="max-w-2xl mx-auto px-5 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/20 ring-1 ring-violet-500/30">
            <Settings className="h-4 w-4 text-violet-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold">HiveMind Settings</h1>
            <p className="text-xs text-muted-foreground">Personalise your AI Operations Director</p>
          </div>
        </div>

        {/* ── YOUR PROFILE ── */}
        <Section icon={User} title="Your Profile" desc="HiveMind will use your name in conversation and personalise responses to you.">
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Your first name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={userNameInput}
                  onChange={e => setUserNameInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && saveName()}
                  placeholder="e.g. Alex"
                  className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                />
                <button
                  onClick={saveName}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border transition-all",
                    nameSaved
                      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                      : "border-violet-500/30 bg-violet-500/15 text-violet-300 hover:bg-violet-500/25",
                  )}
                >
                  {nameSaved
                    ? <><CheckCircle2 className="h-3.5 w-3.5" /> Saved</>
                    : <><Save className="h-3.5 w-3.5" /> Save</>
                  }
                </button>
              </div>
              {userName && (
                <p className="text-[11px] text-muted-foreground/60 mt-1.5">
                  HiveMind will greet you as <span className="text-violet-400">{userName}</span> and use your name naturally in conversation.
                </p>
              )}
            </div>
          </div>
        </Section>

        {/* ── HIVEMIND MODE ── */}
        <Section icon={Brain} title="HiveMind Mode" desc="Controls which features and actions HiveMind can perform.">
          <div className="space-y-2">
            {(Object.entries(MODE_CONFIG) as [HiveMindMode, typeof MODE_CONFIG[HiveMindMode]][]).map(([key, cfg]) => {
              const Icon = cfg.icon;
              const active = mode === key;
              return (
                <button
                  key={key}
                  onClick={() => changeMode(key)}
                  disabled={modeSaving}
                  className={cn(
                    "w-full flex items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-all",
                    active
                      ? `${cfg.ring} ${cfg.bg} border-current/20`
                      : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02]",
                  )}
                >
                  <div className={cn("flex h-6 w-6 items-center justify-center rounded-md shrink-0 mt-0.5", cfg.bg)}>
                    <Icon className={cn("h-3.5 w-3.5", cfg.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-xs font-semibold", active ? cfg.color : "text-foreground")}>{cfg.label}</p>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-tight">{cfg.desc}</p>
                  </div>
                  {active && <CheckCircle2 className={cn("h-4 w-4 shrink-0 mt-0.5", cfg.color)} />}
                </button>
              );
            })}
          </div>
        </Section>

        {/* ── VOICE & STYLE ── */}
        <Section icon={Mic} title="Voice & Style" desc="How HiveMind sounds and communicates during live voice sessions.">
          <div className="space-y-5">

            {/* Current voice */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-muted-foreground">Active voice</label>
                {currentVoice && (
                  <span className="text-[11px] text-violet-400 font-medium flex items-center gap-1">
                    <Volume2 className="h-3 w-3" /> {currentVoice.name}
                    <span className="text-muted-foreground/50 capitalize ml-1">({currentVoice.category})</span>
                  </span>
                )}
                {!currentVoice && voices.length === 0 && (
                  <span className="text-[11px] text-muted-foreground/50 italic">No ElevenLabs key configured</span>
                )}
              </div>
              {voices.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto pr-1">
                  {voices.slice(0, 18).map(v => (
                    <button
                      key={v.id}
                      onClick={() => updateVoice({ voiceId: v.id, voiceName: v.name })}
                      className={cn(
                        "text-left px-2.5 py-2 rounded-lg border text-xs transition-all",
                        voiceSettings.voiceId === v.id
                          ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                          : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:text-foreground hover:border-white/[0.15]",
                      )}
                    >
                      <p className="font-medium truncate">{v.name}</p>
                      <p className="text-[10px] opacity-60 capitalize">{v.category}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Speed */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 flex justify-between">
                Speaking speed <span className="text-foreground font-medium">{voiceSettings.speed}×</span>
              </label>
              <div className="flex gap-1.5">
                {SPEED_OPTIONS.map(s => (
                  <button key={s} onClick={() => updateVoice({ speed: s })} className={cn(
                    "flex-1 py-1.5 rounded-md border text-xs transition-all",
                    voiceSettings.speed === s
                      ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                      : "border-white/[0.08] text-muted-foreground hover:text-foreground",
                  )}>{s}×</button>
                ))}
              </div>
            </div>

            {/* Personality */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Communication style</label>
              <div className="space-y-1.5">
                {PERSONALITY_OPTIONS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => updateVoice({ personality: p.key })}
                    className={cn(
                      "w-full flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all",
                      voiceSettings.personality === p.key
                        ? "border-violet-500/30 bg-violet-500/[0.08]"
                        : "border-white/[0.06] hover:border-white/[0.12]",
                    )}
                  >
                    <div className={cn(
                      "h-3.5 w-3.5 rounded-full border-2 shrink-0 mt-0.5",
                      voiceSettings.personality === p.key
                        ? "border-violet-400 bg-violet-400"
                        : "border-white/20",
                    )} />
                    <div>
                      <p className="text-xs font-medium">{p.label}</p>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">{p.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Auto-play */}
            <div className="flex items-center justify-between py-1 border-t border-white/[0.05]">
              <div>
                <p className="text-xs font-medium">Auto-play responses</p>
                <p className="text-[11px] text-muted-foreground/60">Speak each reply automatically in text chat mode</p>
              </div>
              <button
                onClick={() => updateVoice({ autoPlay: !voiceSettings.autoPlay })}
                className={cn("w-9 h-5 rounded-full relative transition-all", voiceSettings.autoPlay ? "bg-violet-500" : "bg-white/[0.1]")}
              >
                <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", voiceSettings.autoPlay ? "left-[18px]" : "left-0.5")} />
              </button>
            </div>
          </div>
        </Section>

        {/* ── COST BREAKDOWN ── */}
        <Section icon={DollarSign} title="Session Cost Breakdown" desc="Estimated cost per minute of an active HiveMind voice session.">
          <div className="space-y-3">
            <div className="rounded-lg border border-white/[0.06] overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">Service</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium hidden sm:table-cell">Provider</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {COST_ROWS.map((row, i) => (
                    <tr
                      key={i}
                      className={cn(
                        "border-b border-white/[0.04] last:border-0",
                        row.highlight && "bg-violet-500/[0.04] border-t border-violet-500/10",
                      )}
                    >
                      <td className="px-3 py-2.5">
                        <p className={cn("font-medium", row.highlight ? "text-violet-300" : "text-foreground")}>{row.service}</p>
                        <p className="text-muted-foreground/50 text-[10px] mt-0.5">{row.note}</p>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">{row.provider}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={cn("font-semibold", row.highlight ? "text-violet-300" : "text-foreground")}>{row.cost}</span>
                        <span className="text-muted-foreground/50 ml-0.5">{row.unit}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <Info className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                Cost only applies while Live Voice is active. Text chat is significantly cheaper (~$0.002/message). ElevenLabs TTS cost depends on your plan — Starter is $5/mo for 10k chars; Creator is $22/mo for 100k chars.
              </p>
            </div>
          </div>
        </Section>

      </div>
    </HiveMindShell>
  );
}
