import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindGrowthScheduler } from "@/components/growthmind/GrowthMindGrowthScheduler";

export const Route = createFileRoute("/_authenticated/growthmind/growth-scheduler")({
  head: () => ({ meta: [{ title: "Growth Scheduler — GrowthMind" }] }),
  component: GrowthMindGrowthScheduler,
});
