import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindFunnelsPlaceholder } from "@/components/growthmind/GrowthMindFunnelsPlaceholder";

export const Route = createFileRoute("/_authenticated/growthmind/funnels")({
  head: () => ({ meta: [{ title: "Funnels — GrowthMind" }] }),
  component: GrowthMindFunnelsPlaceholder,
});
