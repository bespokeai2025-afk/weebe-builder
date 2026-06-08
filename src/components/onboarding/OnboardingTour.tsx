import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { useOnboarding } from "./useOnboarding";
import type { OnboardingState } from "./useOnboarding";

// ─── Step config ──────────────────────────────────────────────────────────────

type Side = "left" | "right" | "bottom" | "center";

interface StepCfg {
  route: string;
  anchor: string | null;
  side: Side;
  emoji: string;
  label: string;
  /** Advance only via a real DOM click — no Next button shown. */
  clickGated?: boolean;
  /** Auto-advances after 1.5 s — no footer at all. */
  autoStep?: boolean;
  /** Suppresses the quad-overlay so the user can interact freely (dialogs, node editor). */
  noOverlay?: boolean;
}

const STEPS: StepCfg[] = [
  // 0
  { route: "/builder",           anchor: null,                      side: "center", emoji: "👋", label: "Welcome to Webee",         autoStep: true },
  // 1
  { route: "/builder",           anchor: "nav-templates",           side: "right",  emoji: "📋", label: "Browse Templates",          clickGated: true },
  // 2
  { route: "/templates",         anchor: "template-receptionist",   side: "bottom", emoji: "🚀", label: "Select Blueprint",           clickGated: true },
  // 3
  { route: "/builder",           anchor: "agent-name-input",        side: "bottom", emoji: "✍️", label: "Name Your Agent" },
  // 4 — first conversation node (isStart); no overlay so NodeEditorDialog can open freely
  { route: "/builder",           anchor: "node-root",               side: "bottom", emoji: "💬", label: "Configure First Node",       noOverlay: true },
  // 5 — global prompt section in right panel; no overlay so user can type directly
  { route: "/builder",           anchor: "global-prompt",           side: "left",   emoji: "🌐", label: "Global Prompt",              noOverlay: true },
  // 6
  { route: "/builder",           anchor: "voice-section",           side: "left",   emoji: "🎙️", label: "Voice Profile" },
  // 7
  { route: "/builder",           anchor: "agent-type-select",       side: "left",   emoji: "⚙️", label: "Agent Type" },
  // 8
  { route: "/builder",           anchor: "save-btn",                side: "bottom", emoji: "🛠️", label: "Save Agent",                 clickGated: true },
  // 9 — Deploy to Retell (creates the live Retell agent)
  { route: "/builder",           anchor: "builder-create-deploy-btn", side: "bottom", emoji: "⚡", label: "Deploy Agent",              clickGated: true },
  // 10
  { route: "/builder",           anchor: "nav-agents",              side: "right",  emoji: "📡", label: "Agents Registry",            clickGated: true },
  // 11 — real Deploy button on the AgentCard
  { route: "/my-agents",         anchor: "agent-deploy-btn",        side: "bottom", emoji: "🚀", label: "Deploy Agent",               clickGated: true },
  // 12-15 — inside DeployAgentDialog; no overlay so dialog is fully interactive
  { route: "/my-agents",         anchor: null,                      side: "center", emoji: "🏢", label: "Workspace Clone",            noOverlay: true },
  { route: "/my-agents",         anchor: null,                      side: "center", emoji: "📞", label: "Phone Number",               noOverlay: true },
  { route: "/my-agents",         anchor: null,                      side: "center", emoji: "📅", label: "Cal.com Integration",        noOverlay: true },
  { route: "/my-agents",         anchor: null,                      side: "center", emoji: "🎉", label: "Go Live",                    noOverlay: true },
];

const PAD    = 10;
const CARD_W = 300;

// ─── Unlock gates ─────────────────────────────────────────────────────────────

function isUnlocked(step: number, s: OnboardingState): boolean {
  switch (step) {
    case 3: return s.agentNameSet;
    case 5: return s.companyContext.trim().length >= 3;
    case 6: return s.voiceInteracted;
    case 7: return s.agentTypeSet;
    default: return true;
  }
}

// ─── Card positioning ─────────────────────────────────────────────────────────

interface Rect { top: number; left: number; width: number; height: number; }

