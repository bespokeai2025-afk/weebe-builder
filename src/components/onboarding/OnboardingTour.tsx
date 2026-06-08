import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { useOnboarding } from "./useOnboarding";
import type { OnboardingState } from "./useOnboarding";

// ─── Types ────────────────────────────────────────────────────────────────────

type Side = "left" | "right" | "bottom" | "center";
interface StepCfg { route: string; anchor: string | null; side: Side; emoji: string; label: string; }
interface Rect     { top: number; left: number; width: number; height: number; }

// ─── Step config ──────────────────────────────────────────────────────────────

const STEPS: StepCfg[] = [
  { route: "/builder",           anchor: null,          side: "center", emoji: "🛠️", label: "Choose Your Setup"    },
  { route: "/builder",           anchor: "right-panel", side: "left",   emoji: "🎙️", label: "Voice Configuration"  },
  { route: "/builder",           anchor: null,          side: "center", emoji: "🔐", label: "Admin Verification"   },
  { route: "/settings/calendar", anchor: "cal-connect", side: "right",  emoji: "📅", label: "Calendar Integration" },
  { route: "/builder",           anchor: null,          side: "center", emoji: "📞", label: "Phone Provisioning"   },
  { route: "/builder",           anchor: "deploy-btn",  side: "bottom", emoji: "🚀", label: "Go Live"              },
  { route: "/dashboard",         anchor: null,          side: "center", emoji: "📊", label: "Console Active"       },
];

const PAD    = 10;
const CARD_W = 340;

// ─── Per-step unlock logic ────────────────────────────────────────────────────

function isUnlocked(step: number, s: OnboardingState): boolean {
  switch (step) {
    case 0: return s.buildPath === "template" && s.companyName.trim().length >= 3 && s.industry.trim().length >= 3;
    case 1: return s.voiceInteracted;
    case 2: return s.adminVerified;
    case 3: return s.calConnected;
    case 4: return s.phoneChoice !== null;
    case 5: return s.deployed;
    default: return true;
  }
}

// ─── Card position ────────────────────────────────────────────────────────────

function cardPos(rect: Rect | null, side: Side): { top: number; left: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth  : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  if (!rect || side === "center") {
    return { top: Math.max(40, vh / 2 - 230), left: vw / 2 - CARD_W / 2 };
  }

  const cy = rect.top + rect.height / 2;
  const cx = rect.left + rect.width / 2;

  if (side === "left") {
    return {
      top:  Math.max(8, Math.min(cy - 160, vh - 380)),
      left: Math.max(8, rect.left - PAD - CARD_W - 16),
    };
  }
  if (side === "right") {
    return {
      top:  Math.max(8, Math.min(cy - 160, vh - 380)),
      left: Math.min(rect.right + PAD + 16, vw - CARD_W - 8),
    };
  }
  return {
    top:  Math.min(rect.bottom + PAD + 16, vh - 380),
    left: Math.max(8, Math.min(cx - CARD_W / 2, vw - CARD_W - 8)),
  };
}

// ─── Quad overlay ─────────────────────────────────────────────────────────────
// Four blocking panels surrounding the spotlight gap. Anything outside the
// spotlight gets pointer-events blocked so users can only interact with the
// targeted element (or the tour card itself).

function QuadOverlay({
  rect,
  onOutsideClick,
  flash,
}: {
  rect: Rect | null;
  onOutsideClick: () => void;
  flash: boolean;
}) {
  const bg: React.CSSProperties = {
    position: "fixed",
    zIndex: 9997,
    backgroundColor: flash ? "rgba(2,6,23,0.88)" : "rgba(2,6,23,0.76)",
    transition: "background-color 0.15s",
    cursor: "not-allowed",
  };

  if (!rect) {
    return <div style={{ ...bg, inset: 0 }} onClick={onOutsideClick} />;
  }

  const sTop  = rect.top    - PAD;
  const sLeft = rect.left   - PAD;
  const sW    = rect.width  + PAD * 2;
  const sH    = rect.height + PAD * 2;

  return (
    <>
      {/* top strip */}
      <div style={{ ...bg, top: 0, left: 0, right: 0, height: Math.max(0, sTop) }} onClick={onOutsideClick} />
      {/* left strip */}
      <div style={{ ...bg, top: sTop, left: 0, width: Math.max(0, sLeft), height: sH }} onClick={onOutsideClick} />
      {/* right strip */}
      <div style={{ ...bg, top: sTop, left: sLeft + sW, right: 0, height: sH }} onClick={onOutsideClick} />
      {/* bottom strip */}
      <div style={{ ...bg, top: sTop + sH, left: 0, right: 0, bottom: 0 }} onClick={onOutsideClick} />
    </>
  );
}

