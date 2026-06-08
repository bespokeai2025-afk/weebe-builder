import { useState } from "react";
import { ChevronDown, Pencil, Trash2, Plus, Ban, Rows3 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBuilderStore } from "@/lib/builder/store";
import type { BuilderVariable } from "@/lib/builder/types";

const DEFAULTS: { name: string; description: string; icon: typeof Rows3 }[] = [
  { name: "Call Summary", description: "A short summary of the call.", icon: Rows3 },
  { name: "Call Successful", description: "Whether the call met its goal.", icon: Ban },
  { name: "User Sentiment", description: "Detected sentiment of the user.", icon: Rows3 },
];

function VariableRow({
  name,
  onEdit,
  onDelete,
  icon: Icon,
}: {
  name: string;
  onEdit?: () => void;
  onDelete?: () => void;
  icon: typeof Rows3;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded border bg-muted/30 px-1.5 py-1">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate text-[10px]">{name}</span>
      {onEdit && (
        <button
          onClick={onEdit}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Edit"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function PostCallDataSection() {
  const variables = useBuilderStore((s) => s.variables);
  const setVariables = useBuilderStore((s) => s.setVariables);

  const [open, setOpen] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<BuilderVariable>({
    name: "",
    description: "",
    type: "string",
    defaultValue: "",
  });

  const openNew = () => {
    setEditingIdx(null);
    setDraft({ name: "", description: "", type: "string", defaultValue: "" });
    setOpen(true);
  };

  const openEdit = (idx: number) => {
    setEditingIdx(idx);
    setDraft({ type: "string", ...variables[idx] });
    setOpen(true);
  };

  const save = () => {
    if (!draft.name.trim()) return;
    if (editingIdx === null) {
      setVariables([...variables, draft]);
    } else {
      setVariables(variables.map((v, i) => (i === editingIdx ? draft : v)));
    }
    setOpen(false);
  };

  const remove = (idx: number) => {
    setVariables(variables.filter((_, i) => i !== idx));
  };

  return (
    <Collapsible className="rounded-lg border border-white/[0.06] bg-white/[0.01]">
      <CollapsibleTrigger className="group flex w-full min-h-[40px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
        <span>Post-Call Data Retrieval</span>
        <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5 px-2.5 pb-2.5">
        <p className="text-[10px] text-muted-foreground">
          Define the information to extract from each call.
        </p>

        <div className="space-y-1">
          {DEFAULTS.map((d) => (
            <VariableRow key={d.name} name={d.name} icon={d.icon} onEdit={() => {}} />
          ))}
          {variables.map((v, i) => (
            <VariableRow
              key={`${v.name}-${i}`}
              name={v.name}
              icon={Rows3}
              onEdit={() => openEdit(i)}
              onDelete={() => remove(i)}
            />
          ))}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="w-full h-6 text-[10px]" onClick={openNew}>
              <Plus className="h-3 w-3 mr-1" /> Add variable
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingIdx === null ? "Add variable" : "Edit variable"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. business_name"
                  className="h-7"
                />
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea
                  rows={3}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Describe what to extract"
                  className="text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Data type</Label>
                <Select
                  value={draft.type ?? "string"}
                  onValueChange={(type) =>
                    setDraft({ ...draft, type: type as BuilderVariable["type"] })
                  }
                >
                  <SelectTrigger className="h-7">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">string</SelectItem>
                    <SelectItem value="number">number</SelectItem>
                    <SelectItem value="boolean">boolean</SelectItem>
                    <SelectItem value="enum">enum</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Example</Label>
                <Input
                  value={draft.defaultValue}
                  onChange={(e) => setDraft({ ...draft, defaultValue: e.target.value })}
                  className="h-7"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CollapsibleContent>
    </Collapsible>
  );
}
