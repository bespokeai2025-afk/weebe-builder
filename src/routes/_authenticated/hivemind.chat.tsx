import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Brain, Mic, MicOff, Send, Settings2,
  Loader2, Radio, Square, Play, Pause,
  X, User, Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import {
  getHiveMindAIResponse, getHiveMindMorningBriefing,
  getHiveMindTTS, listHiveMindVoices, getHiveMindSystemContext,
} from "@/lib/hivemind/hivemind.ai";

export const Route = createFileRoute("/_authenticated/hivemind/chat")({
  head: () => ({ meta: [{ title: "HiveMind Assistant — Webee" }] }),
  component: HiveMindChat,
});

// ── Types ──────────────────────────────────────────────────────────────────────
type Role = "user" | "hivemind";
type ChatMessage = {
  id:          string;
  role:        Role;
  content:     string;
  ts:          Date;
  audioBase64?: string | null;
};
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
  personality: "professional",
  autoPlay:    false,
};
const SPEED_OPTIONS = [0.7, 0.85, 1.0, 1.15, 1.3, 1.5];
const PERSONALITIES = ["professional", "friendly", "concise"] as const;
const SUGGESTED = [
  "What's happened today?",
  "Which agents need attention?",
  "How is my pipeline performing?",
  "Are any campaigns stalling?",
  "Show me inactive leads",
];

// ── Hint library ───────────────────────────────────────────────────────────────
type HintGroup = { label: string; questions: { q: string; desc: string }[] };

