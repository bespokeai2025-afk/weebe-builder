import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { useState } from "react";
import { FilePlus2, LayoutTemplate, Zap, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBuilderStore } from "@/lib/builder/store";
import { cn } from "@/lib/utils";
import type { BuilderSettings } from "@/lib/builder/types";

type VoiceProvider = "RETELL" | "OPENAI_REALTIME";

const PROVIDER_OPTIONS: {
  value: VoiceProvider;
  label: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}[] = [
  {
    value: "RETELL",
    label: "Retell AI",
    sub: "Managed cloud — default",
    icon: Radio,
  },
  {
    value: "OPENAI_REALTIME",
    label: "Native OpenAI Fast Engine",
    sub: "In-house realtime streaming",
    icon: Zap,
    badge: "Enterprise",
  },
];

export const Route = createFileRoute("/_authenticated/agents/new")({
  head: () => ({
    meta: [
      { title: "New Agent — Webee" },
      {
        name: "description",
        content: "Start a new voice agent from a template or build from scratch.",
      },
    ],
  }),
  component: AgentsNewPage,
});

function AgentsNewPage() {
  const navigate = useNavigate();
  const [provider, setProvider] = useState<VoiceProvider>("RETELL");

  function applyProviderToStore() {
    const store = useBuilderStore.getState();
    store.setSettings({ voiceProvider: provider } as Partial<BuilderSettings>);
  }

  function startFromScratch() {
    const store = useBuilderStore.getState();
    store.clearAll();
    store.setSettings({ voiceProvider: provider } as Partial<BuilderSettings>);
    navigate({ to: "/builder", search: { new: "1" } });
  }

  function browseTemplates() {
    applyProviderToStore();
    navigate({ to: "/templates", search: { mode: "picker" } });
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12 space-y-8">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Create a new agent</h1>
          <p className="text-sm text-muted-foreground">
            Choose a starting point. You can customize everything in the builder afterward.
          </p>
        </div>

        {/* Voice infrastructure selector */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Voice Infrastructure
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {PROVIDER_OPTIONS.map(({ value, label, sub, icon: Icon, badge }) => {
              const isActive = provider === value;
              return (
                <button
                  key={value}
                  onClick={() => setProvider(value)}
                  className={cn(
                    "relative flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-150",
                    isActive
                      ? "border-primary/60 bg-primary/5 ring-1 ring-primary/25"
                      : "border-border bg-card hover:border-border/80 hover:bg-muted/30",
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "text-sm font-medium",
                          isActive ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {label}
                      </span>
                      {badge && (
                        <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold border border-amber-500/20">
                          {badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5">{sub}</p>
                  </div>
                  {isActive && (
                    <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
          {provider === "OPENAI_REALTIME" && (
            <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
              OpenAI voice profiles and reasoning effort can be configured in the builder sidebar.
              No API key input required — billing is handled server-side.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="flex flex-col">
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                <LayoutTemplate className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg">Use a template</CardTitle>
              <CardDescription>
                Start from a proven global flow — receptionist, lead gen, medical, and more.
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto pt-0">
              <Button className="w-full" onClick={browseTemplates}>
                Browse templates
              </Button>
            </CardContent>
          </Card>

          <Card className="flex flex-col">
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground mb-2">
                <FilePlus2 className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg">Start from scratch</CardTitle>
              <CardDescription>
                Open an empty canvas with default nodes. Best when you already know your flow.
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto pt-0">
              <Button variant="outline" className="w-full" onClick={startFromScratch}>
                Open blank builder
              </Button>
            </CardContent>
          </Card>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/my-agents" className="underline hover:text-foreground">
            Back to my agents
          </Link>
        </p>
      </div>
    </main>
  );
}
