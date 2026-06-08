import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useOnboarding } from "./useOnboarding";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Loader2,
  Mic,
  Phone,
  PhoneCall,
  Rocket,
  X,
  Zap,
} from "lucide-react";

/* ─── step config ───────────────────────────────────────────────── */

type Side = "center" | "left" | "right" | "bottom" | "top";

interface StepConfig {
  route: string;
  anchor: string | null;
  side: Side;
  emoji: string;
  label: string;
  hint: string;           // small area label shown under spotlight
}

const STEPS: StepConfig[] = [
  {
    route: "/builder",
    anchor: null,
    side: "center",
    emoji: "🛠️",
    label: "Build Strategy",
    hint: "Canvas workspace",
  },
  {
    route: "/builder",
    anchor: "right-panel",
    side: "left",
    emoji: "🎙️",
    label: "Voice Setup",
    hint: "Agent Settings panel →",
  },
  {
    route: "/builder",
    anchor: null,
    side: "center",
    emoji: "🔐",
    label: "Admin Verification",
    hint: "Compliance check",
  },
  {
    route: "/settings/calendar",
    anchor: "cal-connect",
    side: "right",
    emoji: "📅",
    label: "Calendar Sync",
    hint: "Cal.com connection card",
  },
  {
    route: "/builder",
    anchor: "deploy-btn",
    side: "bottom",
    emoji: "📞",
    label: "Phone Provisioning",
    hint: "Deploy toolbar ↑",
  },
  {
    route: "/builder",
    anchor: "deploy-btn",
    side: "bottom",
    emoji: "🚀",
    label: "Go Live",
    hint: "Deploy toolbar ↑",
  },
  {
    route: "/dashboard",
    anchor: null,
    side: "center",
    emoji: "📊",
    label: "Dashboard",
    hint: "Live analytics",
  },
];

const TOTAL = STEPS.length;
const CARD_W = 400;
const CARD_H_APPROX = 420;
const SPOTLIGHT_PAD = 8;
const MARGIN = 16;

/* ─── main export ───────────────────────────────────────────────── */

export function OnboardingTour() {
  const { state, setState, advance, dismiss, complete, visible } = useOnboarding();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Navigate to the correct route when the step changes
  useEffect(() => {
    if (!visible) return;
    const target = STEPS[state.step]?.route;
    if (target && pathname !== target) {
      navigate({ to: target as never });
    }
  }, [state.step, visible]);

  if (!mounted || !visible) return null;

  return createPortal(
    <TourLayer
      step={state.step}
      state={state}
      setState={setState}
      advance={advance}
      dismiss={dismiss}
      complete={complete}
      navigate={navigate}
      pathname={pathname}
    />,
    document.body,
  );
}

/* ─── layer (spotlight + card) ──────────────────────────────────── */

interface LayerProps {
  step: number;
  state: ReturnType<typeof useOnboarding>["state"];
  setState: ReturnType<typeof useOnboarding>["setState"];
  advance: () => void;
  dismiss: () => void;
  complete: () => void;
  navigate: ReturnType<typeof useNavigate>;
  pathname: string;
}

interface Rect { top: number; left: number; width: number; height: number; }

