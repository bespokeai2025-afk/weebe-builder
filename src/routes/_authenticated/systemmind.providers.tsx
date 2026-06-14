import { createFileRoute } from "@tanstack/react-router";
import { SystemMindProvidersPage } from "@/components/systemmind/SystemMindProvidersPage";

export const Route = createFileRoute("/_authenticated/systemmind/providers")({
  component: SystemMindProvidersPage,
});
