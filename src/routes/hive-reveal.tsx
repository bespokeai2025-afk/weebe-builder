import { createFileRoute } from "@tanstack/react-router";
import { HiveReveal } from "@/components/story/HiveReveal";
import storyCss from "@/styles/story.css?url";

/**
 * Isolated prototype for the full-screen spotlight-reveal hive mechanic.
 * Judges the INTERACTION (dark field, cursor as torch) independently of 3D
 * material quality — see HiveReveal.tsx for why. Not wired into /v2 yet.
 */
export const Route = createFileRoute("/hive-reveal")({
  head: () => ({
    meta: [
      { title: "WEBEE — spotlight hive prototype" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "stylesheet", href: storyCss }],
  }),
  component: () => (
    <main className="webee-story">
      <HiveReveal />
    </main>
  ),
});