function TourLayer(props: LayerProps) {
  const { step } = props;
  const cfg = STEPS[step];
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
  const attemptRef = useRef(0);

  const findAnchor = useCallback(() => {
    if (!cfg.anchor) { setAnchorRect(null); return; }
    const el = document.querySelector(`[data-tour="${cfg.anchor}"]`) as HTMLElement | null;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) {
        setAnchorRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        return;
      }
    }
    // retry up to 10 times / 2s
    if (attemptRef.current < 10) {
      attemptRef.current += 1;
      setTimeout(findAnchor, 200);
    } else {
      setAnchorRect(null);
    }
  }, [cfg.anchor]);

  // Re-anchor whenever step changes or route settles
  useEffect(() => {
    attemptRef.current = 0;
    setAnchorRect(null);
    const t = setTimeout(findAnchor, 350);
    return () => clearTimeout(t);
  }, [step, props.pathname, findAnchor]);

  // Re-anchor on window resize
  useEffect(() => {
    const onResize = () => { attemptRef.current = 0; findAnchor(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [findAnchor]);

  const cardPos = computeCardPos(anchorRect, cfg.side);
  const useCentered = cfg.anchor === null || anchorRect === null;

  return (
    <>
      {/* Dark overlay */}
      {useCentered ? (
        <div className="fixed inset-0 z-[9997] bg-slate-950/65 backdrop-blur-[2px]" />
      ) : (
        <div className="fixed inset-0 z-[9997] pointer-events-none" />
      )}

      {/* Spotlight over anchor */}
      {!useCentered && anchorRect && (
        <div
          className="fixed z-[9998] rounded-lg pointer-events-none transition-all duration-300"
          style={{
            top:    anchorRect.top    - SPOTLIGHT_PAD,
            left:   anchorRect.left   - SPOTLIGHT_PAD,
            width:  anchorRect.width  + SPOTLIGHT_PAD * 2,
            height: anchorRect.height + SPOTLIGHT_PAD * 2,
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.72)",
            border: "1.5px solid rgba(99, 102, 241, 0.55)",
            animation: "tour-ring 2.4s ease-in-out infinite",
          }}
        />
      )}

      {/* Hint label above spotlight */}
      {!useCentered && anchorRect && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{
            top:  anchorRect.top - SPOTLIGHT_PAD - 22,
            left: anchorRect.left - SPOTLIGHT_PAD,
          }}
        >
          <span className="text-[10px] font-medium text-indigo-300/80 bg-indigo-500/10 rounded px-1.5 py-0.5 border border-indigo-500/20">
            {cfg.hint}
          </span>
        </div>
      )}

      {/* Tour card */}
      <div
        className={cn(
          "fixed z-[9999] transition-all duration-200",
          useCentered && "inset-0 flex items-center justify-center pointer-events-none",
        )}
        style={useCentered ? undefined : {
          top:  cardPos.top,
          left: cardPos.left,
          width: CARD_W,
        }}
      >
        <div
          className={cn(
            "w-full rounded-2xl border border-white/[0.09] bg-slate-900/97",
            "shadow-[0_24px_56px_rgba(0,0,0,0.65)] backdrop-blur-xl",
            "flex flex-col overflow-hidden pointer-events-auto",
            useCentered && `max-w-[${CARD_W}px] w-full`,
          )}
          style={useCentered ? { maxWidth: CARD_W } : undefined}
        >
          <CardHeader step={step} cfg={cfg} dismiss={props.dismiss} />
          <div className="px-5 py-4 flex-1 overflow-y-auto max-h-[60vh]">
            <StepBody {...props} />
          </div>
          {step < 6 && <CardFooter step={step} state={props.state} advance={props.advance} dismiss={props.dismiss} />}
        </div>
      </div>

      <style>{`
        @keyframes tour-ring {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.65; }
        }
      `}</style>
    </>
  );
}

/* ─── position maths ────────────────────────────────────────────── */

function computeCardPos(rect: Rect | null, side: Side): { top: number; left: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth  : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  if (!rect) {
    return { top: vh / 2 - CARD_H_APPROX / 2, left: vw / 2 - CARD_W / 2 };
  }

  const clampTop  = (t: number) => Math.max(MARGIN, Math.min(t, vh - CARD_H_APPROX - MARGIN));
  const clampLeft = (l: number) => Math.max(MARGIN, Math.min(l, vw - CARD_W - MARGIN));

  switch (side) {
    case "left":
      return {
        top:  clampTop(rect.top),
        left: clampLeft(rect.left - CARD_W - MARGIN),
      };
    case "right":
      return {
        top:  clampTop(rect.top),
        left: clampLeft(rect.right + MARGIN),
      };
    case "bottom":
      return {
        top:  clampTop(rect.bottom + MARGIN),
        left: clampLeft(rect.left + rect.width / 2 - CARD_W / 2),
      };
    case "top":
      return {
        top:  clampTop(rect.top - CARD_H_APPROX - MARGIN),
        left: clampLeft(rect.left + rect.width / 2 - CARD_W / 2),
      };
    default:
      return { top: vh / 2 - CARD_H_APPROX / 2, left: vw / 2 - CARD_W / 2 };
  }
}

/* ─── card chrome ────────────────────────────────────────────────── */

