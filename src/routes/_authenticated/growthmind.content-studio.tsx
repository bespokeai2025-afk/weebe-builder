import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindContentStudio } from "@/components/growthmind/GrowthMindContentStudio";

export const Route = createFileRoute("/_authenticated/growthmind/content-studio")({
  component: GrowthMindContentStudio,
});
