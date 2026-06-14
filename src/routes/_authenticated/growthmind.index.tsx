import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindOverview } from "@/components/growthmind/GrowthMindOverview";

export const Route = createFileRoute("/_authenticated/growthmind/")({
  head: () => ({ meta: [{ title: "GrowthMind — Webee" }] }),
  component: GrowthMindOverview,
});
