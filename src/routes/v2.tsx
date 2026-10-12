import { createFileRoute } from "@tanstack/react-router";
import { StoryPage } from "@/components/story/StoryPage";
import storyCss from "@/styles/story.css?url";

/**
 * The new interactive landing page, built at its own route so the live `/`
 * stays untouched until this is approved and swapped in.
 *
 * story.css is linked per-route rather than globally: it carries the
 * `.webee-story` token scope and nothing outside this page should see it.
 */
export const Route = createFileRoute("/v2")({
  head: () => ({
    meta: [
      { title: "WEBEE — Never lose another customer to a missed call" },
      {
        name: "description",
        content:
          "WEBEE answers every call in a natural voice, qualifies the caller, books them into your diary and updates your CRM — day, night and weekends. Try the live demo.",
      },
      { property: "og:title", content: "WEBEE — AI voice agents that answer every call" },
      {
        property: "og:description",
        content:
          "Build an AI agent, give it tools, and watch it book a customer. Try it on the page — no signup.",
      },
      { property: "og:url", content: "https://www.webespokeai.com/v2" },
      // Not indexable while this is a preview. Remove when it becomes `/`.
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "stylesheet", href: storyCss }],
  }),
  component: StoryPage,
});
