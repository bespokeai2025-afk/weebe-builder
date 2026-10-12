/**
 * The interactive node demo.
 *
 * ISOLATION: imports react, lucide-react and ./data only. No production
 * Builder, no zustand, no server functions, no network. The "Test Agent"
 * button runs a local timer chain over a fixed script — it cannot create an
 * agent, place a call, touch a calendar or write to a CRM.
 *
 * INTERACTION: tap/click/Enter to fill a slot. There is no drag affordance at
 * all — not a disabled one, not a hidden one — so the keyboard path and the
 * touch path are the only paths, and they are the same path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, RotateCcw, Check, Plus, X, FastForward, Volume2, VolumeX, Sparkles } from "lucide-react";

/** The request SystemMind "receives" in the demo, and what it builds from it. */
const AI_PROMPT = "Qualify new callers and book them straight into the diary";
const AI_BUILD: [StoryNodeKind, StoryNodeKind] = ["qualify_lead", "book_appointment"];
import {
  ACTION_LABEL,
  CALL_SCRIPT,
  NODE_DEFS,
  PALETTE,
  type ActionKey,
  type ScriptStep,
  type StoryNodeKind,
} from "./data";
import { createCallVoice, estimateMs, type Speaker } from "./callAudio";

/** Stable recording name per spoken line: turn-1 … turn-N in script order.
 *  Keyed by text so filtering the script never shifts which file plays. */
const TURN_KEY = (() => {
  const m = new Map<string, string>();
  let n = 0;
  for (const s of CALL_SCRIPT) if (s.kind === "turn") m.set(s.text, `turn-${++n}`);
  return m;
})();

type SlotIndex = 0 | 1;
type Slots = [StoryNodeKind | null, StoryNodeKind | null];
type Status = "idle" | "running" | "done";

interface Turn {
  id: number;
  role: "agent" | "caller";
  text: string;
}

/** action -> the node that is responsible for emitting it */
const ACTION_OWNER = (() => {
  const m = {} as Record<ActionKey, StoryNodeKind>;
  for (const def of Object.values(NODE_DEFS)) {
    for (const a of def.emits) m[a] = def.kind;
  }
  return m;
})();

