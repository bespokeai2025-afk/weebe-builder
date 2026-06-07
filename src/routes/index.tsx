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
      <section id="tool-section" className="border-b">
        <div className="mx-auto max-w-7xl px-4 py-16">
          <div className="text-center mb-8">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Interactive Tool
            </span>
            <h2 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight">
              Script Flow Builder
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
              <h3 className="text-lg font-semibold">Sign in required</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Enter your credentials to access the builder.
              </p>
              <Button asChild className="mt-5 w-full">
                <Link to="/login" search={{ redirect: "/dashboard" }}>
                  Sign in
                </Link>
              </Button>
            </div>
          )}
        </div>
      </section>
      <footer className="mx-auto max-w-7xl px-4 py-10 text-center text-xs text-muted-foreground">
        <a
          href="https://www.webespokeai.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          Webee · by Webespoke AI
        </a>
      </footer>
    </main>
  );
}
