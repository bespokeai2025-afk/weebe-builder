import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindReports } from "@/components/growthmind/GrowthMindReports";

export const Route = createFileRoute("/_authenticated/growthmind/reports")({
  head: () => ({ meta: [{ title: "Reports — GrowthMind" }] }),
  component: GrowthMindReports,
});
