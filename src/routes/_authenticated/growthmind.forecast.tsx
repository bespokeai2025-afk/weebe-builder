import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindForecast } from "@/components/growthmind/GrowthMindForecast";

export const Route = createFileRoute("/_authenticated/growthmind/forecast")({
  head: () => ({ meta: [{ title: "Forecast — GrowthMind" }] }),
  component: GrowthMindForecast,
});
