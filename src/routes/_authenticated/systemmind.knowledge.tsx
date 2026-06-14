import { createFileRoute } from "@tanstack/react-router";
import { SystemMindKnowledgePage } from "@/components/systemmind/SystemMindKnowledgePage";

export const Route = createFileRoute("/_authenticated/systemmind/knowledge")({
  component: SystemMindKnowledgePage,
});
