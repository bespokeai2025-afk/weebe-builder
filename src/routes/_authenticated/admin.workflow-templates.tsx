import { createFileRoute } from "@tanstack/react-router";
import { WorkflowTemplatesAdminPage } from "@/components/workflow-engine/WorkflowTemplatesAdminPage";

export const Route = createFileRoute("/_authenticated/admin/workflow-templates")({
  head: () => ({ meta: [{ title: "Workflow Templates — Admin" }] }),
  component: WorkflowTemplatesAdminPage,
});
