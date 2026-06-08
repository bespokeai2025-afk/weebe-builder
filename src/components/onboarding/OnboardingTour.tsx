import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { useOnboarding } from "./useOnboarding";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  Mic,
  Phone,
  PhoneCall,
  Rocket,
  X,
  Zap,
} from "lucide-react";

const TOTAL_STEPS = 7;

const STEP_META = [
  { emoji: "🛠️", label: "Build Strategy"      },
  { emoji: "🎙️", label: "Voice Setup"          },
  { emoji: "🔐", label: "Admin Verification"   },
  { emoji: "📅", label: "Calendar Sync"        },
  { emoji: "📞", label: "Phone Provisioning"   },
  { emoji: "🚀", label: "Go Live"              },
  { emoji: "📊", label: "Dashboard"            },
];

const NATIVE_VOICES = [
  { id: "emma",   label: "Emma",  desc: "Warm • US English" },
  { id: "james",  label: "James", desc: "Confident • UK English" },
  { id: "sofia",  label: "Sofia", desc: "Friendly • Neutral" },
];

const LOCAL_NUMBERS = [
  "+1 (212) 555-0141",
  "+1 (310) 555-0182",
  "+1 (415) 555-0109",
];

export function OnboardingTour() {
  const { state, setState, advance, dismiss, complete, visible } = useOnboarding();
  const navigate = useNavigate();

  if (!visible) return null;

  return createPortal(
    <TourOverlay
      state={state}
      setState={setState}
      advance={advance}
      dismiss={dismiss}
      complete={complete}
      navigate={navigate}
    />,
    document.body,
  );
}

type TourProps = {
  state: ReturnType<typeof useOnboarding>["state"];
  setState: ReturnType<typeof useOnboarding>["setState"];
  advance: () => void;
  dismiss: () => void;
  complete: () => void;
  navigate: ReturnType<typeof useNavigate>;
};

function TourOverlay({ state, setState, advance, dismiss, complete, navigate }: TourProps) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm"
      aria-modal="true"
    >
      <StepCard
        state={state}
        setState={setState}
        advance={advance}
        dismiss={dismiss}
        complete={complete}
        navigate={navigate}
      />
    </div>
  );
}

