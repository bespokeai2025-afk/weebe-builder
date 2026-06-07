import { Bot, Workflow, Rocket, PhoneCall, BarChart3, CalendarCheck } from "lucide-react";

const steps = [
  {
    icon: Workflow,
    n: "01",
    title: "Build Your Call Flow",
    body: "Drag, connect, and fill in conversation nodes — receptionist, sales, or support. Visual script builder, no code.",
    accent: "bg-blue-500/10 text-blue-500",
  },
  {
    icon: Bot,
    n: "02",
    title: "Configure Your Agent",
    body: "Assign a voice, set your agent's persona, define qualification criteria and booking logic.",
    accent: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  },
  {
    icon: Rocket,
    n: "03",
    title: "Go Live in One Click",
    body: "Deploy to your phone number. Your AI agent answers, qualifies, and books — 24/7, no downtime.",
    accent: "bg-green-500/10 text-green-600 dark:text-green-400",
  },
];

const features = [
  { icon: PhoneCall, title: "AI Voice Calls", body: "Outbound & inbound calls with natural-sounding AI agents." },
  { icon: BarChart3, title: "Smart Dashboard", body: "Real-time call analytics, lead scores, and pipeline overview." },
  { icon: CalendarCheck, title: "Auto Booking", body: "Agents book meetings directly into your calendar without human input." },
];

export function HowItWorks() {
  return (
    <>
      {/* ── Compliance strip ── */}
      <div className="border-y bg-muted/30">
        <div className="mx-auto max-w-7xl px-6 py-5 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-4">
            Compliance &amp; Platform Standards
          </p>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-xs text-muted-foreground">
            {["SOC 2 Ready", "GDPR Compliant", "End-to-end Encrypted", "99.9% Uptime SLA", "Enterprise SSO"].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── How it works ── */}
      <section id="how-it-works" className="border-b bg-background">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="text-center mb-14">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              How it works
            </span>
            <h2 className="mt-3 text-3xl md:text-4xl font-bold tracking-tight">
              Three steps to a Webee-ready agent
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto text-sm">
              From blank canvas to live AI agent — in under 10 minutes.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {steps.map((s) => (
              <div
                key={s.n}
                className="group relative rounded-2xl border bg-card p-7 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
              >
                <div className="absolute top-4 right-5 text-6xl font-black text-muted/20 select-none leading-none">
                  {s.n}
                </div>
                <div className={`mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl ${s.accent}`}>
                  <s.icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="border-b bg-[#eef1f8] dark:bg-[#0a0d14]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="text-center mb-12">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              What's included
            </span>
            <h2 className="mt-3 text-3xl md:text-4xl font-bold tracking-tight">
              Everything in one platform
            </h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-2xl border border-white/20 bg-background/70 backdrop-blur-sm p-6 shadow-sm">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/5">
                  <f.icon className="h-5 w-5 text-foreground/70" />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
