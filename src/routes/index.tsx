import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Builder } from "@/components/builder/Builder";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Webee — Visual Voice Agent Builder" },
      {
        name: "description",
        content:
          "Visually map your AI call script and deploy a Webee voice agent in one click.",
      },
      { property: "og:title", content: "Webee — Visual Voice Agent Builder" },
      {
        property: "og:description",
        content: "Drag, connect, and deploy a Webee voice agent for your call script.",
      },
      { property: "og:url", content: "https://www.webespokeai.com" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://www.webespokeai.com" }],
  }),
  component: Index,
});

function Index() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(localStorage.getItem("webespoke-auth") === "1");
    const onStorage = () => setAuthed(localStorage.getItem("webespoke-auth") === "1");
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <Hero />
      <HowItWorks />

      {/* ── Interactive Builder section ── */}
      <section id="tool-section" className="border-b bg-background">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="text-center mb-10">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Interactive Tool
            </span>
            <h2 className="mt-3 text-3xl md:text-4xl font-bold tracking-tight">
              Try the Script Flow Builder
            </h2>
            <p className="mt-3 text-sm text-muted-foreground max-w-2xl mx-auto">
              Drag, connect, and fill in your call flow. Works on desktop and mobile. Deploy your
              Webee AI agent when you're ready.
            </p>
          </div>
          {authed ? (
            <Builder />
          ) : (
            <div className="mx-auto max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-400/10">
                <span className="text-2xl">🐝</span>
              </div>
              <h3 className="text-lg font-semibold">Sign in to access the builder</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Create your account to start building AI voice agents.
              </p>
              <Button asChild className="mt-5 w-full rounded-full bg-foreground text-background hover:opacity-90">
                <Link to="/login" search={{ redirect: "/dashboard" }}>
                  Get started
                </Link>
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t bg-muted/20">
        <div className="mx-auto max-w-7xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">Webee</span>
            <span>·</span>
            <span>Smart Dash &amp; Builder</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
              webespokeai.com
            </a>
            <span>·</span>
            <span>© {new Date().getFullYear()} Webespoke AI. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
