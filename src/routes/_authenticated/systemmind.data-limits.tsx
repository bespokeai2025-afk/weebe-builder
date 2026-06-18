import { createFileRoute } from "@tanstack/react-router";
import { SystemMindDataLimitsPage } from "@/components/systemmind/SystemMindDataLimitsPage";

export const Route = createFileRoute("/_authenticated/systemmind/data-limits")({
  component: SystemMindDataLimitsPage,
});