function cardPos(rect: Rect | null, side: Side, noOverlay: boolean): { top: number; left: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth  : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  // noOverlay + no anchor → top-right corner (beside dialogs)
  if (noOverlay && !rect) {
    return { top: 24, left: vw - CARD_W - 24 };
  }

  if (!rect || side === "center") {
    return { top: Math.max(40, vh / 2 - 210), left: vw / 2 - CARD_W / 2 };
  }

  const cy = rect.top + rect.height / 2;
  const cx = rect.left + rect.width / 2;

  if (side === "left") return {
    top:  Math.max(8, Math.min(cy - 150, vh - 360)),
    left: Math.max(8, rect.left - PAD - CARD_W - 14),
  };
  if (side === "right") return {
    top:  Math.max(8, Math.min(cy - 150, vh - 360)),
    left: Math.min(rect.left + rect.width + PAD + 14, vw - CARD_W - 8),
  };
  return {
    top:  Math.min(rect.top + rect.height + PAD + 14, vh - 360),
    left: Math.max(8, Math.min(cx - CARD_W / 2, vw - CARD_W - 8)),
  };
}

// ─── Quad overlay ─────────────────────────────────────────────────────────────

function QuadOverlay({
  rect, flash, onOutsideClick,
}: {
  rect: Rect | null;
  flash: boolean;
  onOutsideClick: () => void;
}) {
  const bg: React.CSSProperties = {
    position: "fixed",
    zIndex: 9997,
    backgroundColor: flash ? "rgba(2,6,23,0.90)" : "rgba(2,6,23,0.78)",
    transition: "background-color 0.14s",
    cursor: "not-allowed",
  };

  if (!rect) return <div style={{ ...bg, inset: 0 }} onClick={onOutsideClick} />;

  const sTop = rect.top - PAD, sLeft = rect.left - PAD;
  const sW   = rect.width  + PAD * 2;
  const sH   = rect.height + PAD * 2;

  return (
    <>
      <div style={{ ...bg, top: 0, left: 0, right: 0, height: Math.max(0, sTop) }} onClick={onOutsideClick} />
      <div style={{ ...bg, top: sTop, left: 0, width: Math.max(0, sLeft), height: sH }} onClick={onOutsideClick} />
      <div style={{ ...bg, top: sTop, left: sLeft + sW, right: 0, height: sH }} onClick={onOutsideClick} />
      <div style={{ ...bg, top: sTop + sH, left: 0, right: 0, bottom: 0 }} onClick={onOutsideClick} />
    </>
  );
}

// ─── Spotlight ring ───────────────────────────────────────────────────────────

function SpotlightRing({ rect, flash }: { rect: Rect | null; flash: boolean }) {
  if (!rect) return null;
  return (
    <div style={{
      position: "fixed", zIndex: 9998, pointerEvents: "none",
      top: rect.top - PAD, left: rect.left - PAD,
      width: rect.width + PAD * 2, height: rect.height + PAD * 2,
      borderRadius: 10,
      border: flash ? "2px solid rgba(239,68,68,0.85)" : "2px solid rgba(99,102,241,0.65)",
      boxShadow: flash
        ? "0 0 0 4px rgba(239,68,68,0.18)"
        : "0 0 0 4px rgba(99,102,241,0.12)",
      transition: "border-color 0.18s, box-shadow 0.18s",
    }} />
  );
}

// ─── Waiting indicator ────────────────────────────────────────────────────────

function WaitingFor({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-indigo-500/25 bg-indigo-500/8 px-3 py-2">
      <span className="inline-block h-2 w-2 rounded-full bg-indigo-500 animate-pulse shrink-0" />
      <span className="text-[11px] text-indigo-300">{text}</span>
    </div>
  );
}

// ─── Step bodies ──────────────────────────────────────────────────────────────

function Step0({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1500);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="flex flex-col items-center gap-3 py-1">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/15 ring-1 ring-indigo-500/30">
        <span className="text-2xl">🤖</span>
      </div>
      <div className="text-center">
        <div className="text-sm font-semibold text-slate-100">Welcome to Webee!</div>
        <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
          Your design workspace is loaded. Let's build your voice agent step by step.
        </div>
      </div>
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1 w-1.5 rounded-full bg-indigo-500 animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
        ))}
      </div>
    </div>
  );
}

