import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindForecastPlaceholder } from "@/components/growthmind/GrowthMindForecastPlaceholder";

export const Route = createFileRoute("/_authenticated/growthmind/forecast")({
  head: () => ({ meta: [{ title: "Forecast — GrowthMind" }] }),
  component: GrowthMindForecastPlaceholder,
});
