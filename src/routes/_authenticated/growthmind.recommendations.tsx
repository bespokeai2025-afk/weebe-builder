import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindRecommendations } from "@/components/growthmind/GrowthMindRecommendations";

export const Route = createFileRoute("/_authenticated/growthmind/recommendations")({
  head: () => ({ meta: [{ title: "Recommendations — GrowthMind" }] }),
  component: GrowthMindRecommendations,
});
