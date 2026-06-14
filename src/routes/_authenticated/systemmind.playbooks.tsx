import { createFileRoute } from "@tanstack/react-router";
import { SystemMindPlaybooksPage } from "@/components/systemmind/SystemMindPlaybooksPage";

export const Route = createFileRoute("/_authenticated/systemmind/playbooks")({
  component: SystemMindPlaybooksPage,
});
