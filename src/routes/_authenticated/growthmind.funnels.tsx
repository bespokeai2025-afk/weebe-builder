import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindFunnels } from "@/components/growthmind/GrowthMindFunnels";

export const Route = createFileRoute("/_authenticated/growthmind/funnels")({
  head: () => ({ meta: [{ title: "Funnels — GrowthMind" }] }),
  component: GrowthMindFunnels,
});
