import { createFileRoute } from "@tanstack/react-router";
import { SystemMindRecommendationsPage } from "@/components/systemmind/SystemMindRecommendationsPage";

export const Route = createFileRoute("/_authenticated/systemmind/recommendations")({
  component: SystemMindRecommendationsPage,
});
