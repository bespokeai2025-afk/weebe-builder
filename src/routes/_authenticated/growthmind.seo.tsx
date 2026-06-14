import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindSEOPlaceholder } from "@/components/growthmind/GrowthMindSEOPlaceholder";

export const Route = createFileRoute("/_authenticated/growthmind/seo")({
  head: () => ({ meta: [{ title: "SEO — GrowthMind" }] }),
  component: GrowthMindSEOPlaceholder,
});
