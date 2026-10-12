import { createFileRoute } from "@tanstack/react-router";
import { HiveGlowPage } from "@/components/story/HiveGlow";
import storyCss from "@/styles/story.css?url";

/** Backlit hex wall hero, from the owner's reference mock. Prototype — not wired into /v2. */
export const Route = createFileRoute("/hive-glow")({
  head: () => ({
    meta: [
      { title: "WEBEE — backlit hex wall prototype" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [
      { rel: "stylesheet", href: storyCss },
      // Self-hosted headline + body fonts (see TYPE + GOLD PASS in story.css).
      // Preloaded so the headline does not flash in a fallback serif;
      // crossOrigin is required on font preloads even same-origin.
      { rel: "preload", as: "font", type: "font/woff2", href: "/fonts/fraunces-latin.woff2", crossOrigin: "anonymous" },
      { rel: "preload", as: "font", type: "font/woff2", href: "/fonts/plus-jakarta-sans-latin.woff2", crossOrigin: "anonymous" },
    ],
  }),
  component: () => (
    <main className="webee-story st-hive">
      <HiveGlowPage />
    </main>
  ),
});
