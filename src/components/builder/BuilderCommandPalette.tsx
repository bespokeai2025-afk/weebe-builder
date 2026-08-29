import { useEffect, useMemo, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useBuilderStore } from "@/lib/builder/store";
import { paletteFor } from "@/lib/builder/node-registry";
import { componentsFor } from "@/lib/builder/flow-components";
import type { NodeKind } from "@/lib/builder/types";

export function BuilderCommandPalette({
  onAddNode,
  onFitView,
}: {
  onAddNode: (kind: NodeKind) => void;
  onFitView: () => void;
}) {
  const [open, setOpen] = useState(false);
  const channelType = useBuilderStore((s) => s.settings.channelType ?? "voice");
  const nodes = useBuilderStore((s) => s.nodes);
  const selectNode = useBuilderStore((s) => s.selectNode);
  const autoLayout = useBuilderStore((s) => s.autoLayout);
  const undo = useBuilderStore((s) => s.undo);
  const redo = useBuilderStore((s) => s.redo);
  const duplicateSelection = useBuilderStore((s) => s.duplicateSelection);
  const addComponent = useBuilderStore((s) => s.addComponent);
  const saveSelectionAsComponent = useBuilderStore((s) => s.saveSelectionAsComponent);
  const setDebugOpen = useBuilderStore((s) => s.setDebugOpen);
  const customComponents = useBuilderStore((s) => s.settings.customComponents);
  const channel = channelType === "whatsapp" ? "whatsapp" : "voice";

  const kinds = useMemo(
    () => paletteFor(channelType === "whatsapp" ? "whatsapp" : "voice"),
    [channelType],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (open && e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search nodes, tools, commands…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Add node">
          {kinds.map((def) => (
            <CommandItem
              key={def.kind}
              value={`add ${def.label} ${def.kind}`}
              onSelect={() => {
                onAddNode(def.kind);
                setOpen(false);
              }}
            >
              {def.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {nodes.length > 0 && (
          <CommandGroup heading="Go to node">
            {nodes.map((n) => (
              <CommandItem
                key={n.id}
                value={`goto ${n.data.label} ${n.data.kind} ${n.id}`}
                onSelect={() => {
                  selectNode(n.id);
                  setOpen(false);
                }}
              >
                {n.data.label || n.data.kind}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Components">
          {componentsFor(channel, customComponents ?? []).map((c) => (
            <CommandItem
              key={c.id}
              value={`component ${c.label} ${c.id}`}
              onSelect={() => {
                addComponent(c.id);
                setOpen(false);
              }}
            >
              Add {c.label}
            </CommandItem>
          ))}
          <CommandItem
            onSelect={() => {
              saveSelectionAsComponent("Saved selection");
              setOpen(false);
            }}
          >
            Save selection as component
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Canvas">
          <CommandItem
            onSelect={() => {
              autoLayout();
              setOpen(false);
            }}
          >
            Auto-arrange
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onFitView();
              setOpen(false);
            }}
          >
            Fit view
          </CommandItem>
          <CommandItem
            onSelect={() => {
              undo();
              setOpen(false);
            }}
          >
            Undo
            <CommandShortcut>⌘Z</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              redo();
              setOpen(false);
            }}
          >
            Redo
            <CommandShortcut>⌘⇧Z</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              duplicateSelection();
              setOpen(false);
            }}
          >
            Duplicate selection
            <CommandShortcut>⌘D</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setDebugOpen(true);
              setOpen(false);
            }}
          >
            Open debugger
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
