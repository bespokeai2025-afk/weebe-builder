import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindCampaigns } from "@/components/growthmind/GrowthMindCampaigns";

export const Route = createFileRoute("/_authenticated/growthmind/campaigns")({
  head: () => ({ meta: [{ title: "Campaigns — GrowthMind" }] }),
  component: GrowthMindCampaigns,
});
