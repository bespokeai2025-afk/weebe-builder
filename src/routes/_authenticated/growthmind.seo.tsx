import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindSEO } from "@/components/growthmind/GrowthMindSEO";

export const Route = createFileRoute("/_authenticated/growthmind/seo")({
  head: () => ({ meta: [{ title: "SEO — GrowthMind" }] }),
  component: GrowthMindSEO,
});
