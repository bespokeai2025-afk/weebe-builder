import { createFileRoute } from "@tanstack/react-router";
import { WbahPostCallWorkflowsPage } from "@/components/wbah/WbahPostCallWorkflowsPage";

export const Route = createFileRoute("/_authenticated/systemmind/wbah-post-call")({
  head: () => ({ meta: [{ title: "Post-Call Workflows — WBAH" }] }),
  component: WbahPostCallWorkflowsPage,
});
