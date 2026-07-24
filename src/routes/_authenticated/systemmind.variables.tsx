import { createFileRoute } from "@tanstack/react-router";
import { SystemMindVariableEnginePage } from "@/components/systemmind/SystemMindVariableEnginePage";

export const Route = createFileRoute("/_authenticated/systemmind/variables")({
  head: () => ({ meta: [{ title: "Variable Engine — SystemMind" }] }),
  component: SystemMindVariableEnginePage,
});
