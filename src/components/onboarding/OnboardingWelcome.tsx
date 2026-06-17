import { useState, useEffect, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Brain, TrendingUp, Settings, Cpu, Zap, ArrowRight, ArrowLeft,
  CheckCircle2, Circle, Building2, Globe, Users, Target, Mic,
  LayoutDashboard, Link2, X, ChevronRight, Rocket, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getOnboardingState, setOnboardingPath, completeOnboardingStep,
  dismissOnboarding, saveOnboardingBusinessDna,
  type OnboardingPath, type CrmChoice,
} from "@/lib/onboarding/onboarding.server";

// ── Types ─────────────────────────────────────────────────────────────────────

type ModalStep =
  | "loading"
  | "welcome"
  | "path"
  | "dna"
  | "crm"
  | "summary_agent"
  | "summary_grow"
  | "summary_both";

// ── Platform pillars description ──────────────────────────────────────────────

const PILLARS = [
  {
    icon: Brain,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    ring: "ring-violet-500/20",
    label: "HiveMind",
    desc: "Executive Intelligence — your AI COO that observes, recommends and acts.",
  },
  {
    icon: TrendingUp,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/20",
    label: "GrowthMind",
    desc: "Marketing Intelligence — campaigns, content, ads, and growth analysis.",
  },
  {
    icon: Settings,
    color: "text-sky-400",
    bg: "bg-sky-500/10",
    ring: "ring-sky-500/20",
    label: "SystemMind",
    desc: "Operational Intelligence — infrastructure, reliability, and workflows.",
  },
  {
    icon: Cpu,
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    ring: "ring-orange-500/20",
    label: "Builder",
    desc: "AI Agent Creation Platform — build, deploy, and manage voice AI agents.",
  },
];

