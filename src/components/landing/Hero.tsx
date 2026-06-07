import { Link } from "@tanstack/react-router";
import { ArrowRight, Play, LayoutDashboard, Workflow } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import logoWebee from "@/assets/webee-logo-yellow.png";

export function Hero() {
  return (
    <>
      {/* ── Top announcement bar ── */}
      <div className="w-full bg-foreground text-background text-center text-xs font-medium py-2.5 px-4">
        WEBEE Smart Dash + Builder — AI voice agents with no code required.{" "}
        <Link to="/login" search={{ redirect: "/dashboard" }} className="underline underline-offset-2 hover:opacity-80">
          Get access →
        </Link>
      </div>

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <img src={logoWebee} alt="Webee" className="h-8 w-8 rounded-lg object-cover" />
            <div className="hidden sm:flex flex-col leading-none">
              <span className="text-sm font-bold tracking-tight">Webee</span>
              <span className="text-[9px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                The Voice of the Future
              </span>
            </div>
            <span className="ml-2 hidden md:inline-block h-4 w-px bg-border" />
            <span className="ml-2 hidden md:text-[10px] md:inline font-medium uppercase tracking-[0.12em] text-muted-foreground">
              by Webespoke AI
            </span>
          </div>

          <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a>
            <a href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Enterprise</a>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/login"
              search={{ redirect: "/dashboard" }}
              className="hidden sm:inline-flex items-center rounded-lg border px-3.5 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
            >
              Sign in
            </Link>
            <Link
              to="/login"
              search={{ redirect: "/dashboard" }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-1.5 text-sm font-semibold text-background hover:opacity-90 transition-opacity"
            >
              Get started <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-[#eef1f8] dark:bg-[#0a0d14]">
        {/* subtle grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right,#000 1px,transparent 1px),linear-gradient(to bottom,#000 1px,transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        <div className="relative mx-auto max-w-7xl px-6 py-16 md:py-24">
          <div className="flex flex-col gap-12 lg:flex-row lg:items-center lg:gap-16">

            {/* ── Left column ── */}
            <div className="flex-1 max-w-2xl">
              {/* badge */}
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-yellow-400/40 bg-yellow-400/10 px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-yellow-700 dark:text-yellow-300">
                  Built by Webespoke AI
                </span>
              </div>

              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05] text-foreground">
                The Hive That<br />
                <span className="text-yellow-500">Never Sleeps</span>
                <sup className="ml-1 text-2xl font-normal text-muted-foreground align-super">™</sup>
              </h1>

              <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-xl leading-relaxed">
                Deploy AI Receptionists, Sales Agents, Lead Generators and Support Agents in minutes.
                No coding required. Available 24/7.
              </p>

              <p className="mt-4 text-sm text-muted-foreground max-w-lg">
                Whether you need a plug-and-play AI Receptionist or a fully bespoke enterprise
                deployment, Webee helps businesses automate conversations, customer support, lead
                generation and business workflows at scale.
              </p>

              {/* CTAs */}
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/login"
                  search={{ redirect: "/dashboard" }}
                  className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background hover:opacity-90 transition-opacity shadow-lg"
                >
                  Open Smart Dash <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="https://www.webespokeai.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-foreground/20 bg-background/60 backdrop-blur-sm px-6 py-3 text-sm font-semibold hover:border-foreground/40 transition-colors"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Book Demo
                </a>
              </div>

              {/* trust line */}
              <p className="mt-5 text-xs text-muted-foreground">
                No developers required · No-code platform · Enterprise-grade security
              </p>

              {/* listen pill */}
              <a
                href="https://www.webespokeai.com"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex items-center gap-2.5 rounded-full border-2 border-yellow-400 bg-yellow-400/10 py-2 pl-2 pr-4 text-sm font-semibold text-yellow-700 dark:text-yellow-300 hover:bg-yellow-400/20 transition-colors"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-yellow-400 text-black">
                  <Play className="h-3.5 w-3.5 fill-black" />
                </span>
                Listen to our bees in action →
              </a>
            </div>

            {/* ── Right column — product preview ── */}
            <div className="flex-1 max-w-lg lg:max-w-none">
              <div className="relative rounded-2xl border border-white/20 bg-background shadow-2xl ring-1 ring-black/5 overflow-hidden">
                {/* Browser chrome */}
                <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-3">
                  <span className="h-3 w-3 rounded-full bg-red-400" />
                  <span className="h-3 w-3 rounded-full bg-yellow-400" />
                  <span className="h-3 w-3 rounded-full bg-green-400" />
                  <div className="ml-3 flex-1 rounded-md bg-background/80 px-3 py-1 text-[11px] text-muted-foreground">
                    webee.app · WEBEE Smart Dash · Live
                  </div>
                </div>

                {/* App preview content */}
                <div className="flex h-[340px] md:h-[400px]">
                  {/* Mini sidebar */}
                  <div className="w-[52px] shrink-0 border-r bg-[#0d1117] flex flex-col items-center py-3 gap-3">
                    <img src={logoWebee} alt="Webee" className="h-7 w-7 rounded-md object-cover" />
                    <div className="mt-2 flex flex-col gap-2">
                      {[LayoutDashboard, Workflow, Play].map((Icon, i) => (
                        <div
                          key={i}
                          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${i === 0 ? "bg-blue-500/20 text-blue-400" : "text-slate-600 hover:text-slate-400"}`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Main panel */}
                  <div className="flex-1 bg-[#0b0f14] p-4 overflow-hidden">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-slate-500">Smart Dash</p>
                        <p className="text-sm font-semibold text-slate-200">Overview</p>
                      </div>
                      <div className="flex gap-1.5">
                        <div className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                        <span className="text-[10px] text-yellow-400 font-medium">3 agents live</span>
                      </div>
                    </div>

                    {/* KPI strip */}
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {[
                        { label: "Total Calls", value: "1,284", delta: "+12%", color: "text-blue-400" },
                        { label: "Qualified", value: "347", delta: "+8%", color: "text-green-400" },
                        { label: "Booked", value: "89", delta: "+23%", color: "text-yellow-400" },
                      ].map((kpi) => (
                        <div key={kpi.label} className="rounded-lg bg-[#151d2b] p-2.5">
                          <p className="text-[9px] uppercase tracking-wider text-slate-500">{kpi.label}</p>
                          <p className={`text-base font-bold mt-0.5 ${kpi.color}`}>{kpi.value}</p>
                          <p className="text-[9px] text-green-400">{kpi.delta}</p>
                        </div>
                      ))}
                    </div>

                    {/* Table preview */}
                    <div className="rounded-lg bg-[#151d2b] overflow-hidden">
                      <div className="grid grid-cols-3 px-3 py-1.5 border-b border-white/5">
                        {["Lead", "Status", "Score"].map((h) => (
                          <span key={h} className="text-[9px] uppercase tracking-wider text-slate-500">{h}</span>
                        ))}
                      </div>
                      {[
                        { name: "Emma Thompson", status: "Qualified", score: 92, color: "bg-green-500/20 text-green-400" },
                        { name: "James Miller", status: "Booked", score: 87, color: "bg-yellow-500/20 text-yellow-400" },
                        { name: "Sarah Chen", status: "In progress", score: 74, color: "bg-blue-500/20 text-blue-400" },
                        { name: "Raj Patel", status: "New", score: 61, color: "bg-slate-500/20 text-slate-400" },
                      ].map((row) => (
                        <div key={row.name} className="grid grid-cols-3 items-center px-3 py-2 border-b border-white/[0.03] last:border-0">
                          <span className="text-[10px] text-slate-300 truncate">{row.name}</span>
                          <span className={`inline-flex w-fit rounded-full px-1.5 py-0.5 text-[9px] font-medium ${row.color}`}>{row.status}</span>
                          <div className="flex items-center gap-1.5">
                            <div className="h-1 flex-1 rounded-full bg-white/10">
                              <div className="h-full rounded-full bg-blue-500" style={{ width: `${row.score}%` }} />
                            </div>
                            <span className="text-[9px] text-slate-400 w-5">{row.score}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* caption */}
                <div className="border-t bg-muted/30 px-4 py-2 text-center text-[11px] text-muted-foreground">
                  Walkthrough of{" "}
                  <a href="#how-it-works" className="underline hover:text-foreground">WEBEE Builder</a>
                  {" & "}
                  <a href="#how-it-works" className="underline hover:text-foreground">WEBEE Smart Dash</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
