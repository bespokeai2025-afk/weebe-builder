import { createFileRoute } from "@tanstack/react-router";
import { SystemMindOverview } from "@/components/systemmind/SystemMindOverview";

export const Route = createFileRoute("/_authenticated/systemmind/")({
  component: SystemMindOverview,
});