export function MiniBuilder() {
  const [slots, setSlots] = useState<Slots>(["qualify_lead", "book_appointment"]);
  const [picking, setPicking] = useState<SlotIndex | null>(null);
  const [selected, setSelected] = useState<StoryNodeKind | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeNode, setActiveNode] = useState<StoryNodeKind | null>(null);
  const [doneNodes, setDoneNodes] = useState<StoryNodeKind[]>([]);
  const [doneActions, setDoneActions] = useState<ActionKey[]>([]);
  const [announcement, setAnnouncement] = useState("");

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);
  // The Conversation panel. On narrow screens it stacks BELOW the Test
  // button, so starting a call scrolls it into view — otherwise visitors hear
  // the call but never see the transcript or the results.
  const convoRef = useRef<HTMLDivElement>(null);

  // Audio. The voice engine is created on the client only (it touches window).
  // `runId` invalidates an in-flight spoken run the moment it is reset,
  // skipped or unmounted, so a late `end` event can never push stale lines.
  const voice = useRef<ReturnType<typeof createCallVoice> | null>(null);
  const runId = useRef(0);
  const [canSpeak, setCanSpeak] = useState(false);
  const [sound, setSound] = useState(true);
  const soundRef = useRef(true);
  const [speaking, setSpeaking] = useState<Speaker | null>(null);
  const [ringing, setRinging] = useState(false);
  // Word-by-word reveal of the line being spoken. revealId changes once per
  // line (cheap re-render); the per-frame progress lives in a ref that only
  // the revealing line's <TurnText> reads, so the builder doesn't re-render
  // 60 times a second.
  const [revealId, setRevealId] = useState<number | null>(null);
  const progress = useRef(0);
  const getLevel = useCallback(() => voice.current?.level() ?? -1, []);

  useEffect(() => {
    voice.current = createCallVoice();
    setCanSpeak(voice.current.supported);
    return () => voice.current?.cancel();
  }, []);

  const toggleSound = () => {
    const next = !soundRef.current;
    soundRef.current = next;
    setSound(next);
    // Muting mid-call stops the current line; the call carries on silently
    // at reading pace rather than stopping.
    if (!next) voice.current?.cancel();
    else voice.current?.unlock();
  };

  const placed = useMemo(() => {
    const s = new Set<StoryNodeKind>(["incoming_call", "ai_agent"]);
    for (const k of slots) if (k) s.add(k);
    return s;
  }, [slots]);

  /**
   * Keep only the steps the visitor's own workflow can actually produce, then
   * close the gaps that filtering leaves behind so the call doesn't stall in
   * silence. Pure function of (script, placed) — same input, same output.
   */
  const script = useMemo(() => {
    const kept = CALL_SCRIPT.filter((s) => {
      if (s.kind === "signal") return placed.has(s.node);
      if (s.kind === "action") return placed.has(ACTION_OWNER[s.action]);
      if (s.kind === "turn") return !s.requires || placed.has(s.requires);
      return true;
    });

    const out: ScriptStep[] = [];
    let prevSrc = 0;
    let clock = 0;
    for (const s of kept) {
      const gap = s.at - prevSrc;
      clock += Math.min(gap, 1700); // compress dead air left by removed steps
      prevSrc = s.at;
      out.push({ ...s, at: clock });
    }
    return out;
  }, [placed]);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    runId.current++;
    voice.current?.cancel();
    setSpeaking(null);
  }, []);

  // One teardown for every timer, so unmounting mid-call leaves nothing behind.
  useEffect(() => clearTimers, [clearTimers]);

  const resetState = useCallback(() => {
    clearTimers();
    setTurns([]);
    setActiveNode(null);
    setDoneNodes([]);
    setDoneActions([]);
    setStatus("idle");
    setAnnouncement("");
    setRinging(false);
    setRevealId(null);
    setSpeaking(null);
  }, [clearTimers]);

  const apply = useCallback((step: ScriptStep, turnId: number) => {
    if (step.kind === "turn") {
      setTurns((t) => [...t, { id: turnId, role: step.role, text: step.text }]);
    } else if (step.kind === "signal") {
      setActiveNode(step.node);
      setDoneNodes((d) => (d.includes(step.node) ? d : [...d, step.node]));
    } else if (step.kind === "action") {
      setDoneActions((a) => (a.includes(step.action) ? a : [...a, step.action]));
      setAnnouncement(ACTION_LABEL[step.action]);
    } else {
      setActiveNode(null);
      setStatus("done");
      setAnnouncement("Call complete. Results below.");
    }
  }, []);

  /** Jump straight to the finished state. Also the reduced-motion path. */
  const applyAll = useCallback(() => {
    clearTimers();
    const t: Turn[] = [];
    const nodes: StoryNodeKind[] = [];
    const actions: ActionKey[] = [];
    script.forEach((s, i) => {
      if (s.kind === "turn") t.push({ id: i, role: s.role, text: s.text });
      else if (s.kind === "signal") nodes.push(s.node);
      else if (s.kind === "action") actions.push(s.action);
    });
    setTurns(t);
    setDoneNodes([...new Set(nodes)]);
    setDoneActions([...new Set(actions)]);
    setActiveNode(null);
    setStatus("done");
    setAnnouncement("Call complete. Results below.");
  }, [script, clearTimers]);

  const start = useCallback(() => {
    if (soundRef.current) voice.current?.unlock();
    resetState();
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 920px)").matches) {
      requestAnimationFrame(() =>
        convoRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }),
      );
    }

    if (reduced) {
      // Not a lesser fallback — the same data model evaluated at t = end.
      applyAll();
      return;
    }

    setStatus("running");
    setAnnouncement("Simulated call starting.");

    if (!soundRef.current || !voice.current?.supported) {
      // Silent: the original fixed timeline.
      script.forEach((step, i) => {
        timers.current.push(setTimeout(() => apply(step, i), step.at));
      });
      return;
    }

    // Spoken: the call follows the audio. Each line is shown, then spoken,
    // and the next step waits for it to finish — fixed timestamps would let
    // the transcript run ahead of the voice. The "Test" click that got us
    // here is the user gesture browsers require before playing sound.
    const id = runId.current;
    const wait = (ms: number) =>
      new Promise<void>((res) => {
        timers.current.push(setTimeout(res, ms));
      });
    const live = () => runId.current === id;

    void (async () => {
      // The phone rings and is picked up before Ava speaks.
      setRinging(true);
      await voice.current!.ring();
      if (!live()) return;
      setRinging(false);

      for (let i = 0; i < script.length; i++) {
        if (!live()) return;
        const step = script[i];
        if (step.kind === "turn") {
          progress.current = 0;
          setRevealId(soundRef.current ? i : null);
          apply(step, i);
          if (soundRef.current) {
            setSpeaking(step.role);
            await voice.current!.speak(
              step.role,
              step.text,
              TURN_KEY.get(step.text) ?? "turn-0",
              (f) => {
                progress.current = f;
              },
            );
            if (!live()) return;
            setSpeaking(null);
            setRevealId(null);
          } else {
            await wait(estimateMs(step.text));
          }
          // People don't answer on a fixed beat: a slightly different gap
          // each time reads as a conversation, not a script.
          await wait(220 + Math.random() * 420);
        } else {
          // Signals and actions between lines: a short beat, like the agent
          // working while the caller waits.
          await wait(step.kind === "end" ? 350 : 450);
          if (!live()) return;
          apply(step, i);
        }
      }
    })();
  }, [script, apply, applyAll, resetState]);

  // Keep the newest line in view — scrolls its OWN container, never the page.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const setSlot = (i: SlotIndex, kind: StoryNodeKind | null) => {
    setSlots((s) => {
      const next = [...s] as Slots;
      next[i] = kind;
      return next;
    });
    setPicking(null);
    if (status !== "idle") resetState();
    if (kind) setSelected(kind);
  };

  // SystemMind build: types the prompt, clears the open slots, then fills them
  // one at a time, as if the AI were placing nodes. Deterministic and offline;
  // all timers go through `timers`, so reset/unmount cancels it cleanly.
  const [aiText, setAiText] = useState("");
  const [building, setBuilding] = useState(false);

  const buildWithAI = () => {
    resetState();
    setPicking(null);
    setSlots([null, null]);
    setBuilding(true);
    setAnnouncement("SystemMind is building the workflow.");

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

    let t = 0;
    if (reduced) {
      setAiText(AI_PROMPT);
    } else {
      for (let i = 1; i <= AI_PROMPT.length; i++) {
        const slice = AI_PROMPT.slice(0, i);
        at((t += 28), () => setAiText(slice));
      }
    }
    AI_BUILD.forEach((kind, i) => {
      at((t += reduced ? 0 : 550), () => {
        setSlots((s) => {
          const next = [...s] as Slots;
          next[i] = kind;
          return next;
        });
        setSelected(kind);
      });
    });
    at((t += reduced ? 0 : 300), () => {
      setBuilding(false);
      setAnnouncement(
        `SystemMind added ${AI_BUILD.map((k) => NODE_DEFS[k].label).join(" and ")}. Press Test this agent to hear it.`,
      );
    });
  };

  const used = slots.filter(Boolean) as StoryNodeKind[];
  const canTest = used.length > 0;
  const inspected = selected ? NODE_DEFS[selected] : null;

  const visibleActions = useMemo(
    () => script.filter((s): s is Extract<ScriptStep, { kind: "action" }> => s.kind === "action"),
    [script],
  );

  return (
    <div className="st-builder">
      {/* ── App window, styled after the real WEBEE Builder ─────────────
          Title bar, node palette on the left, navy grid canvas, zoom
          controls and minimap where the real ones sit, and the SystemMind
          bar at the bottom. All drawn in code with a neutral demo agent
          name — no screenshot, no client data. */}
      <div className="st-app-col">
      {/* Says plainly what the navy window is: the product, shown inside the
          brand. The navy is the real Builder's colour, kept on purpose. */}
      <div className="st-app-tag">
        <span className="st-app-tag-dot" aria-hidden="true" /> WEBEE Builder · simplified preview
      </div>
      <div className="st-app">
        <div className="st-app-bar" aria-hidden="true">
          <span className="st-app-title">Dental reception</span>
          <span className="st-app-tab st-app-tab--on">Voice</span>
          <span className="st-app-tab">WhatsApp</span>
          <span className="st-app-saved">
            <Check size={11} /> Saved
          </span>
        </div>
        <div className="st-app-body">
          {/* Palette. Always reachable; it is how you fill a slot without drag. */}
          <aside className="st-app-palette" role="group" aria-label="Available nodes">
            <div className="st-app-palette-head">Node</div>
            {PALETTE.map((kind) => {
              const def = NODE_DEFS[kind];
              const Icon = def.icon;
              const inUse = used.includes(kind);
              const target: SlotIndex | null =
                picking !== null ? picking : slots[0] === null ? 0 : slots[1] === null ? 1 : null;
              return (
                <button
                  key={kind}
                  type="button"
                  className="st-app-pal-item"
                  disabled={inUse || target === null || building}
                  onClick={() => target !== null && setSlot(target, kind)}
                  aria-label={inUse ? `${def.label} is already in the workflow` : `Add ${def.label}: ${def.summary}`}
                >
                  <Icon size={14} aria-hidden="true" style={{ color: def.typeColor }} />
                  <span>{def.label}</span>
                  {inUse && <Check size={12} aria-hidden="true" className="st-app-pal-check" />}
                </button>
              );
            })}
            <p className="st-app-palette-more">+14 more node types in the full Builder</p>
          </aside>

          <div className="st-canvas st-app-canvas">
        <div className="st-flow">
          <FlowNode
            kind="incoming_call"
            state={nodeState("incoming_call", activeNode, doneNodes)}
            selected={selected === "incoming_call"}
            onSelect={() => setSelected("incoming_call")}
          />
          <div className="st-link" data-live={doneNodes.includes("ai_agent")} />
          <FlowNode
            kind="ai_agent"
            state={nodeState("ai_agent", activeNode, doneNodes)}
            selected={selected === "ai_agent"}
            onSelect={() => setSelected("ai_agent")}
          />

          <div className="st-branch">
            {([0, 1] as SlotIndex[]).map((i) => (
              <div className="st-branch-arm" key={i}>
                {slots[i] ? (
                  <FlowNode
                    kind={slots[i]!}
                    state={nodeState(slots[i]!, activeNode, doneNodes)}
                    selected={selected === slots[i]}
                    onSelect={() => setSelected(slots[i]!)}
                    onRemove={() => setSlot(i, null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="st-node"
                    data-state="empty"
                    onClick={() => setPicking(picking === i ? null : i)}
                    aria-expanded={picking === i}
                    aria-label={`Add an action to slot ${i + 1}`}
                  >
                    <Plus size={15} aria-hidden="true" />
                    <span className="st-node-label">Add an action</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

            {/* Decorative chrome in the real positions. Spans, not buttons —
                nothing here pretends to be a control it isn't. */}
            <div className="st-app-zoom" aria-hidden="true">
              <span>+</span>
              <span>−</span>
              <span>⤢</span>
            </div>
            <div className="st-app-minimap" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>

            {/* SystemMind: describe it, and it builds the workflow. Simulated —
                a fixed prompt types out and fills the two open slots. */}
            <div className="st-app-ai">
              <Sparkles size={14} aria-hidden="true" className="st-app-ai-icon" />
              <span className="st-app-ai-text" aria-live="polite">
                {aiText ? (
                  <>
                    {aiText}
                    {building && <span className="st-app-ai-caret" aria-hidden="true" />}
                  </>
                ) : (
                  <span className="st-app-ai-placeholder">Ask SystemMind to configure this agent workflow…</span>
                )}
              </span>
              <button
                type="button"
                className="st-app-ai-build"
                onClick={buildWithAI}
                disabled={building || status === "running"}
              >
                <Sparkles size={12} aria-hidden="true" />
                {building ? "Building…" : "Build"}
              </button>
            </div>
          </div>
        </div>
      </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "center",
            marginTop: 20,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="st-btn st-btn--primary"
            onClick={start}
            disabled={!canTest || status === "running" || building}
          >
            <Play size={15} aria-hidden="true" />
            {status === "running" ? "Call in progress…" : "Test this agent"}
          </button>
          {status === "running" && (
            <button type="button" className="st-btn st-btn--ghost" onClick={applyAll}>
              <FastForward size={15} aria-hidden="true" />
              Skip to results
            </button>
          )}
          {status === "done" && (
            <button type="button" className="st-btn st-btn--ghost" onClick={start}>
              <RotateCcw size={15} aria-hidden="true" />
              Run again
            </button>
          )}
        </div>

        <p
          style={{
            textAlign: "center",
            fontSize: 12,
            marginTop: 12,
            color: "var(--story-dim)",
          }}
        >
          Simulated. No real call is placed and nothing is saved.
        </p>
      </div>

      {/* ── Side panel ────────────────────────────────────────────────── */}
      <div className="st-side" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="st-panel st-convo" ref={convoRef}>
          <div className="st-panel-head st-panel-head--split">
            {status === "running" && ringing ? (
              <span className="st-live">
                <span className="st-live-dot st-live-dot--ring" /> Calling Harborview Dental…
              </span>
            ) : status === "running" ? (
              <span className="st-live">
                <span className="st-live-dot" /> Live call
                {speaking && (
                  <span className="st-voice" aria-hidden="true">
                    <VoiceBars who={speaking} getLevel={getLevel} />
                    {speaking === "agent" ? "Ava" : "Caller"}
                  </span>
                )}
              </span>
            ) : (
              "Conversation"
            )}
            {canSpeak && (
              <button
                type="button"
                className="st-sound"
                onClick={toggleSound}
                aria-pressed={sound}
                aria-label={sound ? "Turn call sound off" : "Turn call sound on"}
              >
                {sound ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}
                {sound ? "Sound on" : "Sound off"}
              </button>
            )}
          </div>
          {turns.length === 0 ? (
            <div className="st-panel-body">
              <p style={{ fontSize: 13 }}>
                {inspected ? inspected.summary : "Press Test this agent to hear how the call goes."}
              </p>
            </div>
          ) : (
            <div className="st-thread" ref={threadRef}>
              {turns.map((t) => (
                <div className="st-turn" data-role={t.role} key={t.id}>
                  <span className="st-turn-avatar" aria-hidden="true">
                    {t.role === "agent" ? "AI" : "👤"}
                  </span>
                  <span className="st-turn-text">
                    <span className="st-sr">{t.role === "agent" ? "Agent: " : "Caller: "}</span>
                    <TurnText text={t.text} live={t.id === revealId} progress={progress} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="st-panel">
          <div className="st-panel-head">What the agent did</div>
          <div className="st-panel-body">
            {visibleActions.length === 0 ? (
              <p style={{ fontSize: 13 }}>Add an action to the workflow to see it run.</p>
            ) : (
              <div className="st-ledger">
                {visibleActions.map((a) => {
                  const done = doneActions.includes(a.action);
                  return (
                    <div className="st-ledger-row" data-done={done} key={a.action}>
                      {done ? (
                        <Check className="st-ledger-icon" size={15} aria-hidden="true" />
                      ) : (
                        <span
                          aria-hidden="true"
                          style={{
                            width: 15,
                            height: 15,
                            flex: "none",
                            borderRadius: "50%",
                            border: "1.5px solid rgba(255,255,255,0.18)",
                          }}
                        />
                      )}
                      {ACTION_LABEL[a.action]}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Narration for screen readers: every action announced exactly once. */}
      <p className="st-sr" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function nodeState(
  kind: StoryNodeKind,
  active: StoryNodeKind | null,
  done: StoryNodeKind[],
): "idle" | "active" | "done" {
  if (active === kind) return "active";
  if (done.includes(kind)) return "done";
  return "idle";
}

function FlowNode({
  kind,
  state,
  selected,
  onSelect,
  onRemove,
}: {
  kind: StoryNodeKind;
  state: "idle" | "active" | "done";
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const def = NODE_DEFS[kind];
  const Icon = def.icon;
  return (
    <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center" }}>
      <button
        type="button"
        className="st-node"
        data-state={state}
        data-selected={selected}
        onClick={onSelect}
        aria-label={`${def.label}. ${def.summary}`}
      >
        {/* Same anatomy as a real Builder node card: type header with its
            palette colour, title, then a one-line preview of what it does. */}
        <span className="st-node-card">
          <span className="st-node-type">
            <Icon size={12} aria-hidden="true" style={{ color: def.typeColor }} />
            {def.nodeType}
            {state === "done" && <span className="st-node-sub">done</span>}
          </span>
          <span className="st-node-label">{def.label}</span>
          <span className="st-node-blurb">{def.blurb}</span>
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="st-node-remove"
          aria-label={`Remove ${def.label}`}
          style={{
            position: "absolute",
            top: -7,
            right: "calc(50% - 138px)",
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: "1px solid var(--story-border-hi)",
            background: "var(--story-bg-raised)",
            color: "var(--story-dim)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * A transcript line. While it is the line being spoken (`live`), words
 * appear in step with playback progress; every word is in the DOM from the
 * start (hidden ones are transparent), so the bubble never reflows and screen
 * readers get the whole line at once.
 */
function TurnText({
  text,
  live,
  progress,
}: {
  text: string;
  live: boolean;
  progress: { current: number };
}) {
  const words = useMemo(() => text.split(" "), [text]);
  const [shown, setShown] = useState(live ? 0 : words.length);
  useEffect(() => {
    if (!live) {
      setShown(words.length);
      return;
    }
    let raf = 0;
    const tick = () => {
      // Slightly ahead of the audio reads as in sync; exactly on it reads late.
      const n = Math.min(words.length, Math.ceil((progress.current + 0.06) * words.length));
      setShown((prev) => (n > prev ? n : prev));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, words, progress]);
  return (
    <>
      {words.map((w, i) => (
        <span key={i} className="st-word" data-on={i < shown ? "1" : undefined}>
          {w}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

/**
 * Speaking bars. When the recording can be measured (getLevel() >= 0) each
 * bar follows the real loudness, with a little per-bar variation; otherwise
 * (browser speech) it falls back to the CSS loop.
 */
function VoiceBars({ who, getLevel }: { who: Speaker; getLevel: () => number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bars = Array.from(el.children) as HTMLElement[];
    const shape = [0.75, 1, 0.85, 0.6];
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      const lvl = getLevel();
      if (lvl >= 0) {
        el.dataset.live = "1";
        smooth += (lvl - smooth) * 0.35;
        const t = performance.now() / 120;
        bars.forEach((b, i) => {
          const wobble = 0.85 + 0.15 * Math.sin(t + i * 1.7);
          b.style.transform = `scaleY(${Math.max(0.18, Math.min(1, smooth * shape[i] * wobble)).toFixed(3)})`;
        });
      } else if (el.dataset.live) {
        delete el.dataset.live;
        bars.forEach((b) => (b.style.transform = ""));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLevel]);
  return (
    <span className="st-voice-bars" data-who={who} ref={ref}>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
