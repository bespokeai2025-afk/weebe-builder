import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindCompetitorsPlaceholder } from "@/components/growthmind/GrowthMindCompetitorsPlaceholder";

export const Route = createFileRoute("/_authenticated/growthmind/competitors")({
  head: () => ({ meta: [{ title: "Competitors — GrowthMind" }] }),
  component: GrowthMindCompetitorsPlaceholder,
});
