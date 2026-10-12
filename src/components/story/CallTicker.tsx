/**
 * Live call strip for the hero.
 *
 * Proof before belief: rather than ask a visitor to read a claim about the
 * product, this types out a few lines of the same scripted call the node
 * demo runs further down the page, so the first screen already shows the
 * thing working.
 *
 * ISOLATION: react, lucide-react and ./data only.
 *
 * ACCESSIBILITY: the typing animation is aria-hidden. The full transcript of
 * the lines it cycles through sits in the DOM as a visually hidden .st-sr
 * block, so nothing here is information that exists only in an animation.
 * With prefers-reduced-motion, the lines render statically with no timer at
 * all, checked via matchMedia the same way HiveHero decides whether to
 * mount its 3D layer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneCall } from "lucide-react";
import { CALL_SCRIPT } from "./data";

const LINES = CALL_SCRIPT.filter(
  (s): s is Extract<typeof s, { kind: "turn" }> => s.kind === "turn",
).slice(0, 4);

const MAX_VISIBLE = 3;
const CHAR_MS = 26;
const LINE_HOLD_MS = 900;
const LOOP_HOLD_MS = 2200;

interface Shown {
  id: number;
  role: "agent" | "caller";
  text: string;
}

export function CallTicker() {
  const [reduced, setReduced] = useState<boolean | null>(null);
  const [completed, setCompleted] = useState<Shown[]>([]);
  const [partial, setPartial] = useState("");
  const [partialRole, setPartialRole] = useState<"agent" | "caller">("agent");

  const idx = useRef(0);
  const chars = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => setReduced(mq.matches);
    decide();
    mq.addEventListener("change", decide);
    return () => mq.removeEventListener("change", decide);
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    timer.current = setTimeout(fn, ms);
  }, []);

  // One recursive timer chain, matching the teardown pattern used by the
  // node demo's call simulation: a single ref to clear, no interval to leak.
  const step = useCallback(() => {
    const line = LINES[idx.current];
    if (chars.current < line.text.length) {
      chars.current += 1;
      setPartial(line.text.slice(0, chars.current));
      setPartialRole(line.role);
      schedule(step, CHAR_MS);
      return;
    }

    schedule(() => {
      setCompleted((c) => [...c, { id: idx.current, ...line }].slice(-(MAX_VISIBLE - 1)));
      idx.current += 1;
      chars.current = 0;

      if (idx.current >= LINES.length) {
        schedule(() => {
          idx.current = 0;
          setCompleted([]);
          setPartial("");
          schedule(step, 0);
        }, LOOP_HOLD_MS);
      } else {
        setPartial("");
        schedule(step, 0);
      }
    }, LINE_HOLD_MS);
  }, [schedule]);

  useEffect(() => {
    if (reduced !== false) return; // wait for the matchMedia answer; reduced -> no timer at all
    schedule(step, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reduced, schedule, step]);

  const label = (role: "agent" | "caller") => (role === "agent" ? "Agent" : "Caller");

  return (
    <div className="st-ticker">
      <div className="st-ticker-head">
        <PhoneCall size={13} aria-hidden="true" />
        <span>Live on a real workflow</span>
      </div>

      {reduced ? (
        <div className="st-ticker-rows">
          {LINES.slice(0, MAX_VISIBLE).map((l, i) => (
            <p className="st-ticker-row" data-role={l.role} key={i}>
              <span className="st-ticker-tag">{label(l.role)}</span>
              {l.text}
            </p>
          ))}
        </div>
      ) : (
        <div className="st-ticker-rows" aria-hidden="true">
          {completed.map((l) => (
            <p className="st-ticker-row st-ticker-row--done" data-role={l.role} key={l.id}>
              <span className="st-ticker-tag">{label(l.role)}</span>
              {l.text}
            </p>
          ))}
          <p className="st-ticker-row" data-role={partialRole}>
            <span className="st-ticker-tag">{label(partialRole)}</span>
            {partial}
            <span className="st-ticker-caret" />
          </p>
        </div>
      )}

      {/* The real content, for anyone not seeing the animation. */}
      <p className="st-sr">
        Example call transcript: {LINES.map((l) => `${label(l.role)}: ${l.text}`).join(" ")}
      </p>
    </div>
  );
}
