import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TEMPLATE_INDUSTRIES, type TemplateIndustry } from "@/lib/builder/template-industries.shared";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { useBuilderStore } from "@/lib/builder/store";
import { upsertAgentTemplate, isCurrentUserAdmin } from "@/lib/agents/templates.functions";

export function SaveAsTemplateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const upsertFn = useServerFn(upsertAgentTemplate);
  const adminFn = useServerFn(isCurrentUserAdmin);
  const qc = useQueryClient();

  const adminQ = useQuery({
    queryKey: ["is-admin"],
    queryFn: () => adminFn(),
    refetchOnWindowFocus: false,
    throwOnError: false,
  });
  const isAdmin = adminQ.data?.isAdmin ?? false;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"global" | "personal">("personal");
  const [industry, setIndustry] = useState<TemplateIndustry>("general");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const s = useBuilderStore.getState();
      setName(s.settings.agentName || "Untitled template");
      setDescription("");
      setScope("personal");
      setIndustry((s.settings.industry as TemplateIndustry | undefined) ?? "general");
    }
  }, [open]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const s = useBuilderStore.getState();
      await upsertFn({
        data: {
          scope,
          name: name.trim(),
          description: description.trim(),
          flowData: { nodes: s.nodes, edges: s.edges } as never,
          // A template starts fresh: no version history or live snapshot of the source agent.
          // Test conversations stay with it, so whoever starts from the template gets them too.
          settings: { ...s.settings, flowHistory: [], publishedSnapshot: null, publishLog: [], industry } as never,
          variables: s.variables as never,
        },
      });
      toast.success("Template saved", { description: name.trim() });
      qc.invalidateQueries({ queryKey: ["agent-templates"] });
      onOpenChange(false);
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            Saves the current flow, settings and variables as a reusable template.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">Name</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-desc">Description</Label>
            <Textarea
              id="tpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="What is this template for?"
            />
          </div>
          <div className="space-y-2">
            <Label>Industry</Label>
            <Select value={industry} onValueChange={(v) => setIndustry(v as TemplateIndustry)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_INDUSTRIES.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(useBuilderStore.getState().settings.testConversations?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Includes this agent's {useBuilderStore.getState().settings.testConversations!.length} test
                conversations.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Visibility</Label>
            <RadioGroup
              value={scope}
              onValueChange={(v) => setScope(v as "global" | "personal")}
              className="space-y-1"
            >
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="personal" id="scope-personal" className="mt-1" />
                <div>
                  <div className="text-sm font-medium">My templates</div>
                  <div className="text-xs text-muted-foreground">Only visible to you.</div>
                </div>
              </label>
              <label
                className={`flex items-start gap-2 ${
                  isAdmin ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                }`}
              >
                <RadioGroupItem
                  value="global"
                  id="scope-global"
                  disabled={!isAdmin}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm font-medium">Global templates</div>
                  <div className="text-xs text-muted-foreground">
                    {isAdmin ? "Available to every signed-in user as a starter." : "Admins only."}
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