function Step1() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Click the <span className="text-indigo-300 font-medium">Templates</span> item in the navigation panel to browse baseline agent frameworks.
      </p>
      <WaitingFor text="Waiting for you to click Templates →" />
    </div>
  );
}

function Step2() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Click <span className="text-indigo-300 font-medium">Use template</span> on the{" "}
        <span className="text-white font-medium">Virtual Receptionist</span> card to import its conversation flow into the builder.
      </p>
      <WaitingFor text="Waiting for you to click Use template ↓" />
    </div>
  );
}

function Step3({ state }: { state: OnboardingState }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Click the <span className="text-indigo-300 font-medium">Agent name</span> field in the toolbar above and type your agent's name (minimum 3 characters).
      </p>
      {state.agentNameSet ? (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
          <span>✓</span><span>Agent name set — click Next to continue</span>
        </div>
      ) : (
        <WaitingFor text="Waiting for you to type a name ↑" />
      )}
    </div>
  );
}

function Step4() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Click the <span className="text-indigo-300 font-medium">✏️ pencil icon</span> on the{" "}
        <span className="text-white font-medium">Begin</span> node above to open the node editor. Set your{" "}
        <span className="text-amber-300 font-mono text-[10px]">{"{{agent_name}}"}</span> and{" "}
        <span className="text-amber-300 font-mono text-[10px]">{"{{company_name}}"}</span> variables in the greeting dialogue, then close the editor.
      </p>
      <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-[10px] text-slate-400 space-y-0.5">
        <div className="text-slate-300 font-medium mb-1">Example greeting:</div>
        <div className="font-mono text-[9px] leading-relaxed text-slate-400">
          "Thank you for calling{" "}
          <span className="text-amber-300">{"{{company_name}}"}</span>, this is{" "}
          <span className="text-amber-300">{"{{agent_name}}"}</span>. How can I help?"
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-indigo-400">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
        <span>Click Next when you're done editing the node</span>
      </div>
    </div>
  );
}

