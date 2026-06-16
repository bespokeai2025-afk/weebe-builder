import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindProposals } from "@/components/growthmind/GrowthMindProposals";

export const Route = createFileRoute("/_authenticated/growthmind/proposals")({
  head: () => ({ meta: [{ title: "All Proposals — GrowthMind" }] }),
  component: GrowthMindProposals,
});
