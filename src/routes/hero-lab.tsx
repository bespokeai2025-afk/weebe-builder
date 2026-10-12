import { createFileRoute } from "@tanstack/react-router";
import { HeroLab } from "@/components/story/HeroLab";
import storyCss from "@/styles/story.css?url";

/** Internal comparison page for the four hero 3D concepts. Not for launch. */
export const Route = createFileRoute("/hero-lab")({
  head: () => ({
    meta: [
      { title: "WEBEE — hero concept lab" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "stylesheet", href: storyCss }],
  }),
  component: HeroLab,
});
