import { createFileRoute } from "@tanstack/react-router";
import { SystemMindCrmConnectionsPage } from "@/components/systemmind/SystemMindCrmConnectionsPage";

export const Route = createFileRoute("/_authenticated/systemmind/crm-connections")({
  head: () => ({ meta: [{ title: "CRM Connections — SystemMind" }] }),
  component: SystemMindCrmConnectionsPage,
});
