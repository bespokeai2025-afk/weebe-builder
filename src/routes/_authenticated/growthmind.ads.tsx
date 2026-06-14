import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindAds } from "@/components/growthmind/GrowthMindAds";

export const Route = createFileRoute("/_authenticated/growthmind/ads")({
  head: () => ({ meta: [{ title: "Ads Intelligence — GrowthMind" }] }),
  component: GrowthMindAds,
});
