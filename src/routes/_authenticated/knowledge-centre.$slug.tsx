import { createFileRoute, useParams } from "@tanstack/react-router";
import { KnowledgeBaseDetail } from "@/components/knowledge-centre/KnowledgeBaseDetail";

export const Route = createFileRoute("/_authenticated/knowledge-centre/$slug")({
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = useParams({ from: "/_authenticated/knowledge-centre/$slug" });
  return <KnowledgeBaseDetail slug={slug} />;
}
