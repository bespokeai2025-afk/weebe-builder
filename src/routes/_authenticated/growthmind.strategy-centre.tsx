import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindStrategyCentre } from "@/components/growthmind/GrowthMindStrategyCentre";

export const Route = createFileRoute("/_authenticated/growthmind/strategy-centre")({
  head: () => ({ meta: [{ title: "Strategy Centre — GrowthMind" }] }),
  component: GrowthMindStrategyCentre,
});
