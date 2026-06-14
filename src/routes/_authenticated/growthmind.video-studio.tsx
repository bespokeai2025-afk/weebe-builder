import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindVideoStudio } from "@/components/growthmind/GrowthMindVideoStudio";

export const Route = createFileRoute("/_authenticated/growthmind/video-studio")({
  component: GrowthMindVideoStudio,
});
