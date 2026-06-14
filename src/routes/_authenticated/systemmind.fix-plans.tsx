import { createFileRoute } from "@tanstack/react-router";
import { SystemMindFixPlansPage } from "@/components/systemmind/SystemMindFixPlansPage";

export const Route = createFileRoute("/_authenticated/systemmind/fix-plans")({
  component: SystemMindFixPlansPage,
});