function CardHeader({ step, cfg, dismiss }: { step: number; cfg: StepConfig; dismiss: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3.5">
      <span className="text-lg leading-none">{cfg.emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
          Step {step + 1} / {TOTAL}
        </p>
        <h2 className="text-sm font-semibold text-white leading-tight mt-0.5">{cfg.label}</h2>
      </div>
      <div className="flex gap-[3px] items-center">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={cn(
              "rounded-full transition-all duration-300",
              i < step   ? "h-1.5 w-3 bg-primary"                       :
              i === step  ? "h-1.5 w-3 bg-primary/70 animate-pulse"      :
                            "h-1.5 w-1.5 bg-white/[0.10]",
            )}
          />
        ))}
      </div>
      <button
        onClick={dismiss}
        className="ml-1 text-slate-600 hover:text-slate-300 transition-colors shrink-0"
        title="Exit tour"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function CardFooter({
  step,
  state,
  advance,
  dismiss,
}: {
  step: number;
  state: LayerProps["state"];
  advance: () => void;
  dismiss: () => void;
}) {
  const disabled = nextDisabled(step, state);
  return (
    <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3">
      <button
        onClick={dismiss}
        className="text-[10px] text-slate-600 hover:text-slate-400 underline underline-offset-2 transition-colors"
      >
        Exit tour
      </button>
      <Button
        size="sm"
        onClick={advance}
        disabled={disabled}
        className="gap-1.5 text-xs font-semibold h-7 px-3"
      >
        {step === 5 ? "Finish" : "Next"}
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function nextDisabled(step: number, state: LayerProps["state"]): boolean {
  if (step === 0) return state.buildPath === null;
  if (step === 2) return !state.adminVerified;
  if (step === 4) return state.phoneChoice === null;
  if (step === 5) return !state.deployed;
  return false;
}

/* ─── step bodies ───────────────────────────────────────────────── */

function StepBody(props: LayerProps) {
  switch (props.step) {
    case 0: return <Step0 {...props} />;
    case 1: return <Step1 {...props} />;
    case 2: return <Step2 {...props} />;
    case 3: return <Step3 {...props} />;
    case 4: return <Step4 {...props} />;
    case 5: return <Step5 {...props} />;
    case 6: return <Step6 {...props} />;
    default: return null;
  }
}

/* Step 0 — Build Strategy */
function Step0({ state, setState }: LayerProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        How would you like to build your first AI agent?
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {(["template", "scratch"] as const).map((path) => (
          <button
            key={path}
            onClick={() => setState({ buildPath: path })}
            className={cn(
              "rounded-xl border p-3.5 text-left transition-all duration-150",
              state.buildPath === path
                ? "border-primary/60 bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]"
                : "border-white/[0.07] bg-white/[0.03] hover:border-white/[0.13] hover:bg-white/[0.05]",
            )}
          >
            <div className="text-lg mb-2">{path === "template" ? "📋" : "✏️"}</div>
            <p className="text-xs font-semibold text-white mb-0.5">
              {path === "template" ? "Use a Template" : "Build from Scratch"}
            </p>
            <p className="text-[10px] text-slate-500 leading-snug">
              {path === "template"
                ? "Start with a pre-built Virtual Receptionist flow and personalise it."
                : "Open an empty canvas and design your agent node-by-node."}
            </p>
          </button>
        ))}
      </div>
      {state.buildPath === "template" && (
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] p-3.5 space-y-2.5">
          <p className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">
            Personalise your template
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block">Company name</label>
              <Input
                className="h-7 text-xs bg-slate-800/60 border-white/[0.08]"
                placeholder="e.g. Bloom Dental"
                value={state.companyName}
                onChange={(e) => setState({ companyName: e.target.value })}
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block">Industry</label>
              <Input
                className="h-7 text-xs bg-slate-800/60 border-white/[0.08]"
                placeholder="e.g. Healthcare"
                value={state.industry}
                onChange={(e) => setState({ industry: e.target.value })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Step 1 — Voice Setup */
const NATIVE_VOICES = [
  { id: "emma",  label: "Emma",  desc: "Warm • US English"  },
  { id: "james", label: "James", desc: "Confident • UK"     },
  { id: "sofia", label: "Sofia", desc: "Friendly • Neutral" },
];

function Step1({ state, setState }: LayerProps) {
  const [showEL, setShowEL] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        The <strong className="text-white">Agent Settings panel</strong> (highlighted →) controls your voice, prompt, and configuration. Choose a native voice or connect ElevenLabs for a custom one.
      </p>
      <div className="flex gap-2">
        {NATIVE_VOICES.map((v) => (
          <button
            key={v.id}
            onClick={() => setState({ voice: v.id })}
            className={cn(
              "flex-1 rounded-lg border p-2.5 text-left transition-all duration-150",
              state.voice === v.id
                ? "border-primary/60 bg-primary/10"
                : "border-white/[0.07] bg-white/[0.03] hover:border-white/[0.12]",
            )}
          >
            <Mic className={cn("h-3 w-3 mb-1.5", state.voice === v.id ? "text-primary" : "text-slate-500")} />
            <p className="text-[10px] font-semibold text-white">{v.label}</p>
            <p className="text-[9px] text-slate-500 mt-0.5">{v.desc}</p>
          </button>
        ))}
      </div>
      <button
        onClick={() => setShowEL((p) => !p)}
        className="flex w-full items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-left hover:bg-white/[0.04] transition-colors"
      >
        <span className="text-sm">🎚️</span>
        <span className="text-[10px] text-slate-300 flex-1">Import Custom Voice (ElevenLabs)</span>
        <span className="text-[9px] text-slate-600">{showEL ? "▲" : "▼ Optional"}</span>
      </button>
      {showEL && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 space-y-2">
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">ElevenLabs API Key</label>
            <Input className="h-7 text-xs bg-slate-800/60 border-white/[0.08] font-mono" placeholder="xi-..." type="password"
              value={state.elevenLabsKey} onChange={(e) => setState({ elevenLabsKey: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">Voice ID</label>
            <Input className="h-7 text-xs bg-slate-800/60 border-white/[0.08] font-mono" placeholder="21m00Tcm4TlvDq8ikWAM"
              value={state.elevenLabsVoiceId} onChange={(e) => setState({ elevenLabsVoiceId: e.target.value })} />
          </div>
          <p className="text-[9px] text-amber-400/70">Save your key under Account → Integrations → ElevenLabs to use in production.</p>
        </div>
      )}
    </div>
  );
}

/* Step 2 — Admin Verification */
function Step2({ state, setState }: LayerProps) {
  const [verifying, setVerifying] = useState(!state.adminVerified);
  useEffect(() => {
    if (state.adminVerified) return;
    const t = setTimeout(() => { setState({ adminVerified: true }); setVerifying(false); }, 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        For network compliance, a validation ping has been sent to our Admin Panel. Our team verifies your account to unlock live communications.
      </p>
      <div className={cn(
        "rounded-xl border px-4 py-4 flex items-center gap-3 transition-all duration-700",
        verifying ? "border-amber-500/30 bg-amber-500/[0.07]" : "border-emerald-500/30 bg-emerald-500/[0.07]",
      )}>
        {verifying ? (
          <>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
              <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />
            </div>
            <div>
              <p className="text-xs font-semibold text-amber-300">⏳ Pending Admin Verification</p>
              <p className="text-[10px] text-amber-400/60 mt-0.5">Sending validation ping…</p>
            </div>
          </>
        ) : (
          <>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-emerald-300">✅ Workspace Verified</p>
              <p className="text-[10px] text-emerald-400/60 mt-0.5">Account validated — live communications unlocked.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* Step 3 — Calendar Sync */
function Step3({ state, setState }: LayerProps) {
  const [connecting, setConnecting] = useState(false);
  function handleConnect() {
    setConnecting(true);
    setTimeout(() => { setState({ calConnected: true }); setConnecting(false); }, 1500);
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        This is your <strong className="text-white">Cal.com connection card</strong> (highlighted). Paste your Cal.com API key and save to bridge live calendar slots into your agent's booking decisions.
      </p>
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xl">📅</span>
          <div>
            <p className="text-xs font-semibold text-white">Cal.com</p>
            <p className="text-[10px] text-slate-500">Real-time appointment booking</p>
          </div>
          {state.calConnected && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              <CheckCircle2 className="h-2.5 w-2.5" /> Connected
            </span>
          )}
        </div>
        {!state.calConnected ? (
          <Button size="sm" variant="outline"
            className="w-full h-7 text-xs gap-1.5 border-white/[0.08] hover:bg-white/[0.06]"
            onClick={handleConnect} disabled={connecting}>
            {connecting
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Connecting…</>
              : <><ExternalLink className="h-3 w-3" /> Connect Cal.com</>}
          </Button>
        ) : (
          <p className="text-[10px] text-slate-500 text-center">
            Your agent will route booking requests to your live calendar.
          </p>
        )}
      </div>
      {!state.calConnected && (
        <p className="text-[9px] text-slate-600 text-center">
          Skip and connect later under Account → Integrations.
        </p>
      )}
    </div>
  );
}

/* Step 4 — Phone Provisioning */
const LOCAL_NUMBERS = ["+1 (212) 555-0141", "+1 (310) 555-0182", "+1 (415) 555-0109"];

function Step4({ state, setState }: LayerProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Your agent needs a voice path. Purchase a dedicated local number, or bind your existing enterprise SIP trunk. This setting lives in the <strong className="text-white">Deploy panel</strong> (highlighted ↑).
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {(["local", "trunk"] as const).map((type) => (
          <button key={type} onClick={() => setState({ phoneChoice: type, phoneValue: "" })}
            className={cn(
              "rounded-xl border p-3 text-left transition-all",
              state.phoneChoice === type ? "border-primary/60 bg-primary/10" : "border-white/[0.07] bg-white/[0.03] hover:border-white/[0.12]",
            )}>
            {type === "local"
              ? <Phone className="h-4 w-4 mb-1.5 text-sky-400" />
              : <PhoneCall className="h-4 w-4 mb-1.5 text-violet-400" />}
            <p className="text-[11px] font-semibold text-white">{type === "local" ? "Local Number" : "IP Trunk (SIP)"}</p>
            <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
              {type === "local" ? "Provision a dedicated DID." : "Bind your SIP trunk."}
            </p>
          </button>
        ))}
      </div>
      {state.phoneChoice === "local" && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Select a number</p>
          {LOCAL_NUMBERS.map((n) => (
            <button key={n} onClick={() => setState({ phoneValue: n })}
              className={cn(
                "w-full flex items-center justify-between rounded-lg border px-3 py-1.5 transition-all",
                state.phoneValue === n ? "border-primary/50 bg-primary/10 text-white" : "border-white/[0.07] bg-white/[0.02] text-slate-400 hover:border-white/[0.12]",
              )}>
              <span className="text-xs font-mono">{n}</span>
              {state.phoneValue === n && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
            </button>
          ))}
        </div>
      )}
      {state.phoneChoice === "trunk" && (
        <div>
          <label className="text-[10px] text-slate-500 mb-1 block">SIP Trunk URI</label>
          <Input className="h-7 text-xs bg-slate-800/60 border-white/[0.08] font-mono"
            placeholder="sip:trunk.yourcompany.com"
            value={state.phoneValue}
            onChange={(e) => setState({ phoneValue: e.target.value })} />
        </div>
      )}
    </div>
  );
}

/* Step 5 — Go Live */
function Step5({ state, setState }: LayerProps) {
  const [deploying, setDeploying] = useState(false);
  const criteria = [
    { label: "Build path selected",         met: !!state.buildPath    },
    { label: "Voice configured",            met: !!state.voice        },
    { label: "Admin verification approved", met: state.adminVerified  },
    { label: "Phone line bound",            met: !!state.phoneChoice  },
  ];
  const allMet = criteria.every((c) => c.met);
  function handleDeploy() {
    setDeploying(true);
    setTimeout(() => { setState({ deployed: true }); setDeploying(false); }, 2000);
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        All criteria met. Click <strong className="text-white">Deploy Agent</strong> to push your configuration live — the button is active in the <strong className="text-white">toolbar above</strong> (highlighted ↑).
      </p>
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3.5 space-y-2">
        {criteria.map((c) => (
          <div key={c.label} className="flex items-center gap-2">
            <span className={cn("text-[11px] w-4 text-center", c.met ? "text-emerald-400" : "text-slate-600")}>
              {c.met ? "✓" : "○"}
            </span>
            <span className={cn("text-[11px]", c.met ? "text-slate-300" : "text-slate-600")}>{c.label}</span>
          </div>
        ))}
      </div>
      {state.deployed ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-emerald-300">Agent deployed successfully</p>
            <p className="text-[10px] text-emerald-400/60 mt-0.5">Click Finish to view your live dashboard.</p>
          </div>
        </div>
      ) : (
        <Button className="w-full h-8 gap-1.5 text-xs font-semibold" disabled={!allMet || deploying} onClick={handleDeploy}>
          {deploying
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deploying…</>
            : <><Rocket className="h-3.5 w-3.5" /> Deploy Agent</>}
        </Button>
      )}
    </div>
  );
}

/* Step 6 — Dashboard */
function Step6({ navigate, complete }: LayerProps) {
  return (
    <div className="space-y-3">
      <div className="text-center py-1">
        <div className="text-3xl mb-2">🎉</div>
        <h3 className="text-sm font-semibold text-white mb-1">You're officially live!</h3>
        <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
          The moment your number receives a call, this dashboard populates with summaries, caller sentiments, and post-call data in real-time.
        </p>
      </div>
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3.5 space-y-1.5">
        {["📊  Live call volume & trends", "💬  Caller sentiment analysis", "📋  Post-call variable extraction", "📅  Booking confirmation logs"].map((item) => (
          <p key={item} className="text-[11px] text-slate-400">{item}</p>
        ))}
      </div>
      <div className="flex flex-col gap-2 pt-1">
        <Button className="w-full h-8 gap-1.5 text-xs font-semibold"
          onClick={() => { complete(); navigate({ to: "/dashboard" }); }}>
          <Zap className="h-3.5 w-3.5" /> View Live Dashboard
        </Button>
        <button onClick={complete}
          className="text-[10px] text-slate-600 hover:text-slate-400 underline underline-offset-2 transition-colors text-center">
          Stay in Builder
        </button>
      </div>
    </div>
  );
}
