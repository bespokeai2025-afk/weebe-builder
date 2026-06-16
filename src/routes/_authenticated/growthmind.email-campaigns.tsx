import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindEmailCampaigns } from "@/components/growthmind/GrowthMindEmailCampaigns";

export const Route = createFileRoute("/_authenticated/growthmind/email-campaigns")({
  head: () => ({ meta: [{ title: "Email Campaigns — GrowthMind" }] }),
  component: GrowthMindEmailCampaigns,
});