const HINT_GROUPS: HintGroup[] = [
  {
    label: "Today",
    questions: [
      { q: "What should I focus on today?",       desc: "Executive briefing with your top priorities ranked by urgency." },
      { q: "What are my top 3 priorities?",        desc: "HiveMind picks the three highest-impact actions right now." },
      { q: "What needs attention right now?",      desc: "Flags issues and gaps across all your systems." },
      { q: "What changed since yesterday?",        desc: "Compares today's data against yesterday for quick deltas." },
      { q: "What is the biggest opportunity today?", desc: "Surfaces the single highest-value action you can take now." },
    ],
  },
  {
    label: "Sales",
    questions: [
      { q: "Which leads should I contact first?",          desc: "Scores and ranks leads by conversion likelihood." },
      { q: "Which opportunities are closest to converting?", desc: "Shows pipeline deals that are nearly ready to close." },
      { q: "Where am I losing potential customers?",        desc: "Identifies the biggest drop-off points in your funnel." },
      { q: "What should my sales team do next?",            desc: "Generates a prioritised action list for your team." },
      { q: "Which pipeline stage needs attention?",         desc: "Highlights the bottleneck stage slowing your pipeline." },
    ],
  },
  {
    label: "Marketing",
    questions: [
      { q: "How do I get more customers?",           desc: "GrowthMind analyses your services, leads and channels." },
      { q: "What campaign should I run next?",       desc: "Recommends the best next campaign based on your data." },
      { q: "Which service should I promote right now?", desc: "Picks the highest-margin or highest-demand offering." },
      { q: "What audience should I target?",         desc: "Builds a targeting profile from your best leads." },
      { q: "What does GrowthMind recommend?",        desc: "Full GrowthMind advisory report for your business." },
    ],
  },
  {
    label: "Calls",
    questions: [
      { q: "What are my call results this week?",  desc: "Summary of call volume, duration and outcomes." },
      { q: "Why are calls not converting?",        desc: "Analyses call transcripts for friction patterns." },
      { q: "Which agent is performing best?",      desc: "Compares agents by conversion rate and call score." },
      { q: "What call script should I improve?",   desc: "Finds the weakest part of your current script." },
      { q: "Which calls need follow-up?",          desc: "Lists calls with no follow-up action taken." },
    ],
  },
  {
    label: "Leads",
    questions: [
      { q: "Where are my leads coming from?",           desc: "Breaks down lead sources by volume and quality." },
      { q: "Which lead source is performing best?",     desc: "Ranks sources by conversion rate and cost-per-lead." },
      { q: "Which leads are uncontacted?",              desc: "Lists leads with no outreach in the last 7 days." },
      { q: "Which leads should be qualified?",          desc: "Flags leads that are warm but not yet scored." },
      { q: "How can I increase lead quality?",          desc: "Recommends changes to your intake and targeting." },
    ],
  },
  {
    label: "Campaigns",
    questions: [
      { q: "Which campaigns are working?",                  desc: "Shows active campaigns ranked by ROI and engagement." },
      { q: "Which campaign should I pause?",                desc: "Flags campaigns with poor performance metrics." },
      { q: "Create a campaign proposal for me.",            desc: "GrowthMind drafts a full campaign brief for your business." },
      { q: "Create a video ad campaign.",                   desc: "Generates a video campaign strategy with scripts." },
      { q: "Create a WhatsApp follow-up campaign.",         desc: "Builds a WhatsApp sequence for warm leads." },
    ],
  },
  {
    label: "System Health",
    questions: [
      { q: "What needs fixing?",                      desc: "SystemMind surfaces all critical and high-priority issues." },
      { q: "Are any integrations broken?",            desc: "Checks all connected providers for errors or expired keys." },
      { q: "Is my system ready to go live?",          desc: "Full pre-launch checklist across all modules." },
      { q: "What does SystemMind recommend?",         desc: "Complete SystemMind health report and action plan." },
      { q: "Are my webhooks working?",                desc: "Verifies webhook endpoints are active and receiving data." },
    ],
  },
  {
    label: "Costs & Profit",
    questions: [
      { q: "What is costing me the most?",             desc: "AccountsMind ranks your biggest operational expenses." },
      { q: "Which clients are least profitable?",      desc: "Shows clients with high effort and low revenue." },
      { q: "Are any providers costing too much?",      desc: "Compares provider costs against usage and alternatives." },
      { q: "What does AccountsMind recommend?",        desc: "Full financial advisory from AccountsMind." },
      { q: "What should I charge more for?",           desc: "Identifies underpriced services based on demand." },
    ],
  },
  {
    label: "Team & Users",
    questions: [
      { q: "Who needs access?",                  desc: "Lists users with pending invites or permission requests." },
      { q: "Which users are active?",            desc: "Shows login activity and feature usage by team member." },
      { q: "Should I add more seats?",           desc: "Checks capacity against current workload and growth." },
      { q: "Which permissions need review?",     desc: "Flags users with over-broad or stale permissions." },
      { q: "Are there any admin requests?",      desc: "Shows open admin tasks and approval items." },
    ],
  },
  {
    label: "Setup",
    questions: [
      { q: "What should I set up next?",              desc: "Onboarding guide tailored to your current workspace state." },
      { q: "What is missing from my workspace?",      desc: "Gaps check across integrations, agents and data." },
      { q: "Is my Business DNA complete?",            desc: "Checks your business profile for missing fields." },
      { q: "What knowledge base should I upload?",    desc: "Recommends knowledge base content for your agents." },
      { q: "Which providers should I connect?",       desc: "Lists unconnected integrations that would add value." },
    ],
  },
  {
    label: "Agents & Workflows",
    questions: [
      { q: "Create a receptionist workflow.",           desc: "Builds an inbound call handling agent workflow." },
      { q: "Create a rebooking workflow.",              desc: "Designs a follow-up workflow for lapsed bookings." },
      { q: "Check my agent before going live.",         desc: "Runs a pre-live audit on your selected agent." },
      { q: "What post-call fields should I extract?",  desc: "Recommends data extraction fields for your use case." },
      { q: "What agent workflow should I improve?",    desc: "Scores all workflows and flags the weakest one." },
    ],
  },
  {
    label: "Growth Strategy",
    questions: [
      { q: "Create a 30-day growth plan.",                desc: "GrowthMind builds a full 30-day action plan." },
      { q: "Create a 90-day marketing strategy.",         desc: "Multi-channel strategy with milestones and targets." },
      { q: "What is my highest-opportunity service?",     desc: "Identifies which service has the best growth potential." },
      { q: "What should WEBEE market next?",              desc: "Recommends the next high-impact marketing push." },
      { q: "Create a full multi-channel strategy.",       desc: "Voice + WhatsApp + email + ads strategy in one plan." },
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmtTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function loadVoiceSettings(): VoiceSettings {
  try {
    const s = localStorage.getItem("hivemind-voice-settings");
    return s ? { ...DEFAULT_VOICE, ...JSON.parse(s) } : DEFAULT_VOICE;
  } catch { return DEFAULT_VOICE; }
}
function saveVoiceSettings(s: VoiceSettings) {
  try { localStorage.setItem("hivemind-voice-settings", JSON.stringify(s)); } catch {}
}

// ── Markdown-lite renderer ─────────────────────────────────────────────────────
function renderInline(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, j) =>
    p.startsWith("**") && p.endsWith("**")
      ? (
        <mark
          key={j}
          className="font-semibold not-italic px-[3px] py-px rounded-[3px] text-amber-200 bg-amber-400/20 border border-amber-400/25"
          style={{ textDecorationLine: "none" }}
        >
          {p.slice(2, -2)}
        </mark>
      )
      : <span key={j}>{p}</span>
  );
}

function isKeyLine(line: string) {
  const t = line.replace(/\*\*[^*]+\*\*/g, "x");
  return (
    /^(action|key|important|note|critical|priority|next step|do this|remember)[\s:]/i.test(t) ||
    line.startsWith("→ ") ||
    line.startsWith("! ")  ||
    line.startsWith("⚡")  ||
    line.startsWith("✅")  ||
    line.startsWith("🎯")
  );
}

function MessageText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="text-sm leading-relaxed space-y-1">
      {lines.map((line, i) => {
        const isBullet = line.startsWith("• ") || line.startsWith("- ");
        const key      = isKeyLine(line);
        const content  = isBullet ? renderInline(line.slice(2)) : renderInline(line);

        if (key) {
          return (
            <div key={i} className="flex gap-2 pl-2 border-l-2 border-amber-400/50 bg-amber-400/[0.06] rounded-r-md py-0.5 pr-1">
              <span className="shrink-0 text-amber-400 text-[11px] mt-0.5 font-bold">★</span>
              <span>{content}</span>
            </div>
          );
        }
        if (isBullet) {
          return (
            <div key={i} className="flex gap-1.5">
              <span className="text-violet-400 shrink-0 mt-0.5">•</span>
              <span>{content}</span>
            </div>
          );
        }
        return <div key={i}>{content}</div>;
      })}
    </div>
  );
}