const PATHS: Array<{ value: OnboardingPath; label: string; sub: string; icon: any; color: string; bg: string }> = [
  {
    value: "agent_builder",
    label: "Build AI Agents",
    sub: "Set up voice and chat AI agents, knowledge bases, and telephony.",
    icon: Cpu,
    color: "text-orange-400",
    bg: "bg-orange-500/10",
  },
  {
    value: "grow",
    label: "Grow My Business",
    sub: "Marketing, campaigns, GrowthMind analysis, and HiveMind intelligence.",
    icon: TrendingUp,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  {
    value: "both",
    label: "Both",
    sub: "The full WEBEE platform — AI agents, marketing, and business intelligence.",
    icon: Zap,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
  },
];

const CRM_OPTIONS: Array<{ value: CrmChoice; label: string; desc: string; icon: any }> = [
  {
    value: "smart_dash",
    label: "Use WEBEE Smart Dash",
    desc: "Manage leads, calls, bookings, pipeline and contacts inside WEBEE.",
    icon: LayoutDashboard,
  },
  {
    value: "external",
    label: "Connect Existing CRM",
    desc: "HubSpot, Salesforce, Dynamics, Pipedrive, GoHighLevel and more.",
    icon: Link2,
  },
  {
    value: "skip",
    label: "Skip For Now",
    desc: "You can connect a CRM later in Settings.",
    icon: Circle,
  },
];

// ── DNA quick form ─────────────────────────────────────────────────────────────

interface DnaForm {
  companyName: string;
  industry: string;
  website: string;
  locations: string;
  targetCustomers: string;
  primaryGoal: string;
  brandVoice: string;
}

const DNA_DEFAULTS: DnaForm = {
  companyName: "",
  industry: "",
  website: "",
  locations: "",
  targetCustomers: "",
  primaryGoal: "",
  brandVoice: "Professional and approachable",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function OnboardingWelcome() {
  const navigate = useNavigate();
  const [step, setStep] = useState<ModalStep>("loading");
  const [selectedPath, setSelectedPath] = useState<OnboardingPath | null>(null);
  const [selectedCrm, setSelectedCrm] = useState<CrmChoice>("skip");
  const [dna, setDna] = useState<DnaForm>(DNA_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);

  const getStateFn     = useServerFn(getOnboardingState);
  const setPathFn      = useServerFn(setOnboardingPath);
  const completeFn     = useServerFn(completeOnboardingStep);
  const dismissFn      = useServerFn(dismissOnboarding);
  const saveDnaFn      = useServerFn(saveOnboardingBusinessDna);

  // Load state on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const state = await getStateFn();
        if (!mounted) return;
        // Show modal only if path not set and not dismissed
        if (!state.dismissed && !state.path) {
          setVisible(true);
          setStep("welcome");
        }
      } catch {
        // Non-critical — onboarding table may not exist yet
      }
    })();
    return () => { mounted = false; };
  }, []);

  const handleDismiss = useCallback(async () => {
    setVisible(false);
    try { await dismissFn(); } catch {}
  }, [dismissFn]);

  const handlePathSelect = useCallback(async (path: OnboardingPath) => {
    setSelectedPath(path);
    setSaving(true);
    try {
      await setPathFn({ data: { path } });
    } catch { /* non-critical */ }
    finally { setSaving(false); }

    // branch to next step
    if (path === "agent_builder") {
      setStep("summary_agent");
    } else {
      setStep("dna");
    }
  }, [setPathFn]);

  const handleDnaSave = useCallback(async (skipToSummary = false) => {
    setSaving(true);
    try {
      if (dna.companyName.trim()) {
        await saveDnaFn({ data: dna });
      }
    } catch { /* non-critical */ }
    finally { setSaving(false); }

    if (skipToSummary) {
      if (selectedPath === "grow")   setStep("summary_grow");
      if (selectedPath === "both")   setStep("summary_both");
    } else {
      setStep("crm");
    }
  }, [saveDnaFn, dna, selectedPath]);

  const handleCrmChoice = useCallback(async (choice: CrmChoice) => {
    setSelectedCrm(choice);
    setSaving(true);
    try {
      await completeFn({ data: { crm_choice: choice, connections_done: true } });
    } catch {}
    finally { setSaving(false); }

    if (selectedPath === "grow") setStep("summary_grow");
    if (selectedPath === "both") setStep("summary_both");
  }, [completeFn, selectedPath]);

  const handleComplete = useCallback(async (destination: string) => {
    setSaving(true);
    try {
      await completeFn({ data: { completed: true } });
    } catch {}
    finally { setSaving(false); }
    setVisible(false);
    navigate({ to: destination as any });
  }, [completeFn, navigate]);

  if (!visible) return null;
  if (step === "loading") return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl rounded-2xl border border-white/[0.10] bg-[#0d0d12] shadow-2xl shadow-black/60 overflow-hidden">

        {/* Progress strip */}
        <StepProgress step={step} path={selectedPath} />

        {/* Dismiss button */}
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.05] text-muted-foreground hover:bg-white/[0.10] hover:text-foreground transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="p-8">
          {step === "welcome" && <WelcomeStep onNext={() => setStep("path")} />}
          {step === "path"    && <PathStep onSelect={handlePathSelect} saving={saving} />}
          {step === "dna"     && (
            <DnaStep
              dna={dna}
              onChange={setDna}
              saving={saving}
              onNext={() => handleDnaSave(false)}
              onSkip={() => handleDnaSave(true)}
              onBack={() => setStep("path")}
            />
          )}
          {step === "crm" && (
            <CrmStep
              selected={selectedCrm}
              saving={saving}
              onSelect={handleCrmChoice}
              onBack={() => setStep("dna")}
            />
          )}
          {step === "summary_agent" && (
            <SummaryAgentStep
              onDone={() => handleComplete("/builder")}
              saving={saving}
            />
          )}
          {step === "summary_grow" && (
            <SummaryGrowStep
              crmChoice={selectedCrm}
              onDone={() => handleComplete("/growthmind")}
              saving={saving}
            />
          )}
          {step === "summary_both" && (
            <SummaryBothStep
              crmChoice={selectedCrm}
              onDone={() => handleComplete("/growthmind")}
              saving={saving}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step Progress bar ─────────────────────────────────────────────────────────

function StepProgress({ step, path }: { step: ModalStep; path: OnboardingPath | null }) {
  const stepOrder: ModalStep[] = path === "agent_builder"
    ? ["welcome", "path", "summary_agent"]
    : path === "grow" || path === "both"
    ? ["welcome", "path", "dna", "crm", path === "grow" ? "summary_grow" : "summary_both"]
    : ["welcome", "path"];

  const current = stepOrder.indexOf(step);
  const pct = current <= 0 ? 0 : Math.round((current / (stepOrder.length - 1)) * 100);

  return (
    <div className="h-1 w-full bg-white/[0.04]">
      <div
        className="h-1 bg-gradient-to-r from-violet-500 to-emerald-500 transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Step: Welcome ─────────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext(): void }) {
  return (
    <div className="space-y-7 text-center">
      <div className="space-y-2">
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/30 to-emerald-500/30 ring-1 ring-white/10">
            <Zap className="h-7 w-7 text-white" />
          </div>
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Welcome to WEBEE</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          Your AI-powered business operating system. Here's what's waiting for you:
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {PILLARS.map(p => (
          <div key={p.label} className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left">
            <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1", p.bg, p.ring)}>
              <p.icon className={cn("h-4 w-4", p.color)} />
            </div>
            <div>
              <p className="text-xs font-semibold">{p.label}</p>
              <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{p.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <Button
        onClick={onNext}
        className="w-full gap-2 bg-gradient-to-r from-violet-600 to-emerald-600 hover:from-violet-500 hover:to-emerald-500 text-white border-0">
        Get Started <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ── Step: Path Selection ──────────────────────────────────────────────────────

function PathStep({ onSelect, saving }: { onSelect(p: OnboardingPath): void; saving: boolean }) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold">What would you like to do?</h2>
        <p className="text-sm text-muted-foreground">Choose your focus — you can always access all areas later.</p>
      </div>

      <div className="space-y-3">
        {PATHS.map(p => (
          <button
            key={p.value}
            onClick={() => !saving && onSelect(p.value)}
            disabled={saving}
            className="w-full flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 text-left hover:border-white/[0.15] hover:bg-white/[0.05] transition-all group disabled:opacity-50">
            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", p.bg)}>
              <p.icon className={cn("h-5 w-5", p.color)} />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">{p.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{p.sub}</p>
            </div>
            {saving
              ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            }
          </button>
        ))}
      </div>

      <p className="text-center text-[10px] text-muted-foreground/60">
        Your platform knowledge bases are already prepared — no WEBEE business data is included.
      </p>
    </div>
  );
}

// ── Step: Business DNA Quick Form ─────────────────────────────────────────────

function DnaStep({
  dna, onChange, saving, onNext, onSkip, onBack,
}: {
  dna: DnaForm;
  onChange(d: DnaForm): void;
  saving: boolean;
  onNext(): void;
  onSkip(): void;
  onBack(): void;
}) {
  const field = (key: keyof DnaForm, label: string, placeholder: string, required = false) => (
    <div className="space-y-1">
      <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </Label>
      <Input
        value={dna[key]}
        onChange={e => onChange({ ...dna, [key]: e.target.value })}
        placeholder={placeholder}
        className="h-9 text-sm"
      />
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">Tell us about your business</h2>
        <p className="text-sm text-muted-foreground">
          This becomes your Business DNA — private to your workspace. You can complete the full profile later.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {field("companyName",    "Business Name",       "Acme Ltd",                                 true)}
        {field("industry",       "Industry",            "e.g. Real Estate, SaaS, Healthcare",       true)}
        {field("website",        "Website",             "https://example.com")}
        {field("locations",      "Locations",           "e.g. London, Manchester")}
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Target Customers <span className="text-red-400 ml-0.5">*</span>
        </Label>
        <textarea
          rows={2}
          value={dna.targetCustomers}
          onChange={e => onChange({ ...dna, targetCustomers: e.target.value })}
          placeholder="Describe your ideal customer — who they are, their role, size of company…"
          className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-white/20 focus:outline-none transition-colors"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {field("primaryGoal",    "Primary Goal",        "e.g. Generate more qualified leads")}
        {field("brandVoice",     "Brand Voice",         "e.g. Professional, friendly, authoritative")}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="flex-1" />
        <button onClick={onSkip} className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3">
          Skip for now
        </button>
        <Button
          onClick={onNext}
          disabled={saving || !dna.companyName.trim() || !dna.industry.trim() || !dna.targetCustomers.trim()}
          className="gap-2 bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-40">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Save & Continue
        </Button>
      </div>
    </div>
  );
}

// ── Step: CRM Choice ──────────────────────────────────────────────────────────

function CrmStep({
  selected, saving, onSelect, onBack,
}: {
  selected: CrmChoice;
  saving: boolean;
  onSelect(c: CrmChoice): void;
  onBack(): void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">Business Operations Setup</h2>
        <p className="text-sm text-muted-foreground">
          How would you like to manage your leads, contacts, and pipeline?
        </p>
      </div>

      <div className="space-y-2">
        {CRM_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => !saving && onSelect(opt.value)}
            disabled={saving}
            className="w-full flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left hover:border-white/[0.15] hover:bg-white/[0.05] transition-all group disabled:opacity-50">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
              <opt.icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
            </div>
            {saving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <p className="flex-1 text-center text-[10px] text-muted-foreground/60">
          CRM connection is fully optional — you can change this anytime.
        </p>
      </div>
    </div>
  );
}

// ── Summary Steps ─────────────────────────────────────────────────────────────

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      {done
        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
        : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />}
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

function SummaryAgentStep({ onDone, saving }: { onDone(): void; saving: boolean }) {
  return (
    <div className="space-y-6 text-center">
      <div className="space-y-2">
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/15 ring-1 ring-orange-500/20">
            <Cpu className="h-7 w-7 text-orange-400" />
          </div>
        </div>
        <h2 className="text-xl font-bold">Ready to build AI Agents</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Your platform knowledge bases are set up. Here's your getting-started checklist:
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3 text-left">
        <ChecklistItem done={false} label="Create your first Knowledge Base" />
        <ChecklistItem done={false} label="Build and configure your AI Agent" />
        <ChecklistItem done={false} label="Set up telephony (Twilio / SIP trunk)" />
        <ChecklistItem done={false} label="Deploy your agent" />
      </div>

      <Button
        onClick={onDone}
        disabled={saving}
        className="w-full gap-2 bg-orange-500/20 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
        Go to Agent Builder
      </Button>
    </div>
  );
}

function SummaryGrowStep({ crmChoice, onDone, saving }: { crmChoice: CrmChoice; onDone(): void; saving: boolean }) {
  return (
    <div className="space-y-6 text-center">
      <div className="space-y-2">
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/20">
            <TrendingUp className="h-7 w-7 text-emerald-400" />
          </div>
        </div>
        <h2 className="text-xl font-bold">You're ready to grow</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Business DNA saved, platform knowledge installed, CRM choice recorded. Your checklist:
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3 text-left">
        <ChecklistItem done={true}  label="Platform knowledge bases created" />
        <ChecklistItem done={true}  label="Business DNA started" />
        <ChecklistItem done={crmChoice !== "skip"} label={crmChoice === "smart_dash" ? "Using WEBEE Smart Dash as CRM" : crmChoice === "external" ? "CRM connection noted (set up in Settings)" : "CRM — set up later"} />
        <ChecklistItem done={false} label="Upload business knowledge (products, FAQs, docs)" />
        <ChecklistItem done={false} label="Connect marketing platforms (optional)" />
        <ChecklistItem done={false} label="Review GrowthMind analysis and first campaign" />
      </div>

      <Button
        onClick={onDone}
        disabled={saving}
        className="w-full gap-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
        Go to GrowthMind
      </Button>
    </div>
  );
}

function SummaryBothStep({ crmChoice, onDone, saving }: { crmChoice: CrmChoice; onDone(): void; saving: boolean }) {
  return (
    <div className="space-y-6 text-center">
      <div className="space-y-2">
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15 ring-1 ring-violet-500/20">
            <Zap className="h-7 w-7 text-violet-400" />
          </div>
        </div>
        <h2 className="text-xl font-bold">Full platform unlocked</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Platform knowledge installed, Business DNA started. Your full checklist:
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3 text-left">
        <ChecklistItem done={true}  label="Platform knowledge bases created" />
        <ChecklistItem done={true}  label="Business DNA started" />
        <ChecklistItem done={crmChoice !== "skip"} label="CRM / Smart Dash configured" />
        <ChecklistItem done={false} label="Upload business knowledge (products, FAQs, docs)" />
        <ChecklistItem done={false} label="Create first AI Agent" />
        <ChecklistItem done={false} label="Review GrowthMind analysis" />
        <ChecklistItem done={false} label="Launch first campaign" />
      </div>

      <Button
        onClick={onDone}
        disabled={saving}
        className="w-full gap-2 bg-violet-500/20 border border-violet-500/30 text-violet-300 hover:bg-violet-500/30">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
        Enter WEBEE
      </Button>
    </div>
  );
}
