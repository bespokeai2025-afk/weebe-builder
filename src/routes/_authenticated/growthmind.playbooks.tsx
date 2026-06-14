import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindPlaybooks } from "@/components/growthmind/GrowthMindPlaybooks";

export const Route = createFileRoute("/_authenticated/growthmind/playbooks")({
  head: () => ({ meta: [{ title: "Playbooks — GrowthMind" }] }),
  component: GrowthMindPlaybooks,
});