// ── Audio player ──────────────────────────────────────────────────────────────
function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const play = useCallback((id: string, base64: string, speed: number) => {
    audioRef.current?.pause();
    const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
    audio.playbackRate = speed;
    audioRef.current = audio;
    setPlayingId(id);
    audio.play().catch(() => {});
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
  }, []);
  const stop = useCallback(() => { audioRef.current?.pause(); setPlayingId(null); }, []);
  return { playingId, play, stop };
}

// ── el-voice-relay hook ────────────────────────────────────────────────────────
function useElRelay(
  onTranscript: (role: Role, text: string) => void,
  voiceSettings: VoiceSettings,
) {
  const wsRef           = useRef<WebSocket | null>(null);
  const audioCtxRef     = useRef<AudioContext | null>(null);
  const nextPlayRef     = useRef(0);
  const wsPingRef       = useRef<ReturnType<typeof setInterval>>();
  const streamRef       = useRef<MediaStream | null>(null);
  const lastAgentText   = useRef<string>("");
  const quotaFallback   = useRef(false);
  const [state, setState]  = useState<"idle"|"connecting"|"live"|"error">("idle");
  const [error, setError]  = useState<string | null>(null);

  const speakViaBrowser = useCallback((text: string, ws: WebSocket) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const utt = new SpeechSynthesisUtterance(text.slice(0, 500));
    utt.rate = 1.05;
    utt.onend = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "playback.done" }));
      }
    };
    utt.onerror = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "playback.done" }));
      }
    };
    synth.speak(utt);
  }, []);

  const scheduleChunk = useCallback(async (b64: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx || !b64) return;
    if (ctx.state !== "running") {
      try { await ctx.resume(); } catch { return; }
    }
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const i16 = new Int16Array(bytes.buffer);
    if (!i16.length) return;
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const buf = ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    const startAt = nextPlayRef.current > now ? nextPlayRef.current : now + 0.05;
    src.start(startAt);
    nextPlayRef.current = startAt + buf.duration;
  }, []);

  const start = useCallback(async (systemPrompt: string, beginMessage: string) => {
    if (wsRef.current) return;
    setState("connecting");
    setError(null);
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProto}//${window.location.host}/api/el-voice-relay`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    const audioCtx = new AudioContext({ sampleRate: 24000 });
    audioCtxRef.current = audioCtx;
    nextPlayRef.current = 0;
    // Must set onopen BEFORE any await
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "session.init",
        voiceId: voiceSettings.voiceId,
        systemPrompt,
        beginMessage,
        model: "gpt-4.1",
      }));
      wsPingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 5000);
    };
    ws.onmessage = async (ev) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data as string) as Record<string, unknown>; } catch { return; }
      if (msg.type === "relay.connected") {
        setState("live");
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1, sampleRate: 24000 },
          });
          streamRef.current = stream;
          const WORKLET = `class P extends AudioWorkletProcessor{constructor(){super();this._b=[];this._n=0;}process(i){const c=i[0]?.[0];if(!c)return true;for(let i=0;i<c.length;i++)this._b.push(c[i]);this._n+=c.length;if(this._n>=1200){const o=new Int16Array(this._n);for(let i=0;i<this._n;i++)o[i]=Math.max(-32768,Math.min(32767,Math.round(this._b[i]*32767)));this.port.postMessage(o.buffer,[o.buffer]);this._b=[];this._n=0;}return true;}}registerProcessor('pcm16-cap',P);`;
          const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
          await audioCtx.audioWorklet.addModule(url);
          const micSrc = audioCtx.createMediaStreamSource(stream);
          const worklet = new AudioWorkletNode(audioCtx, "pcm16-cap");
          worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
            if (ws.readyState === WebSocket.OPEN) {
              const bytes = new Uint8Array(e.data);
              let bin = "";
              for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
              ws.send(JSON.stringify({ type: "audio.chunk", data: btoa(bin) }));
            }
          };
          micSrc.connect(worklet);
        } catch { setError("Microphone access denied"); setState("error"); }
      }
      if (msg.type === "audio.delta" && typeof msg.data === "string") {
        if (!quotaFallback.current) scheduleChunk(msg.data);
      }
      if (msg.type === "transcript" && msg.role === "user"  && msg.text) onTranscript("user",     String(msg.text));
      if (msg.type === "transcript" && msg.role === "agent" && msg.text) {
        lastAgentText.current = String(msg.text);
        onTranscript("hivemind", String(msg.text));
      }
      if (msg.type === "response.done") {
        if (quotaFallback.current) {
          // Browser SpeechSynthesis handles playback — already sends playback.done on end.
          // If there's no pending speech (e.g. begin message was silent), release immediately.
          if (!window.speechSynthesis?.speaking) {
            ws.send(JSON.stringify({ type: "playback.done" }));
          }
        } else {
          // Tell the server when the browser has actually finished playing all
          // queued audio (not just when the last chunk arrived over the network).
          const ctx = audioCtxRef.current;
          if (ctx) {
            const remainingMs = Math.max(0, (nextPlayRef.current - ctx.currentTime) * 1000) + 300;
            setTimeout(() => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: "playback.done" }));
              }
            }, remainingMs);
          } else {
            ws.send(JSON.stringify({ type: "playback.done" }));
          }
        }
      }
      if (msg.type === "relay.error" && msg.message) {
        const errMsg = String(msg.message);
        if (errMsg.includes("quota_exceeded") || errMsg.includes("quota of")) {
          // Switch permanently to browser TTS for this session and speak the last response.
          if (!quotaFallback.current) {
            quotaFallback.current = true;
            setError("ElevenLabs quota reached — switched to browser voice automatically.");
          }
          if (lastAgentText.current) speakViaBrowser(lastAgentText.current, ws);
          return;
        }
        const friendly = errMsg.includes("paid_plan_required") || errMsg.includes("payment_required")
          ? "Voice playback requires an ElevenLabs paid plan for this voice. Open Voice Settings and select a voice from your own ElevenLabs library."
          : errMsg.trimStart().startsWith("<") || errMsg.length > 300
            ? "Voice error — please refresh the page and try again."
            : `Voice error: ${errMsg.slice(0, 150)}`;
        setError(friendly);
      }
    };
    ws.onerror = () => { setError("Connection failed"); setState("error"); };
    ws.onclose = () => { setState("idle"); };
  }, [voiceSettings.voiceId, scheduleChunk, onTranscript, speakViaBrowser]);

  const stop = useCallback(() => {
    clearInterval(wsPingRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    nextPlayRef.current = 0;
    setState("idle");
  }, []);

  useEffect(() => () => { stop(); }, [stop]);
  return { state, error, start, stop };
}

