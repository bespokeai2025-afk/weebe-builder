import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindCompetitors } from "@/components/growthmind/GrowthMindCompetitors";

export const Route = createFileRoute("/_authenticated/growthmind/competitors")({
  head: () => ({ meta: [{ title: "Competitors — GrowthMind" }] }),
  component: GrowthMindCompetitors,
});
