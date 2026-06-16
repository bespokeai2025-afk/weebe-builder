import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindBlogWriter } from "@/components/growthmind/GrowthMindBlogWriter";

export const Route = createFileRoute("/_authenticated/growthmind/blog-writer")({
  component: GrowthMindBlogWriter,
});
