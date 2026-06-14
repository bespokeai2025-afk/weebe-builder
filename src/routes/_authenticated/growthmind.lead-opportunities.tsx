import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindLeadOpportunities } from "@/components/growthmind/GrowthMindLeadOpportunities";

export const Route = createFileRoute("/_authenticated/growthmind/lead-opportunities")({
  head: () => ({ meta: [{ title: "Lead Opportunities — GrowthMind" }] }),
  component: GrowthMindLeadOpportunities,
});
