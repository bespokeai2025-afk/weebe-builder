import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/Logo";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b bg-gradient-to-b from-background to-muted/30">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <div className="mx-auto max-w-5xl px-6 py-20 md:py-28 text-center">
        <Logo className="mx-auto h-14 md:h-16 mb-6" />
        <span className="inline-flex items-center rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
          Webespoke AI — Script Flow Builder
        </span>
        <h1 className="mt-6 text-4xl md:text-6xl font-semibold tracking-tight">
          Map Your <span className="italic text-primary">AI Call Script</span>
          <br className="hidden md:block" /> Before You Build It
        </h1>
        <p className="mt-5 mx-auto max-w-2xl text-base md:text-lg text-muted-foreground">
          Lay out your call structure, transitions, and dialogue visually — then deploy your
          Webespoke AI agent in one click.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <a href="#tool-section">
              Start Building <ArrowRight className="h-4 w-4 ml-1" />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#how-it-works">How It Works</a>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link to="/builder" search={{ new: undefined }}>
              Open full builder
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
