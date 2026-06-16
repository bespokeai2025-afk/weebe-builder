import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindPromptStudio } from "@/components/growthmind/GrowthMindPromptStudio";

export const Route = createFileRoute("/_authenticated/growthmind/prompt-studio")({
  component: GrowthMindPromptStudio,
});