function StepCard({ state, setState, advance, dismiss, complete, navigate }: TourProps) {
  const meta = STEP_META[state.step];

  return (
    <div
      className={cn(
        "relative w-full max-w-lg rounded-2xl border border-white/[0.09] bg-slate-900/95",
        "shadow-[0_32px_64px_rgba(0,0,0,0.6)] backdrop-blur-xl",
        "flex flex-col overflow-hidden",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-6 py-4">
        <span className="text-xl leading-none">{meta.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-widest">
            Step {state.step + 1} of {TOTAL_STEPS}
          </p>
          <h2 className="text-sm font-semibold text-white leading-tight mt-0.5">{meta.label}</h2>
        </div>
        {/* Progress pills */}
        <div className="flex gap-1">
          {STEP_META.map((_, i) => (
            <div
              key={i}
              className={cn(
                "rounded-full transition-all duration-300",
                i < state.step  ? "h-1.5 w-4 bg-primary"         :
                i === state.step ? "h-1.5 w-4 bg-primary/80 animate-pulse" :
                                   "h-1.5 w-1.5 bg-white/10",
              )}
            />
          ))}
        </div>
        <button
          onClick={dismiss}
          className="ml-2 text-slate-600 hover:text-slate-300 transition-colors"
          title="Exit onboarding"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Step body */}
      <div className="px-6 py-5 flex-1">
        {state.step === 0 && <Step0 state={state} setState={setState} />}
        {state.step === 1 && <Step1 state={state} setState={setState} />}
        {state.step === 2 && <Step2 state={state} setState={setState} />}
        {state.step === 3 && <Step3 state={state} setState={setState} />}
        {state.step === 4 && <Step4 state={state} setState={setState} />}
        {state.step === 5 && <Step5 state={state} setState={setState} />}
        {state.step === 6 && <Step6 navigate={navigate} complete={complete} />}
      </div>

      {/* Footer */}
      {state.step < 6 && (
        <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-3">
          <button
            onClick={dismiss}
            className="text-[11px] text-slate-600 hover:text-slate-400 underline underline-offset-2 transition-colors"
          >
            Exit onboarding
          </button>
          <NextButton state={state} advance={advance} />
        </div>
      )}
    </div>
  );
}

function NextButton({ state, advance }: { state: TourProps["state"]; advance: () => void }) {
  const disabled = getNextDisabled(state);

  return (
    <Button
      size="sm"
      onClick={advance}
      disabled={disabled}
      className={cn(
        "gap-1.5 text-xs font-medium h-8 px-4",
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      {state.step === 5 ? "Done" : "Next"}
      <ChevronRight className="h-3.5 w-3.5" />
    </Button>
  );
}

function getNextDisabled(state: TourProps["state"]): boolean {
  if (state.step === 0) return state.buildPath === null;
  if (state.step === 2) return !state.adminVerified;
  if (state.step === 4) return state.phoneChoice === null;
  if (state.step === 5) return !state.deployed;
  return false;
}

/* ── Step 0 — Build Strategy ─────────────────────────────────────── */
function Step0({ state, setState }: Pick<TourProps, "state" | "setState">) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 leading-relaxed">
        How would you like to build your first AI agent? You can always change this later.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {(["template", "scratch"] as const).map((path) => (
          <button
            key={path}
            onClick={() => setState({ buildPath: path })}
            className={cn(
              "rounded-xl border p-4 text-left transition-all duration-150",
              state.buildPath === path
                ? "border-primary/60 bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.3)]"
                : "border-white/[0.07] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.05]",
            )}
          >
            <div className="text-lg mb-2">
              {path === "template" ? "📋" : "✏️"}
            </div>
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
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] p-4 space-y-3">
          <p className="text-[11px] font-medium text-slate-300">Personalise your template</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block">Company name</label>
              <Input
                className="h-8 text-xs bg-slate-800/60 border-white/[0.08]"
                placeholder="e.g. Bloom Dental"
                value={state.companyName}
                onChange={(e) => setState({ companyName: e.target.value })}
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block">Industry</label>
              <Input
                className="h-8 text-xs bg-slate-800/60 border-white/[0.08]"
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

/* ── Step 1 — Voice Configuration ───────────────────────────────── */
function Step1({ state, setState }: Pick<TourProps, "state" | "setState">) {
  const [showElevenLabs, setShowElevenLabs] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 leading-relaxed">
        Give your agent a brand signature identity. Choose a high-fidelity native voice, or connect a custom provider.
      </p>

      <div className="flex gap-2">
        {NATIVE_VOICES.map((v) => (
          <button
            key={v.id}
            onClick={() => setState({ voice: v.id })}
            className={cn(
              "flex-1 rounded-lg border p-3 text-left transition-all duration-150",
              state.voice === v.id
                ? "border-primary/60 bg-primary/10"
                : "border-white/[0.07] bg-white/[0.03] hover:border-white/[0.12]",
            )}
          >
            <Mic className={cn("h-3.5 w-3.5 mb-2", state.voice === v.id ? "text-primary" : "text-slate-500")} />
            <p className="text-[11px] font-semibold text-white">{v.label}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{v.desc}</p>
          </button>
        ))}
      </div>

      <button
        onClick={() => setShowElevenLabs((p) => !p)}
        className="flex w-full items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-left hover:bg-white/[0.04] transition-colors"
      >
        <span className="text-sm">🎚️</span>
        <span className="text-[11px] text-slate-300 flex-1">Import Custom Voice (ElevenLabs)</span>
        <span className="text-[10px] text-slate-600">{showElevenLabs ? "▲ Hide" : "▼ Optional"}</span>
      </button>

      {showElevenLabs && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-4 space-y-3">
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">ElevenLabs API Key</label>
            <Input
              className="h-8 text-xs bg-slate-800/60 border-white/[0.08] font-mono"
              placeholder="xi-..."
              type="password"
              value={state.elevenLabsKey}
              onChange={(e) => setState({ elevenLabsKey: e.target.value })}
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">Voice ID</label>
            <Input
              className="h-8 text-xs bg-slate-800/60 border-white/[0.08] font-mono"
              placeholder="21m00Tcm4TlvDq8ikWAM"
              value={state.elevenLabsVoiceId}
              onChange={(e) => setState({ elevenLabsVoiceId: e.target.value })}
            />
          </div>
          <p className="text-[10px] text-amber-400/70">
            Save your key under Account → Integrations → ElevenLabs to use it in production.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Step 2 — Admin Verification ────────────────────────────────── */
function Step2({ state, setState }: Pick<TourProps, "state" | "setState">) {
  const [verifying, setVerifying] = useState(!state.adminVerified);

  useEffect(() => {
    if (state.adminVerified) return;
    const t = setTimeout(() => {
      setState({ adminVerified: true });
      setVerifying(false);
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 leading-relaxed">
        Workspace configured! For network compliance, a validation ping has been forwarded to our Admin Panel.
        Our team verifies your account details to unlock live communications.
      </p>

      <div
        className={cn(
          "rounded-xl border px-5 py-4 flex items-center gap-4 transition-all duration-700",
          verifying
            ? "border-amber-500/30 bg-amber-500/[0.07]"
            : "border-emerald-500/30 bg-emerald-500/[0.07]",
        )}
      >
        {verifying ? (
          <>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
              <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />
            </div>
            <div>
              <p className="text-xs font-semibold text-amber-300">⏳ Pending Admin Verification</p>
              <p className="text-[10px] text-amber-400/60 mt-0.5">Sending validation ping…</p>
            </div>
          </>
        ) : (
          <>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-emerald-300">✅ Workspace Verified</p>
              <p className="text-[10px] text-emerald-400/60 mt-0.5">Account validated — live communications unlocked.</p>
            </div>
          </>
        )}
      </div>

      {verifying && (
        <p className="text-[10px] text-slate-600 text-center">
          This usually takes just a moment…
        </p>
      )}
    </div>
  );
}

/* ── Step 3 — Calendar Sync ─────────────────────────────────────── */
function Step3({ state, setState }: Pick<TourProps, "state" | "setState">) {
  const [connecting, setConnecting] = useState(false);

  function handleConnect() {
    setConnecting(true);
    setTimeout(() => {
      setState({ calConnected: true });
      setConnecting(false);
    }, 1500);
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 leading-relaxed">
        Link your scheduling availability. Connect Cal.com to bridge your live calendar booking slots directly to the agent's routing decisions.
      </p>

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">📅</span>
          <div>
            <p className="text-xs font-semibold text-white">Cal.com</p>
            <p className="text-[10px] text-slate-500">Real-time appointment booking integration</p>
          </div>
          {state.calConnected && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-medium text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </span>
          )}
        </div>

        {!state.calConnected ? (
          <Button
            size="sm"
            variant="outline"
            className="w-full h-8 text-xs gap-2 border-white/[0.08] hover:bg-white/[0.06]"
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Connecting…</>
            ) : (
              <><ExternalLink className="h-3 w-3" /> Connect Cal.com</>
            )}
          </Button>
        ) : (
          <p className="text-[10px] text-slate-500 text-center">
            Your agent will now route booking requests to your live calendar.
          </p>
        )}
      </div>

      {!state.calConnected && (
        <p className="text-[10px] text-slate-600 text-center">
          You can skip this and connect Cal.com later under Account → Integrations.
        </p>
      )}
    </div>
  );
}

/* ── Step 4 — Telephony Provisioning ────────────────────────────── */
function Step4({ state, setState }: Pick<TourProps, "state" | "setState">) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 leading-relaxed">
        Your agent needs a voice path. Purchase a dedicated local phone number, or bind your existing enterprise IP Trunk infrastructure.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {(["local", "trunk"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setState({ phoneChoice: type, phoneValue: "" })}
            className={cn(
              "rounded-xl border p-4 text-left transition-all duration-150",
              state.phoneChoice === type
                ? "border-primary/60 bg-primary/10"
                : "border-white/[0.07] bg-white/[0.03] hover:border-white/[0.12]",
            )}
          >
            {type === "local"
              ? <Phone className="h-4 w-4 mb-2 text-sky-400" />
              : <PhoneCall className="h-4 w-4 mb-2 text-violet-400" />}
            <p className="text-[11px] font-semibold text-white">
              {type === "local" ? "Local Number" : "IP Trunk (SIP)"}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
              {type === "local"
                ? "Provision a dedicated DID for your agent."
                : "Bind your enterprise SIP trunk directly."}
            </p>
          </button>
        ))}
      </div>

      {state.phoneChoice === "local" && (
        <div className="space-y-2">
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Select a number</p>
          {LOCAL_NUMBERS.map((n) => (
            <button
              key={n}
              onClick={() => setState({ phoneValue: n })}
              className={cn(
                "w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-all",
                state.phoneValue === n
                  ? "border-primary/50 bg-primary/10 text-white"
                  : "border-white/[0.07] bg-white/[0.02] text-slate-400 hover:border-white/[0.12]",
              )}
            >
              <span className="text-xs font-mono">{n}</span>
              {state.phoneValue === n && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
            </button>
          ))}
        </div>
      )}

      {state.phoneChoice === "trunk" && (
        <div>
          <label className="text-[10px] text-slate-500 mb-1 block">SIP Trunk URI</label>
          <Input
            className="h-8 text-xs bg-slate-800/60 border-white/[0.08] font-mono"
            placeholder="sip:trunk.yourcompany.com"
            value={state.phoneValue}
            onChange={(e) => setState({ phoneValue: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

/* ── Step 5 — Go Live ────────────────────────────────────────────── */
function Step5({ state, setState }: Pick<TourProps, "state" | "setState">) {
  const [deploying, setDeploying] = useState(false);

  const criteria = [
    { label: "Build path selected",        met: !!state.buildPath },
    { label: "Voice configured",           met: !!state.voice },
    { label: "Admin verification approved",met: state.adminVerified },
    { label: "Phone line bound",           met: !!state.phoneChoice },
  ];

  const allMet = criteria.every((c) => c.met);

  function handleDeploy() {
    setDeploying(true);
    setTimeout(() => {
      setState({ deployed: true });
      setDeploying(false);
    }, 2000);
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 leading-relaxed">
        All operational criteria achieved. Your parameters are locked — click Deploy to push your configuration live.
      </p>

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4 space-y-2">
        {criteria.map((c) => (
          <div key={c.label} className="flex items-center gap-2">
            <span className={cn("h-4 w-4 text-[11px]", c.met ? "text-emerald-400" : "text-slate-600")}>
              {c.met ? "✓" : "○"}
            </span>
            <span className={cn("text-[11px]", c.met ? "text-slate-300" : "text-slate-600")}>
              {c.label}
            </span>
          </div>
        ))}
      </div>

      {state.deployed ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] px-5 py-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-emerald-300">Agent deployed successfully</p>
            <p className="text-[10px] text-emerald-400/60 mt-0.5">Click Next to view your live dashboard.</p>
          </div>
        </div>
      ) : (
        <Button
          className="w-full h-9 gap-2 text-xs font-semibold"
          disabled={!allMet || deploying}
          onClick={handleDeploy}
        >
          {deploying ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deploying…</>
          ) : (
            <><Rocket className="h-3.5 w-3.5" /> Deploy Agent</>
          )}
        </Button>
      )}
    </div>
  );
}

/* ── Step 6 — Dashboard ─────────────────────────────────────────── */
function Step6({ navigate, complete }: Pick<TourProps, "navigate" | "complete">) {
  return (
    <div className="space-y-4">
      <div className="text-center py-2">
        <div className="text-4xl mb-3">🎉</div>
        <h3 className="text-sm font-semibold text-white mb-1">You're officially live!</h3>
        <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
          The moment your provisioned number catches a call, the dashboard dynamically populates your summaries,
          caller sentiments, and post-call data in real-time.
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4 space-y-2">
        {[
          "📊  Live call volume and trends",
          "💬  Caller sentiment analysis",
          "📋  Post-call variable extraction",
          "📅  Booking confirmation logs",
        ].map((item) => (
          <p key={item} className="text-[11px] text-slate-400">{item}</p>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Button
          className="w-full h-9 gap-2 text-xs font-semibold"
          onClick={() => {
            complete();
            navigate({ to: "/dashboard" });
          }}
        >
          <Zap className="h-3.5 w-3.5" />
          View Live Dashboard
        </Button>
        <button
          onClick={complete}
          className="text-[11px] text-slate-600 hover:text-slate-400 underline underline-offset-2 transition-colors text-center"
        >
          Stay in Builder
        </button>
      </div>
    </div>
  );
}
