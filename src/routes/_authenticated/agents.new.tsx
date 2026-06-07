import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FilePlus2, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBuilderStore } from "@/lib/builder/store";

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

  function startFromScratch() {
    useBuilderStore.getState().clearAll();
    navigate({ to: "/builder", search: { new: "1" } });
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
              <Button asChild className="w-full">
                <Link to="/templates" search={{ mode: "picker" }}>
                  Browse templates
                </Link>
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
