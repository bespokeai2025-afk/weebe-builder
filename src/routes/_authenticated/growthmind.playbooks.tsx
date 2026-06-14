import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindPlaybooksPlaceholder } from "@/components/growthmind/GrowthMindPlaybooksPlaceholder";

export const Route = createFileRoute("/_authenticated/growthmind/playbooks")({
  head: () => ({ meta: [{ title: "Playbooks — GrowthMind" }] }),
  component: GrowthMindPlaybooksPlaceholder,
});