// ─── Spotlight ring ───────────────────────────────────────────────────────────

function SpotlightRing({ rect, flash }: { rect: Rect | null; flash: boolean }) {
  if (!rect) return null;
  return (
    <div
      style={{
        position: "fixed",
        zIndex: 9998,
        top:    rect.top    - PAD,
        left:   rect.left   - PAD,
        width:  rect.width  + PAD * 2,
        height: rect.height + PAD * 2,
        borderRadius: 10,
        border: flash
          ? "2px solid rgba(239,68,68,0.85)"
          : "2px solid rgba(99,102,241,0.65)",
        boxShadow: flash
          ? "0 0 0 4px rgba(239,68,68,0.18)"
          : "0 0 0 4px rgba(99,102,241,0.12), inset 0 0 0 1px rgba(99,102,241,0.06)",
        transition: "border-color 0.18s, box-shadow 0.18s",
        pointerEvents: "none",
      }}
    />
  );
}

// ─── Step 0 — Build strategy + company info ───────────────────────────────────

function Step0({
  state,
  setState,
}: {
  state: OnboardingState;
  setState: (p: Partial<OnboardingState>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Pick your starting point. You <span className="text-indigo-300 font-medium">must</span> use the
        Receptionist Template — it pre-populates your agent canvas automatically.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setState({ buildPath: "template" })}
          className={`relative rounded-lg border px-3 py-3 text-left transition-all ${
            state.buildPath === "template"
              ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/30"
              : "border-slate-700 bg-slate-800/60 hover:border-slate-600"
          }`}
        >
          <div className="text-sm font-semibold text-slate-100">📋 Receptionist</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Template — required</div>
          {state.buildPath === "template" && (
            <span className="absolute top-1.5 right-2 text-[10px] text-indigo-400 font-bold">✓</span>
          )}
        </button>
        <button
          disabled
          className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-3 text-left opacity-35 cursor-not-allowed"
        >
          <div className="text-sm font-semibold text-slate-500">✏️ From Scratch</div>
          <div className="text-[10px] text-slate-600 mt-0.5">Locked for new users</div>
        </button>
      </div>

      {state.buildPath === "template" && (
        <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
          <div>
            <label className="text-[10px] font-medium tracking-wide uppercase text-slate-400">Company Name</label>
            <input
              autoFocus
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
              placeholder="e.g. Acme Medical Group"
              value={state.companyName}
              onChange={(e) => setState({ companyName: e.target.value })}
            />
            {state.companyName.length > 0 && state.companyName.trim().length < 3 && (
              <p className="text-[10px] text-red-400 mt-0.5">Minimum 3 characters required</p>
            )}
          </div>
          <div>
            <label className="text-[10px] font-medium tracking-wide uppercase text-slate-400">Industry</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
              placeholder="e.g. Healthcare, Real Estate"
              value={state.industry}
              onChange={(e) => setState({ industry: e.target.value })}
            />
            {state.industry.length > 0 && state.industry.trim().length < 3 && (
              <p className="text-[10px] text-red-400 mt-0.5">Minimum 3 characters required</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 1 — Voice selection ─────────────────────────────────────────────────

const VOICES = [
  { id: "emma",  label: "Emma",  desc: "Warm · Professional" },
  { id: "james", label: "James", desc: "Deep · Authoritative" },
  { id: "sofia", label: "Sofia", desc: "Friendly · Upbeat" },
];

function Step1({
  state,
  setState,
}: {
  state: OnboardingState;
  setState: (p: Partial<OnboardingState>) => void;
}) {
  const [tab,     setTab]     = useState<"native" | "elevenlabs">("native");
  const [playing, setPlaying] = useState<string | null>(null);

  function handlePreview(id: string) {
    if (playing) return;
    setPlaying(id);
    setTimeout(() => {
      setPlaying(null);
      setState({ voiceChosen: id, voiceInteracted: true });
    }, 1500);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Select the voice your receptionist uses on calls. Preview one native voice <em>or</em>{" "}
        configure ElevenLabs to unlock this step.
      </p>

      <div className="flex rounded-lg border border-slate-700 bg-slate-800/50 p-0.5 gap-0.5">
        {(["native", "elevenlabs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md py-1 text-[11px] font-medium transition-all ${
              tab === t ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t === "native" ? "🎙 Native Voices" : "⚡ ElevenLabs"}
          </button>
        ))}
      </div>

      {tab === "native" ? (
        <div className="flex flex-col gap-1.5">
          {VOICES.map((v) => (
            <div
              key={v.id}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 transition-all ${
                state.voiceChosen === v.id
                  ? "border-indigo-500 bg-indigo-500/10"
                  : "border-slate-700 bg-slate-800/40 hover:border-slate-600"
              }`}
            >
              <div>
                <div className="text-xs font-semibold text-slate-100">{v.label}</div>
                <div className="text-[10px] text-slate-500">{v.desc}</div>
              </div>
              <button
                onClick={() => handlePreview(v.id)}
                disabled={playing !== null}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-medium transition-all ${
                  playing === v.id
                    ? "bg-indigo-600 text-white"
                    : "border border-slate-600 bg-slate-700/80 text-slate-300 hover:bg-slate-600"
                }`}
              >
                {playing === v.id ? (
                  <><span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Playing…</>
                ) : "▶ Preview"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div>
            <label className="text-[10px] font-medium tracking-wide uppercase text-slate-400">API Key</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
              placeholder="xi_xxxxxxxxxxxxxxxxxxxxxxxx"
              value={state.elevenLabsKey}
              onChange={(e) => setState({ elevenLabsKey: e.target.value, voiceInteracted: e.target.value.length >= 6 })}
            />
          </div>
          <div>
            <label className="text-[10px] font-medium tracking-wide uppercase text-slate-400">Voice ID</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
              placeholder="ElevenLabs Voice ID"
            />
          </div>
        </div>
      )}

      {state.voiceInteracted && (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
          <span>✓</span><span>Voice configured — proceed to next step</span>
        </div>
      )}
    </div>
  );
}

// ─── Step 2 — Admin verification (auto-advance) ───────────────────────────────

function Step2({ setState, advance }: {
  state: OnboardingState;
  setState: (p: Partial<OnboardingState>) => void;
  advance: () => void;
}) {
  const [count,    setCount]    = useState(3);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          clearInterval(id);
          setVerified(true);
          setState({ adminVerified: true });
          setTimeout(() => advance(), 1200);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      {!verified ? (
        <>
          <div className="relative h-16 w-16">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(99,102,241,0.15)" strokeWidth="5" />
              <circle
                cx="32" cy="32" r="26" fill="none"
                stroke="rgba(99,102,241,0.85)" strokeWidth="5"
                strokeDasharray={`${2 * Math.PI * 26}`}
                strokeDashoffset={`${2 * Math.PI * 26 * (count / 3)}`}
                strokeLinecap="round"
                style={{ transition: "stroke-dashoffset 0.9s linear" }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-xl font-bold text-indigo-300">
              {count}
            </div>
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold text-slate-100">⏳ Pending Admin Panel Review…</div>
            <div className="text-[11px] text-slate-500 mt-1">Verifying your workspace credentials</div>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/40">
            <span className="text-2xl">✅</span>
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold text-emerald-400">Account Verified &amp; Cloned to Workspace</div>
            <div className="text-[11px] text-slate-500 mt-1">Advancing automatically…</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 3 — Cal.com integration ────────────────────────────────────────────

function Step3({ state, setState }: {
  state: OnboardingState;
  setState: (p: Partial<OnboardingState>) => void;
}) {
  const [syncing, setSyncing] = useState(false);

  function handleConnect() {
    setSyncing(true);
    setTimeout(() => { setSyncing(false); setState({ calConnected: true }); }, 1600);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Link your Cal.com account so the receptionist can book appointments. Click the highlighted
        button in the settings panel <em>or</em> use the button below.
      </p>

      {!state.calConnected ? (
        <button
          onClick={handleConnect}
          disabled={syncing}
          className="flex items-center justify-center gap-2 rounded-lg border border-indigo-500/50 bg-indigo-600/20 py-2.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/30 transition-all disabled:opacity-60"
        >
          {syncing ? (
            <><span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" /> Calendar Syncing…</>
          ) : "📅 Connect Cal.com"}
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5">
          <span className="text-emerald-400">✓</span>
          <span className="text-xs font-semibold text-emerald-400">Cal.com Connected</span>
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <div className="text-[10px] text-slate-500">Your booking link:</div>
        <div className="mt-0.5 text-xs font-mono text-slate-300">cal.com/your-workspace/receptionist</div>
      </div>
    </div>
  );
}

// ─── Step 4 — Phone provisioning ─────────────────────────────────────────────

const PHONE_OPTS = [
  { id: "local-us", label: "+1 (415) 555-0198", type: "Local US",       kind: "local" as const, price: "$4/mo" },
  { id: "local-uk", label: "+44 20 7946 0321",  type: "Local UK",       kind: "local" as const, price: "$5/mo" },
  { id: "trunk",    label: "Bring Your Own Trunk", type: "SIP / IP Trunk", kind: "trunk" as const, price: "Free" },
];

function Step4({ state, setState }: {
  state: OnboardingState;
  setState: (p: Partial<OnboardingState>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Your receptionist will answer inbound calls on this number. Select one to continue.
      </p>

      <div className="flex flex-col gap-1.5">
        {PHONE_OPTS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setState({ phoneChoice: opt.kind, phoneValue: opt.label })}
            className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-all ${
              state.phoneValue === opt.label
                ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/30"
                : "border-slate-700 bg-slate-800/40 hover:border-slate-600"
            }`}
          >
            <div>
              <div className="text-xs font-semibold font-mono text-slate-100">{opt.label}</div>
              <div className="text-[10px] text-slate-500">{opt.type}</div>
            </div>
            <div className="text-right shrink-0 ml-2">
              <div className="text-[10px] text-slate-400">{opt.price}</div>
              {state.phoneValue === opt.label && (
                <div className="text-[10px] text-indigo-400 font-bold mt-0.5">Selected ✓</div>
              )}
            </div>
          </button>
        ))}
      </div>

      {state.phoneChoice && (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
          <span>✓</span><span>{state.phoneValue} reserved — click Next</span>
        </div>
      )}
    </div>
  );
}

// ─── Step 5 — Go Live (listens for real deploy button click) ──────────────────

function Step5({ deployed }: { deployed: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Your agent is fully configured. Click the{" "}
        <span className="font-semibold text-indigo-300">Deploy button</span> in the toolbar above —
        it has been unlocked and is waiting for you.
      </p>

      <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/5 px-3 py-2.5">
        <div className="text-[10px] text-slate-400 mb-1">What happens on deploy:</div>
        <ul className="flex flex-col gap-0.5 text-[10px] text-slate-300">
          <li>• Agent nodes compiled to Retell workflow</li>
          <li>• Phone number bound to agent endpoint</li>
          <li>• Status badge: <span className="text-amber-400">Draft</span> → <span className="text-emerald-400">Live</span></li>
        </ul>
      </div>

      {!deployed ? (
        <div className="flex items-center gap-2 text-[11px] text-indigo-400 animate-pulse">
          <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
          Waiting for you to click Deploy ↑
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-emerald-400 animate-in fade-in duration-300">
          <span>🚀</span>
          <span className="font-semibold">Deployed! Redirecting to your console…</span>
        </div>
      )}
    </div>
  );
}

// ─── Step 6 — Live console ────────────────────────────────────────────────────

function Step6({ complete }: { complete: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Your receptionist is{" "}
        <span className="font-semibold text-emerald-400">officially active</span>. The moment
        your provisioned number picks up a call, this dashboard populates with operational metrics,
        sentiment trends, and post-call data arrays in real-time.
      </p>

      <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-slate-300 mb-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          Live data streaming active
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {["Calls Today", "Avg Duration", "Sentiment"].map((m) => (
            <div key={m} className="rounded border border-slate-700 bg-slate-800/60 px-2 py-1.5 text-center">
              <div className="text-sm font-bold text-slate-100">—</div>
              <div className="text-[9px] text-slate-500">{m}</div>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={complete}
        className="w-full rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-900/40 hover:from-indigo-500 hover:to-violet-500 transition-all"
      >
        🚀 Launch My Console
      </button>
    </div>
  );
}

// ─── Tour card shell ──────────────────────────────────────────────────────────

function TourCard({
  step, pos, state, setState, advance, dismiss, complete, shaking, onNextAttempt,
}: {
  step: number;
  pos: { top: number; left: number };
  state: OnboardingState;
  setState: (p: Partial<OnboardingState>) => void;
  advance: () => void;
  dismiss: () => void;
  complete: () => void;
  shaking: boolean;
  onNextAttempt: () => void;
}) {
  const cfg      = STEPS[step];
  const unlocked = isUnlocked(step, state);

  function handleNext() {
    if (!unlocked) { onNextAttempt(); return; }
    advance();
  }

  const showFooter = step !== 2 && step !== 6;

  return (
    <div
      style={{
        position:  "fixed",
        zIndex:    9999,
        top:       pos.top,
        left:      pos.left,
        width:     CARD_W,
        animation: shaking ? "tour-shake 0.52s ease-in-out" : undefined,
      }}
      className="flex flex-col rounded-xl border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/70 ring-1 ring-white/[0.04]"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-2.5">
        <span className="text-lg leading-none">{cfg.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold text-slate-100 truncate">{cfg.label}</div>
          <div className="text-[9px] text-slate-500 mt-0.5">Step {step + 1} of {STEPS.length}</div>
        </div>
        {/* Progress pips */}
        <div className="flex items-center gap-0.5 shrink-0">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i < step ? "w-3 bg-indigo-500" : i === step ? "w-4 bg-indigo-400" : "w-1.5 bg-slate-700"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {step === 0 && <Step0 state={state} setState={setState} />}
        {step === 1 && <Step1 state={state} setState={setState} />}
        {step === 2 && <Step2 state={state} setState={setState} advance={advance} />}
        {step === 3 && <Step3 state={state} setState={setState} />}
        {step === 4 && <Step4 state={state} setState={setState} />}
        {step === 5 && <Step5 deployed={state.deployed} />}
        {step === 6 && <Step6 complete={complete} />}
      </div>

      {/* Footer */}
      {showFooter && (
        <div className="flex items-center justify-between border-t border-slate-800 px-4 py-2.5">
          <button
            onClick={dismiss}
            className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
          >
            Skip Tour
          </button>

          <div className="flex items-center gap-2">
            {!unlocked && (
              <span className="text-[9px] text-slate-600">Complete step above first</span>
            )}
            <button
              onClick={handleNext}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[11px] font-semibold transition-all ${
                unlocked
                  ? "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm shadow-indigo-900/60"
                  : "bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700"
              }`}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function OnboardingTour() {
  const [mounted, setMounted] = useState(false);
  const navigate = useNavigate();
  const { state, setState, advance, dismiss, complete, visible } = useOnboarding();

  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
  const [shaking,    setShaking]    = useState(false);
  const [flash,      setFlash]      = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Navigate when step changes
  useEffect(() => {
    if (!mounted || !visible) return;
    const cfg = STEPS[state.step];
    if (cfg) navigate({ to: cfg.route as "/builder" | "/settings/calendar" | "/dashboard" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, mounted, visible]);

  // Resolve anchor element bounding rect
  useEffect(() => {
    if (!mounted || !visible) return;
    const anchor = STEPS[state.step]?.anchor;
    if (!anchor) { setAnchorRect(null); return; }

    if (pollRef.current) clearInterval(pollRef.current);

    let attempts = 0;
    function measure() {
      const el = document.querySelector(`[data-tour="${anchor}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        setAnchorRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
    }

    measure();
    pollRef.current = setInterval(() => {
      measure();
      if (++attempts > 30) { clearInterval(pollRef.current!); }
    }, 200);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [state.step, mounted, visible]);

  // Step 3: also listen for a real click on the cal-connect card button
  useEffect(() => {
    if (!mounted || !visible || state.step !== 3 || state.calConnected) return;
    const card = document.querySelector('[data-tour="cal-connect"]');
    if (!card) return;
    function handler() { setState({ calConnected: true }); }
    card.addEventListener("click", handler);
    return () => card.removeEventListener("click", handler);
  }, [state.step, mounted, visible, state.calConnected, setState]);

  // Step 5: listen for a real click on the deploy button
  useEffect(() => {
    if (!mounted || !visible || state.step !== 5 || state.deployed) return;
    const el = document.querySelector('[data-tour="deploy-btn"]');
    if (!el) return;
    function handler() {
      setState({ deployed: true });
      setTimeout(() => advance(), 1500);
    }
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [state.step, mounted, visible, state.deployed, setState, advance]);

  const triggerShake = useCallback(() => {
    setShaking(true);
    setTimeout(() => setShaking(false), 550);
  }, []);

  const triggerFlash = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 380);
  }, []);

  function handleOutsideClick() {
    triggerFlash();
    if (!isUnlocked(state.step, state)) triggerShake();
  }

  if (!mounted || !visible) return null;

  const cfg = STEPS[state.step];
  const pos = cardPos(anchorRect, cfg.side);

  return createPortal(
    <>
      <style>{`
        @keyframes tour-shake {
          0%,100% { transform: translateX(0); }
          15%     { transform: translateX(-6px); }
          30%     { transform: translateX(6px); }
          50%     { transform: translateX(-4px); }
          70%     { transform: translateX(4px); }
          85%     { transform: translateX(-2px); }
        }
      `}</style>

      <QuadOverlay rect={anchorRect} onOutsideClick={handleOutsideClick} flash={flash} />
      <SpotlightRing rect={anchorRect} flash={flash} />
      <TourCard
        step={state.step}
        pos={pos}
        state={state}
        setState={setState}
        advance={advance}
        dismiss={dismiss}
        complete={complete}
        shaking={shaking}
        onNextAttempt={triggerShake}
      />
    </>,
    document.body,
  );
}
