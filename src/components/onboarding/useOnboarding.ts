import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "webee_onboarding_v1";
const RESTART_EVENT = "webee-tour-restart";

export interface OnboardingState {
  completed: boolean;
  dismissed: boolean;
  step: number;
  buildPath: "template" | "scratch" | null;
  companyName: string;
  industry: string;
  voiceChosen: string;
  voiceInteracted: boolean;
  elevenLabsKey: string;
  adminVerified: boolean;
  calConnected: boolean;
  phoneChoice: "local" | "trunk" | null;
  phoneValue: string;
  deployed: boolean;
}

const DEFAULTS: OnboardingState = {
  completed: false,
  dismissed: false,
  step: 0,
  buildPath: null,
  companyName: "",
  industry: "",
  voiceChosen: "",
  voiceInteracted: false,
  elevenLabsKey: "",
  adminVerified: false,
  calConnected: false,
  phoneChoice: null,
  phoneValue: "",
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
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

  const advance = useCallback(() => {
    setState((prev) => ({ step: Math.min(prev.step + 1, 6) }));
  }, [setState]);

  const dismiss   = useCallback(() => setState({ dismissed: true }),              [setState]);
  const complete  = useCallback(() => setState({ completed: true, dismissed: true }), [setState]);
  const reset     = useCallback(() => restartTour(),                              []);
  const visible   = !state.completed && !state.dismissed;

  return { state, setState, advance, dismiss, complete, reset, visible };
}

export type UseOnboardingReturn = ReturnType<typeof useOnboarding>;
