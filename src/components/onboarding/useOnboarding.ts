import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "webee_onboarding_v1";
const RESTART_EVENT = "webee-tour-restart";

export interface OnboardingState {
  completed: boolean;
  dismissed: boolean;
  step: number;
  // Step 3
  agentNameSet: boolean;
  // Step 4
  companyContext: string;
  // Step 5
  voiceChosen: string;
  voiceInteracted: boolean;
  elevenLabsKey: string;
  // Step 6
  agentTypeSet: boolean;
  // Step 7
  agentSaved: boolean;
  // Step 9
  deployWorkspaceClicked: boolean;
  // Step 10
  authAllowed: boolean;
  // Step 11
  phoneChoice: "local" | "trunk" | null;
  phoneValue: string;
  // Step 12
  calConnected: boolean;
  // Step 13
  deployed: boolean;
}

const DEFAULTS: OnboardingState = {
  completed: false,
  dismissed: false,
  step: 0,
  agentNameSet: false,
  companyContext: "",
  voiceChosen: "",
  voiceInteracted: false,
  elevenLabsKey: "",
  agentTypeSet: false,
  agentSaved: false,
  deployWorkspaceClicked: false,
  authAllowed: false,
  phoneChoice: null,
  phoneValue: "",
  calConnected: false,
  deployed: false,
};

function load(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(state: OnboardingState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

export function restartTour() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  window.dispatchEvent(new Event(RESTART_EVENT));
}

export function useOnboarding() {
  const [state, setStateRaw] = useState<OnboardingState>(load);

  useEffect(() => {
    const handler = () => setStateRaw({ ...DEFAULTS });
    window.addEventListener(RESTART_EVENT, handler);
    return () => window.removeEventListener(RESTART_EVENT, handler);
  }, []);

  const setState = useCallback((
    updater: Partial<OnboardingState> | ((prev: OnboardingState) => Partial<OnboardingState>),
  ) => {
    setStateRaw((prev) => {
      const patch = typeof updater === "function" ? updater(prev) : updater;
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  const advance  = useCallback(() => setState((p) => ({ step: Math.min(p.step + 1, 14) })), [setState]);
  const dismiss  = useCallback(() => setState({ dismissed: true }),                           [setState]);
  const complete = useCallback(() => setState({ completed: true, dismissed: true }),          [setState]);
  const reset    = useCallback(() => restartTour(),                                           []);
  const visible  = !state.completed && !state.dismissed;

  return { state, setState, advance, dismiss, complete, reset, visible };
}

export type UseOnboardingReturn = ReturnType<typeof useOnboarding>;
