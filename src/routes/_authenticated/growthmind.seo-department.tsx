import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindSEODepartment } from "@/components/growthmind/GrowthMindSEODepartment";

export const Route = createFileRoute("/_authenticated/growthmind/seo-department")({
  head: () => ({ meta: [{ title: "SEO Department — GrowthMind" }] }),
  component: GrowthMindSEODepartment,
});
