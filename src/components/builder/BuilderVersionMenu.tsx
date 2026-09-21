import { History, Rocket, RotateCcw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBuilderStore } from "@/lib/builder/store";

export function BuilderVersionMenu() {
  const history = useBuilderStore((s) => s.settings.flowHistory);
  const published = useBuilderStore((s) => s.settings.publishedSnapshot);
  const publishFlow = useBuilderStore((s) => s.publishFlow);
  const restoreFlowVersion = useBuilderStore((s) => s.restoreFlowVersion);
  const unpublishFlow = useBuilderStore((s) => s.unpublishFlow);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          title={published ? `Published v${published.version}` : "Versions"}
          className="!h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <History className="h-3.5 w-3.5" />
          {published ? `v${published.version}` : "Draft"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-label">Versions</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => {
            const v = publishFlow();
            toast.success(`Published v${v}`, {
              description: "Live calls now use this graph. The canvas stays your draft.",
            });
          }}
        >
          <Rocket className="mr-2 h-3.5 w-3.5" />
          Publish current draft
        </DropdownMenuItem>
        {published && (
          <DropdownMenuItem
            onClick={() => {
              unpublishFlow();
              toast.success("Unpublished", { description: "Live calls will use the latest saved draft." });
            }}
          >
            <Undo2 className="mr-2 h-3.5 w-3.5" />
            Unpublish
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {(history ?? []).length === 0 ? (
          <p className="px-2 py-3 text-caption text-muted-foreground">No snapshots yet. Save or publish to create one.</p>
        ) : (
          [...(history ?? [])].reverse().map((snap) => (
            <DropdownMenuItem
              key={snap.version}
              onClick={() => {
                if (restoreFlowVersion(snap.version)) {
                  toast.success(`Restored v${snap.version}`);
                }
              }}
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              <span className="flex min-w-0 flex-col">
                <span>
                  v{snap.version} · {snap.label}
                  {published?.version === snap.version ? " · live" : ""}
                </span>
                <span className="text-metadata text-muted-foreground">
                  {new Date(snap.createdAt).toLocaleString()}
                </span>
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