function Step5({ state, setState }: {
  state: OnboardingState;
  setState: (p: Partial<OnboardingState>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Expand the <span className="text-indigo-300 font-medium">Global Prompt</span> section in the panel to the right and enter a system prompt describing your company and agent persona.
      </p>
      <div>
        <label className="text-[10px] font-medium tracking-wide uppercase text-slate-400">Quick context (saved to tour)</label>
        <textarea
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 resize-none"
          placeholder="e.g. Acme Dental — AI receptionist for appointment booking"
          value={state.companyContext}
          onChange={(e) => setState({ companyContext: e.target.value })}
        />
        {state.companyContext.length > 0 && state.companyContext.trim().length < 3 && (
          <p className="text-[10px] text-red-400 mt-0.5">Minimum 3 characters</p>
        )}
      </div>
      {state.companyContext.trim().length >= 3 && (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
          <span>✓</span><span>Context saved — click Next</span>
        </div>
      )}
    </div>
  );
}

const VOICES = [
  { id: "emma",  label: "Emma",  desc: "Warm · Professional" },
  { id: "james", label: "James", desc: "Deep · Authoritative" },
  { id: "sofia", label: "Sofia", desc: "Friendly · Upbeat" },
];

function Step6({ state, setState }: {
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
    <div className="flex flex-col gap-2.5">
      <p className="text-xs text-slate-400 leading-relaxed">
        Choose a voice model or configure an ElevenLabs custom voice.
      </p>
      <div className="flex rounded-lg border border-slate-700 bg-slate-800/50 p-0.5 gap-0.5">
        {(["native", "elevenlabs"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 rounded-md py-0.5 text-[10px] font-medium transition-all ${
              tab === t ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
            }`}>
            {t === "native" ? "🎙 Native" : "⚡ ElevenLabs"}
          </button>
        ))}
      </div>
      {tab === "native" ? (
        <div className="flex flex-col gap-1">
          {VOICES.map((v) => (
            <div key={v.id} className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 ${
              state.voiceChosen === v.id ? "border-indigo-500 bg-indigo-500/10" : "border-slate-700 bg-slate-800/40"
            }`}>
              <div>
                <div className="text-[11px] font-semibold text-slate-100">{v.label}</div>
                <div className="text-[9px] text-slate-500">{v.desc}</div>
              </div>
              <button onClick={() => handlePreview(v.id)} disabled={playing !== null}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-medium ${
                  playing === v.id ? "bg-indigo-600 text-white" : "border border-slate-600 bg-slate-700/80 text-slate-300 hover:bg-slate-600"
                }`}>
                {playing === v.id ? <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Playing</> : "▶ Preview"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <label className="text-[10px] font-medium tracking-wide uppercase text-slate-400">API Key</label>
          <input
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500"
            placeholder="xi_xxxxxxxxxxxxxxxx"
            value={state.elevenLabsKey}
            onChange={(e) => setState({ elevenLabsKey: e.target.value, voiceInteracted: e.target.value.length >= 6 })}
          />
        </div>
      )}
      {state.voiceInteracted && (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-400"><span>✓</span><span>Voice configured</span></div>
      )}
    </div>
  );
}

function Step7({ state, setState }: {
  state: OnboardingState;
  setState: (p: Partial<OnboardingState>) => void;
}) {
  function setReceptionist() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useBuilderStore } = require("@/lib/builder/store");
      useBuilderStore.getState().setSettings?.({ agentType: "receptionist" });
    } catch { /* no-op if store not loaded */ }
    setState({ agentTypeSet: true });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Scroll down the Agent Settings panel and set the{" "}
        <span className="text-indigo-300 font-medium">Agent Type</span> dropdown to{" "}
        <span className="text-white font-medium">Receptionist</span>.
      </p>
      {!state.agentTypeSet ? (
        <button onClick={setReceptionist}
          className="flex items-center justify-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-600/15 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/25 transition-all">
          ⚙️ Set Agent Type → Receptionist
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
          <span className="text-emerald-400">✓</span>
          <span className="text-xs font-semibold text-emerald-400">Agent Type: Receptionist</span>
        </div>
      )}
    </div>
  );
}

function Step8({ saved }: { saved: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Click the <span className="text-indigo-300 font-medium">Save</span> button in the toolbar to compile your conversation flow and register the agent on Retell.
      </p>
      {!saved ? (
        <WaitingFor text="Waiting for you to click Save ↑" />
      ) : (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 animate-in fade-in">
          <span>🛠️</span><span className="font-semibold">Agent compiled! Navigating to registry…</span>
        </div>
      )}
    </div>
  );
}

function Step9() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Click the <span className="text-white font-medium">+</span> button in the builder toolbar to deploy your agent to Retell AI. This creates a real live voice agent.
      </p>
      <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-[10px] text-slate-400 space-y-1">
        <div className="text-slate-200 font-medium text-[11px]">What this does</div>
        <p className="leading-relaxed">Compiles your conversation flow and uploads it to Retell's infrastructure so it can handle real phone calls.</p>
      </div>
      <WaitingFor text="Waiting for you to click the + Deploy button ↑" />
    </div>
  );
}

function Step10() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Click the <span className="text-indigo-300 font-medium">Agents</span> icon in the navigation panel to view your deployment registry.
      </p>
      <WaitingFor text="Waiting for you to click Agents →" />
    </div>
  );
}

function Step11() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Locate your agent card and click the{" "}
        <span className="text-indigo-300 font-medium">Deploy</span> button to open the deployment wizard.
      </p>
      <WaitingFor text="Waiting for you to click Deploy ↓" />
    </div>
  );
}

function Step12() {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-[10px] text-slate-400 space-y-1">
        <div className="text-slate-200 font-medium text-[11px]">Step 1 of 3 — Workspace</div>
        <p className="leading-relaxed">
          In the dialog, click{" "}
          <span className="text-indigo-300 font-medium">Deploy to company workspace</span> to clone your agent into the production environment.
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-indigo-400">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
        <span>Click Next when the workspace deploy is done</span>
      </div>
    </div>
  );
}

function Step13() {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-[10px] text-slate-400 space-y-1">
        <div className="text-slate-200 font-medium text-[11px]">Step 2 of 3 — Phone Number</div>
        <p className="leading-relaxed">
          In the dialog, go to the{" "}
          <span className="text-indigo-300 font-medium">Buy number</span> tab and purchase a local or toll-free number, or use the{" "}
          <span className="text-indigo-300 font-medium">SIP trunk</span> tab to bring your own.
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-indigo-400">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
        <span>Click Next once your number is configured</span>
      </div>
    </div>
  );
}

function Step14() {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-[10px] text-slate-400 space-y-1">
        <div className="text-slate-200 font-medium text-[11px]">Step 3 of 3 — Calendar</div>
        <p className="leading-relaxed">
          Click the{" "}
          <span className="text-indigo-300 font-medium">Cal.com</span> tab, paste your Cal.com API key, and click Save. This enables automated appointment booking.
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-indigo-400">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
        <span>Click Next once Cal.com is connected</span>
      </div>
    </div>
  );
}

function Step15({ complete }: { complete: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Phone and Cal.com are set up — you're ready. Scroll to the top of the dialog and click{" "}
        <span className="text-white font-medium">Go Live</span> to publish your agent.
      </p>
      <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-[10px] text-slate-400">
        Status: <span className="text-amber-400">Draft</span>{" "}→{" "}
        <span className="text-emerald-400 font-semibold">Live</span>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-indigo-400">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
        <span>Clicking Go Live will also close this tour automatically</span>
      </div>
      <button
        onClick={complete}
        className="w-full rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-900/30 hover:from-indigo-500 hover:to-violet-500 transition-all"
      >
        🎉 Finish Tour
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

  const showNextFooter  = !cfg.autoStep && !cfg.clickGated;
  const showExitFooter  = cfg.clickGated && !cfg.autoStep;

  return (
    <div
      style={{
        position: "fixed", zIndex: 9999,
        top: pos.top, left: pos.left, width: CARD_W,
        animation: shaking ? "tour-shake 0.52s ease-in-out" : undefined,
      }}
      className="flex flex-col rounded-xl border border-slate-700/80 bg-[#111827] shadow-2xl shadow-black/70 ring-1 ring-white/[0.04]"
    >
      {/* Header — × always visible */}
      <div className="flex items-center gap-2 border-b border-slate-800 px-3.5 py-2">
        <span className="text-base leading-none">{cfg.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold text-slate-100 truncate">{cfg.label}</div>
          <div className="text-[9px] text-slate-500">Step {step + 1} / {STEPS.length}</div>
        </div>
        {/* Progress pips */}
        <div className="flex items-center gap-0.5 shrink-0 flex-wrap max-w-[60px] justify-end">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-0.5 rounded-full transition-all duration-300 ${
              i < step ? "w-2.5 bg-indigo-500" : i === step ? "w-3.5 bg-indigo-400" : "w-1 bg-slate-700"
            }`} />
          ))}
        </div>
        {/* Always-visible exit */}
        <button
          onClick={dismiss}
          title="Exit tour"
          className="ml-1 shrink-0 flex h-5 w-5 items-center justify-center rounded text-slate-600 hover:bg-slate-800 hover:text-slate-300 transition-colors text-[10px]"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="px-3.5 py-3">
        {step === 0  && <Step0  onDone={advance} />}
        {step === 1  && <Step1  />}
        {step === 2  && <Step2  />}
        {step === 3  && <Step3  state={state} />}
        {step === 4  && <Step4  />}
        {step === 5  && <Step5  state={state} setState={setState} />}
        {step === 6  && <Step6  state={state} setState={setState} />}
        {step === 7  && <Step7  state={state} setState={setState} />}
        {step === 8  && <Step8  saved={state.agentSaved} />}
        {step === 9  && <Step9  />}
        {step === 10 && <Step10 />}
        {step === 11 && <Step11 />}
        {step === 12 && <Step12 />}
        {step === 13 && <Step13 />}
        {step === 14 && <Step14 />}
        {step === 15 && <Step15 complete={complete} />}
      </div>

      {/* Footer — Next/Skip for form-gated steps */}
      {showNextFooter && (
        <div className="flex items-center justify-between border-t border-slate-800 px-3.5 py-2">
          <button onClick={dismiss}
            className="text-[9px] text-slate-600 hover:text-slate-400 transition-colors">
            Skip Guide
          </button>
          <div className="flex items-center gap-1.5">
            {!unlocked && (
              <span className="text-[8px] text-slate-600 max-w-[100px] text-right leading-tight">
                Complete step above
              </span>
            )}
            <button onClick={handleNext}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-[10px] font-semibold transition-all ${
                unlocked
                  ? "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm"
                  : "bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700"
              }`}>
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Exit-only footer for click-gated steps (no Next — user must click the real element) */}
      {showExitFooter && (
        <div className="flex items-center justify-end border-t border-slate-800 px-3.5 py-1.5">
          <button onClick={dismiss}
            className="text-[9px] text-slate-600 hover:text-slate-400 transition-colors">
            Exit tour
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function OnboardingTour() {
  const [mounted,    setMounted]    = useState(false);
  const navigate = useNavigate();
  const { state, setState, advance, dismiss, complete, visible } = useOnboarding();

  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
  const [shaking,    setShaking]    = useState(false);
  const [flash,      setFlash]      = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Navigate to the step's route whenever the step changes
  useEffect(() => {
    if (!mounted || !visible) return;
    const cfg = STEPS[state.step];
    if (cfg) navigate({ to: cfg.route as never });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, mounted, visible]);

  // Poll for the anchor element's rect
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
    pollRef.current = setInterval(() => { measure(); if (++attempts > 40) clearInterval(pollRef.current!); }, 150);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [state.step, mounted, visible]);

  // Re-measure on resize
  useEffect(() => {
    if (!mounted || !visible) return;
    const anchor = STEPS[state.step]?.anchor;
    if (!anchor) return;
    function onResize() {
      const el = document.querySelector(`[data-tour="${anchor}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        setAnchorRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [state.step, mounted, visible]);

  // ── Step 1: nav-templates click ──────────────────────────────────────────────
  useEffect(() => {
    if (!mounted || !visible || state.step !== 1) return;
    const el = document.querySelector('[data-tour="nav-templates"]');
    if (!el) return;
    function handler() { setTimeout(() => advance(), 80); }
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [state.step, mounted, visible, advance]);

  // ── Step 2: template-receptionist click ──────────────────────────────────────
  useEffect(() => {
    if (!mounted || !visible || state.step !== 2) return;
    let attempts = 0;
    function attach() {
      const card = document.querySelector('[data-tour="template-receptionist"]');
      if (!card) { if (++attempts < 30) setTimeout(attach, 300); return; }
      function handler() { setTimeout(() => advance(), 200); }
      card.addEventListener("click", handler);
      return () => card.removeEventListener("click", handler);
    }
    const cleanup = attach();
    return () => { if (typeof cleanup === "function") cleanup(); };
  }, [state.step, mounted, visible, advance]);

  // ── Step 3: agent-name-input typing ──────────────────────────────────────────
  useEffect(() => {
    if (!mounted || !visible || state.step !== 3) return;
    let attempts = 0;
    function attach() {
      const el = document.querySelector('[data-tour="agent-name-input"]') as HTMLInputElement | null;
      if (!el) { if (++attempts < 30) setTimeout(attach, 250); return; }
      if (el.value.trim().length >= 3) setState({ agentNameSet: true });
      function handler() { if (el.value.trim().length >= 3) setState({ agentNameSet: true }); }
      el.addEventListener("input", handler);
      return () => el.removeEventListener("input", handler);
    }
    const cleanup = attach();
    return () => { if (typeof cleanup === "function") cleanup(); };
  }, [state.step, mounted, visible, setState]);

  // ── Step 8: save-btn click ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mounted || !visible || state.step !== 8 || state.agentSaved) return;
    const el = document.querySelector('[data-tour="save-btn"]');
    if (!el) return;
    function handler() {
      setState({ agentSaved: true });
      setTimeout(() => advance(), 1200);
    }
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [state.step, mounted, visible, state.agentSaved, setState, advance]);

  // ── Step 9: builder-create-deploy-btn click → deploy to Retell ───────────────
  useEffect(() => {
    if (!mounted || !visible || state.step !== 9) return;
    let attempts = 0;
    function attach() {
      const el = document.querySelector('[data-tour="builder-create-deploy-btn"]');
      if (!el) { if (++attempts < 30) setTimeout(attach, 300); return; }
      function handler() { setTimeout(() => advance(), 1400); }
      el.addEventListener("click", handler);
      return () => el.removeEventListener("click", handler);
    }
    const cleanup = attach();
    return () => { if (typeof cleanup === "function") cleanup(); };
  }, [state.step, mounted, visible, advance]);

  // ── Step 10: nav-agents click ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mounted || !visible || state.step !== 10) return;
    const el = document.querySelector('[data-tour="nav-agents"]');
    if (!el) return;
    function handler() { setTimeout(() => advance(), 80); }
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [state.step, mounted, visible, advance]);

  // ── Step 11: agent-deploy-btn click → advance (dialog will open naturally) ───
  useEffect(() => {
    if (!mounted || !visible || state.step !== 11) return;
    let attempts = 0;
    function attach() {
      const el = document.querySelector('[data-tour="agent-deploy-btn"]');
      if (!el) { if (++attempts < 30) setTimeout(attach, 300); return; }
      function handler() { setTimeout(() => advance(), 150); }
      el.addEventListener("click", handler);
      return () => el.removeEventListener("click", handler);
    }
    const cleanup = attach();
    return () => { if (typeof cleanup === "function") cleanup(); };
  }, [state.step, mounted, visible, advance]);

  // ── Step 12: deploy-dialog-clone-btn — detect click for optional tracking ────
  useEffect(() => {
    if (!mounted || !visible || state.step !== 12) return;
    let attempts = 0;
    function attach() {
      const el = document.querySelector('[data-tour="deploy-dialog-clone-btn"]');
      if (!el) { if (++attempts < 20) setTimeout(attach, 300); return; }
      function handler() { setState({ deployWorkspaceClicked: true }); }
      el.addEventListener("click", handler);
      return () => el.removeEventListener("click", handler);
    }
    const cleanup = attach();
    return () => { if (typeof cleanup === "function") cleanup(); };
  }, [state.step, mounted, visible, setState]);

  // ── Step 15: Go Live button click → complete tour ─────────────────────────────
  useEffect(() => {
    if (!mounted || !visible || state.step !== 15) return;
    let attempts = 0;
    function attach() {
      const el = document.querySelector('[data-tour="deploy-dialog-golive-btn"]');
      if (!el) { if (++attempts < 30) setTimeout(attach, 300); return; }
      function handler() { setTimeout(() => complete(), 400); }
      el.addEventListener("click", handler);
      return () => el.removeEventListener("click", handler);
    }
    const cleanup = attach();
    return () => { if (typeof cleanup === "function") cleanup(); };
  }, [state.step, mounted, visible, complete]);

  const triggerShake = useCallback(() => {
    setShaking(true); setTimeout(() => setShaking(false), 550);
  }, []);

  const triggerFlash = useCallback(() => {
    setFlash(true); setTimeout(() => setFlash(false), 380);
  }, []);

  function handleOutsideClick() {
    triggerFlash();
    if (!isUnlocked(state.step, state)) triggerShake();
  }

  if (!mounted || !visible) return null;

  const cfg       = STEPS[state.step];
  const showOverlay = !cfg.noOverlay;
  const pos       = cardPos(anchorRect, cfg.side, cfg.noOverlay ?? false);

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
      {showOverlay && (
        <QuadOverlay rect={anchorRect} flash={flash} onOutsideClick={handleOutsideClick} />
      )}
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
