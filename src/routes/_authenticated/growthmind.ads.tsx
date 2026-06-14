import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindAdsPlaceholder } from "@/components/growthmind/GrowthMindAdsPlaceholder";

export const Route = createFileRoute("/_authenticated/growthmind/ads")({
  head: () => ({ meta: [{ title: "Ads Intelligence — GrowthMind" }] }),
  component: GrowthMindAdsPlaceholder,
});