// ── Voice settings panel ───────────────────────────────────────────────────────
function VoiceSettingsPanel({ settings, onChange, onClose, voices }: {
  settings: VoiceSettings;
  onChange: (s: VoiceSettings) => void;
  onClose:  () => void;
  voices:   { id: string; name: string; category: string }[];
}) {
  return (
    <div className="border-b border-white/[0.07] bg-[hsl(var(--card))] px-5 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.1em]">Voice Settings</p>
        <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      </div>

      {/* Voice selector */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Voice</label>
        {voices.length === 0
          ? <p className="text-[11px] text-muted-foreground/60 italic">Add an ElevenLabs API key in Settings → Integrations to unlock voices</p>
          : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto pr-1">
              {voices.slice(0, 18).map(v => (
                <button
                  key={v.id}
                  onClick={() => onChange({ ...settings, voiceId: v.id, voiceName: v.name })}
                  className={cn(
                    "text-left px-2.5 py-1.5 rounded-lg border text-xs transition-all",
                    settings.voiceId === v.id
                      ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                      : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:text-foreground",
                  )}
                >
                  <p className="font-medium truncate">{v.name}</p>
                  <p className="text-[10px] opacity-60 capitalize">{v.category}</p>
                </button>
              ))}
            </div>
          )
        }
      </div>

      {/* Speed */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 flex justify-between">
          Speed <span className="text-foreground font-medium">{settings.speed}×</span>
        </label>
        <div className="flex gap-1.5">
          {SPEED_OPTIONS.map(s => (
            <button key={s} onClick={() => onChange({ ...settings, speed: s })} className={cn(
              "flex-1 py-1 rounded-md border text-xs transition-all",
              settings.speed === s ? "border-violet-500/40 bg-violet-500/15 text-violet-300" : "border-white/[0.08] text-muted-foreground hover:text-foreground",
            )}>{s}×</button>
          ))}
        </div>
      </div>

      {/* Personality */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Personality</label>
        <div className="flex gap-1.5">
          {PERSONALITIES.map(p => (
            <button key={p} onClick={() => onChange({ ...settings, personality: p })} className={cn(
              "flex-1 py-1.5 rounded-lg border text-xs capitalize transition-all",
              settings.personality === p ? "border-violet-500/40 bg-violet-500/15 text-violet-300" : "border-white/[0.08] text-muted-foreground hover:text-foreground",
            )}>{p}</button>
          ))}
        </div>
      </div>

      {/* Auto-play toggle */}
      <div className="flex items-center justify-between pt-1 border-t border-white/[0.05]">
        <div>
          <p className="text-xs font-medium">Auto-play responses</p>
          <p className="text-[11px] text-muted-foreground">Speak each reply automatically</p>
        </div>
        <button
          onClick={() => onChange({ ...settings, autoPlay: !settings.autoPlay })}
          className={cn("w-9 h-5 rounded-full relative transition-all", settings.autoPlay ? "bg-violet-500" : "bg-white/[0.1]")}
        >
          <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", settings.autoPlay ? "left-[18px]" : "left-0.5")} />
        </button>
      </div>
    </div>
  );
}

// ── Hint panel ────────────────────────────────────────────────────────────────
function HintPanel({ onSelect, onClose }: { onSelect: (q: string) => void; onClose: () => void }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const group = HINT_GROUPS[activeIdx];
  return (
    <div className="border-t border-white/[0.07] bg-[hsl(var(--background))] flex flex-col max-h-72">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.05] shrink-0">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5 text-violet-400" />
          <span className="text-[11px] font-semibold text-violet-300">Suggested Questions</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* Category tabs */}
      <div className="flex overflow-x-auto gap-1 px-3 py-1.5 border-b border-white/[0.04] shrink-0 scrollbar-none" style={{ scrollbarWidth: "none" }}>
        {HINT_GROUPS.map((g, i) => (
          <button
            key={g.label}
            onClick={() => setActiveIdx(i)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-all",
              activeIdx === i
                ? "bg-violet-500/20 text-violet-300"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>
      {/* Questions */}
      <div className="overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
        {group.questions.map(({ q, desc }) => (
          <button
            key={q}
            onClick={() => { onSelect(q); onClose(); }}
            className="text-left rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-violet-500/[0.08] hover:border-violet-500/20 px-3 py-2 transition-all group"
          >
            <p className="text-xs font-medium group-hover:text-violet-300 transition-colors">{q}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function MessageBubble({ msg, onPlay, onStop, isPlaying, ttsLoading }: {
  msg:       ChatMessage;
  onPlay:    (id: string, b64: string) => void;
  onStop:    () => void;
  isPlaying: boolean;
  ttsLoading:boolean;
}) {
  const isHive = msg.role === "hivemind";
  const isEmpty = msg.content === "";
  return (
    <div className={cn("flex gap-2.5 max-w-[85%]", isHive ? "self-start" : "self-end flex-row-reverse")}>
      <div className={cn(
        "h-7 w-7 shrink-0 rounded-full flex items-center justify-center mt-0.5",
        isHive ? "bg-violet-500/20 ring-1 ring-violet-500/30" : "bg-white/[0.08]",
      )}>
        {isHive ? <Brain className="h-3.5 w-3.5 text-violet-400" /> : <User className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>

      <div className={cn("flex flex-col gap-0.5", isHive ? "items-start" : "items-end")}>
        <div className={cn(
          "rounded-xl px-3.5 py-2.5",
          isHive ? "bg-violet-500/[0.08] border border-violet-500/15" : "bg-white/[0.07] border border-white/[0.08]",
        )}>
          {isEmpty
            ? <div className="flex gap-1 items-center py-1">
                {[0,150,300].map(d => (
                  <span key={d} className="h-1.5 w-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
            : <MessageText text={msg.content} />
          }
        </div>

        <div className={cn("flex items-center gap-1.5", isHive ? "flex-row" : "flex-row-reverse")}>
          <span className="text-[10px] text-muted-foreground/50">{fmtTime(msg.ts)}</span>
          {isHive && !isEmpty && (
            <button
              onClick={() => isPlaying ? onStop() : msg.audioBase64 && onPlay(msg.id, msg.audioBase64)}
              disabled={ttsLoading && !msg.audioBase64}
              className="text-muted-foreground/40 hover:text-violet-400 transition-colors disabled:opacity-30"
            >
              {ttsLoading && !msg.audioBase64
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
function HiveMindChat() {
  const aiFn       = useServerFn(getHiveMindAIResponse);
  const briefingFn = useServerFn(getHiveMindMorningBriefing);
  const ttsFn      = useServerFn(getHiveMindTTS);
  const voicesFn   = useServerFn(listHiveMindVoices);
  const contextFn  = useServerFn(getHiveMindSystemContext);

  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [input, setInput]           = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const [voices, setVoices]               = useState<{ id: string; name: string; category: string }[]>([]);
  const [isRecording, setIsRecording]     = useState(false);
  const [mode, setMode]                   = useState<"chat"|"live">("chat");
  const [ttsLoadingId, setTtsLoadingId]   = useState<string | null>(null);
  const [liveError, setLiveError]         = useState<string | null>(null);
  const [hintsOpen, setHintsOpen]         = useState(false);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const recognRef  = useRef<any>(null);
  const historyRef = useRef<{ role: "user"|"assistant"; content: string }[]>([]);

  const { playingId, play: playAudio, stop: stopAudio } = useAudioPlayer();

  const handleLiveTranscript = useCallback((role: Role, text: string) => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === role && Date.now() - last.ts.getTime() < 3000) {
        return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: text } : m);
      }
      return [...prev, { id: uid(), role, content: text, ts: new Date() }];
    });
  }, []);

  const relay = useElRelay(handleLiveTranscript, voiceSettings);

  const [userName, setUserName] = useState("");
  useEffect(() => {
    try { setUserName(localStorage.getItem("hivemind-user-name") ?? ""); } catch {}
  }, []);

  // Load prefs + voices on mount
  useEffect(() => {
    setVoiceSettings(loadVoiceSettings());
    voicesFn().then(r => {
      if (r.voices?.length) {
        setVoices(r.voices);
        // Auto-select first library voice if still on the default (Rachel requires paid plan)
        setVoiceSettings(prev => {
          if (prev.voiceId === DEFAULT_VOICE.voiceId) {
            const first = r.voices[0];
            const updated = { ...prev, voiceId: first.id, voiceName: first.name };
            saveVoiceSettings(updated);
            return updated;
          }
          return prev;
        });
      }
    }).catch(() => {});
  }, []);

  // Morning briefing
  useQuery({
    queryKey: ["hivemind-briefing"],
    queryFn: async () => {
      const r = await briefingFn();
      const msg: ChatMessage = { id: "briefing", role: "hivemind", content: r.briefing, ts: new Date() };
      setMessages([msg]);
      return r;
    },
    staleTime: Infinity,
    retry: 1,
    throwOnError: false,
  });

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function updateVoiceSettings(s: VoiceSettings) { setVoiceSettings(s); saveVoiceSettings(s); }

  // TTS fetch + play
  async function fetchAndPlayTTS(msg: ChatMessage) {
    if (msg.audioBase64) { playAudio(msg.id, msg.audioBase64, voiceSettings.speed); return; }
    setTtsLoadingId(msg.id);
    try {
      const r = await ttsFn({ data: { text: msg.content.slice(0, 800), voiceId: voiceSettings.voiceId, speed: voiceSettings.speed } });
      if (r.audioBase64) {
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, audioBase64: r.audioBase64 } : m));
        playAudio(msg.id, r.audioBase64, voiceSettings.speed);
      }
    } finally { setTtsLoadingId(null); }
  }

  // Send message
  async function sendMessage(query: string) {
    if (!query.trim() || isThinking) return;
    const userMsg: ChatMessage = { id: uid(), role: "user", content: query.trim(), ts: new Date() };
    const placeholder: ChatMessage = { id: uid(), role: "hivemind", content: "", ts: new Date() };
    setMessages(prev => [...prev, userMsg, placeholder]);
    historyRef.current.push({ role: "user", content: query.trim() });
    setInput("");
    setIsThinking(true);
    try {
      const r = await aiFn({ data: { query: query.trim(), history: historyRef.current.slice(-10), personality: voiceSettings.personality, userName } });
      historyRef.current.push({ role: "assistant", content: r.response });
      const finalMsg: ChatMessage = { ...placeholder, content: r.response, ts: new Date() };
      setMessages(prev => prev.map(m => m.id === placeholder.id ? finalMsg : m));
      if (voiceSettings.autoPlay) setTimeout(() => fetchAndPlayTTS(finalMsg), 200);
    } catch (e: any) {
      setMessages(prev => prev.map(m => m.id === placeholder.id
        ? { ...m, content: `Sorry, I couldn't respond: ${e.message ?? "unknown error"}` } : m));
    } finally { setIsThinking(false); }
  }

  // Web Speech API
  function toggleRecording() {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition is not supported in this browser. Try Chrome."); return; }
    if (isRecording) { recognRef.current?.abort(); setIsRecording(false); return; }
    const r = new SR();
    recognRef.current = r;
    r.continuous = false; r.interimResults = false; r.lang = "en-US";
    r.onstart  = () => setIsRecording(true);
    r.onend    = () => setIsRecording(false);
    r.onerror  = () => setIsRecording(false);
    r.onresult = (e: any) => {
      const t = e.results[0][0].transcript as string;
      setInput(t);
      setTimeout(() => sendMessage(t), 100);
    };
    r.start();
  }

  // Live relay toggle
  async function toggleLive() {
    if (mode === "live") { relay.stop(); setMode("chat"); setLiveError(null); return; }
    setMode("live"); setLiveError(null);
    try {
      const ctx = await contextFn({ data: { personality: voiceSettings.personality, voiceId: voiceSettings.voiceId, userName } });
      if (!ctx.hasEL) {
        setLiveError("ElevenLabs key required for live voice — add it in Settings → Integrations.");
        setMode("chat"); return;
      }
      await relay.start(ctx.systemPrompt, ctx.beginMessage);
    } catch (e: any) {
      const raw = String(e.message ?? "");
      const friendly = raw.trimStart().startsWith("<") || raw.length > 300
        ? "Connection error — please refresh the page and try again."
        : raw || "Could not start live session";
      setLiveError(friendly);
      setMode("chat");
    }
  }

  const liveActive  = relay.state === "live";
  const connecting  = relay.state === "connecting";
  const errMsg      = liveError ?? relay.error;

  return (
    <HiveMindShell>
      {/* ── STICKY HEADER ── */}
      <div className="sticky top-0 z-20 border-b border-white/[0.07] bg-[hsl(var(--background))]/95 backdrop-blur-sm px-5 py-3 flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 ring-1 ring-violet-500/30 shrink-0">
          <Brain className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">HiveMind Assistant</p>
          <p className="text-[11px] text-muted-foreground">
            {liveActive ? "🔴 Live voice active — speak naturally" : connecting ? "Connecting…" : "Ask anything about your platform"}
          </p>
        </div>

        {/* Live voice toggle */}
        <button
          onClick={toggleLive}
          disabled={connecting}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-all",
            liveActive
              ? "bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/20"
              : "bg-white/[0.04] text-muted-foreground border-white/[0.08] hover:text-foreground",
          )}
        >
          {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
          {liveActive ? "End Live" : "Live Voice"}
        </button>

        <button
          onClick={() => setSettingsOpen(p => !p)}
          className={cn("p-1.5 rounded-lg transition-colors", settingsOpen ? "bg-white/[0.06] text-violet-400" : "hover:bg-white/[0.06] text-muted-foreground")}
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>

      {/* ── SETTINGS PANEL (below header) ── */}
      {settingsOpen && (
        <VoiceSettingsPanel
          settings={voiceSettings}
          onChange={updateVoiceSettings}
          onClose={() => setSettingsOpen(false)}
          voices={voices}
        />
      )}

      {/* ── ERROR BANNER ── */}
      {errMsg && (
        <div className="mx-5 mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.04] px-3 py-2 text-xs text-red-400 flex items-center gap-2">
          <X className="h-3.5 w-3.5 shrink-0" />{errMsg}
          <button onClick={() => setLiveError(null)} className="ml-auto text-red-400/60 hover:text-red-400"><X className="h-3 w-3" /></button>
        </div>
      )}

      {/* ── MESSAGES ── */}
      <div className="px-5 py-4 flex flex-col gap-3 pb-2">

        {/* Loading state */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="h-14 w-14 rounded-2xl bg-violet-500/15 ring-1 ring-violet-500/25 flex items-center justify-center">
              <Brain className="h-7 w-7 text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-semibold">HiveMind is ready</p>
              <p className="text-xs text-muted-foreground mt-1">Loading your morning briefing…</p>
            </div>
            <Loader2 className="h-4 w-4 animate-spin text-violet-400/50" />
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onPlay={(id, b64) => playAudio(id, b64, voiceSettings.speed)}
            onStop={stopAudio}
            isPlaying={playingId === msg.id}
            ttsLoading={ttsLoadingId === msg.id}
          />
        ))}

        {/* Suggested chips — shown after briefing, before first user message */}
        {messages.length === 1 && messages[0].role === "hivemind" && (
          <div className="flex flex-wrap gap-1.5 ml-9 mt-1">
            {SUGGESTED.map(s => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                className="rounded-full border border-violet-500/20 bg-violet-500/[0.06] px-3 py-1 text-xs text-violet-300 hover:bg-violet-500/15 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Live mode status card */}
        {mode === "live" && (
          <div className={cn(
            "ml-9 rounded-xl border px-4 py-3 flex items-center gap-3",
            liveActive ? "border-red-500/20 bg-red-500/[0.04]" : "border-white/[0.07] bg-white/[0.02]",
          )}>
            {liveActive ? (
              <>
                <div className="relative flex h-3 w-3 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-red-300">Live session active</p>
                  <p className="text-[11px] text-muted-foreground">Speak naturally — HiveMind is listening</p>
                </div>
                <button onClick={toggleLive} className="flex items-center gap-1 text-xs text-red-400 border border-red-500/30 rounded-lg px-2.5 py-1.5 hover:bg-red-500/10 transition-all">
                  <Square className="h-3 w-3" /> End
                </button>
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-violet-400 shrink-0" />
                <p className="text-xs text-muted-foreground">Connecting to voice relay…</p>
              </>
            )}
          </div>
        )}

        <div ref={bottomRef} className="h-1" />
      </div>

      {/* ── STICKY INPUT BAR (chat mode only) ── */}
      {mode === "chat" && (
        <div className="sticky bottom-0 z-20 bg-[hsl(var(--background))]/95 backdrop-blur-sm">
          {/* Hint panel — slides in above the input row */}
          {hintsOpen && (
            <HintPanel
              onSelect={q => { setInput(q); setHintsOpen(false); }}
              onClose={() => setHintsOpen(false)}
            />
          )}

          <div className="border-t border-white/[0.07] px-4 py-3">
            <div className="flex items-end gap-2">
              {/* Mic */}
              <button
                onClick={toggleRecording}
                title={isRecording ? "Stop recording" : "Speak your question"}
                className={cn(
                  "h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 transition-all",
                  isRecording
                    ? "bg-red-500/20 border-red-500/40 text-red-400 animate-pulse"
                    : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.06]",
                )}
              >
                {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>

              {/* Text input */}
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                placeholder={isRecording ? "Listening…" : "Ask HiveMind anything…"}
                rows={1}
                disabled={isThinking}
                className="flex-1 resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 disabled:opacity-60 max-h-32 leading-relaxed"
                style={{ scrollbarWidth: "none" }}
              />

              {/* Hint / Suggested questions toggle */}
              <button
                onClick={() => setHintsOpen(p => !p)}
                title="Suggested questions"
                className={cn(
                  "h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 transition-all",
                  hintsOpen
                    ? "border-violet-500/40 bg-violet-500/15 text-violet-400"
                    : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.06]",
                )}
              >
                <Lightbulb className="h-4 w-4" />
              </button>

              {/* Send */}
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isThinking}
                className="h-9 w-9 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 flex items-center justify-center shrink-0 transition-all"
              >
                {isThinking ? <Loader2 className="h-4 w-4 text-white animate-spin" /> : <Send className="h-4 w-4 text-white" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </HiveMindShell>
  );
}
