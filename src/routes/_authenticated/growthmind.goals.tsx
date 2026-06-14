import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindGoals } from "@/components/growthmind/GrowthMindGoals";

export const Route = createFileRoute("/_authenticated/growthmind/goals")({
  head: () => ({ meta: [{ title: "Goals — GrowthMind" }] }),
  component: GrowthMindGoals,
});
