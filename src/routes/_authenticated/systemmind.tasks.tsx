import { createFileRoute } from "@tanstack/react-router";
import { SystemMindTasksPage } from "@/components/systemmind/SystemMindTasksPage";

export const Route = createFileRoute("/_authenticated/systemmind/tasks")({
  component: SystemMindTasksPage,
});
