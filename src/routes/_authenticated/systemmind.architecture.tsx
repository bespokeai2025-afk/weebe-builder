import { createFileRoute } from "@tanstack/react-router";
import { SystemMindArchitecturePage } from "@/components/systemmind/SystemMindArchitecturePage";

export const Route = createFileRoute("/_authenticated/systemmind/architecture")({
  component: SystemMindArchitecturePage,
});
