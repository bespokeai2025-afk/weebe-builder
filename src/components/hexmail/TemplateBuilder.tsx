import { useRef, useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Save } from "lucide-react";
import { toast } from "sonner";
import { upsertHexmailTemplate, type HexmailTemplate, type TemplateType } from "@/lib/hexmail/templates.functions";

const TEMPLATE_TYPES: { value: TemplateType; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "document", label: "Document" },
  { value: "proposal", label: "Proposal" },
  { value: "quote", label: "Quote" },
  { value: "invoice", label: "Invoice" },
  { value: "contract", label: "Contract" },
];

const VARIABLES = [
  "{{contact_name}}",
  "{{company_name}}",
  "{{agent_name}}",
  "{{appointment_date}}",
  "{{pipeline_stage}}",
  "{{custom_fields}}",
];

const SAMPLE_VALUES: Record<string, string> = {
  "{{contact_name}}": "John Smith",
  "{{company_name}}": "Acme Corp",
  "{{agent_name}}": "Sarah Johnson",
  "{{appointment_date}}": new Date().toLocaleDateString(),
  "{{pipeline_stage}}": "Negotiation",
  "{{custom_fields}}": "[custom value]",
};

function applyPreview(text: string): string {
  return Object.entries(SAMPLE_VALUES).reduce(
    (t, [k, v]) => t.replaceAll(k, v),
    text,
  );
}

interface Props {
  open: boolean;
  template?: HexmailTemplate;
  onClose: () => void;
  onSaved: () => void;
}

export function TemplateBuilder({ open, template, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<TemplateType>("email");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (open) {
      setName(template?.name ?? "");
      setType(template?.type ?? "email");
      setSubject(template?.subject ?? "");
      setContent(template?.content ?? "");
      setPreview(false);
    }
  }, [open, template]);

  const save = useMutation({
    mutationFn: () =>
      upsertHexmailTemplate({
        data: {
          id: template?.id,
          name,
          type,
          subject: type === "email" ? subject : null,
          content,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hexmail-templates"] });
      onSaved();
    },
    onError: (e: any) => {
      const msg = e?.message ?? "Failed to save template";
      toast.error(msg);
    },
  });

  const insertAtCursor = (variable: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setContent((p) => p + variable);
      return;
    }
    const start = ta.selectionStart ?? content.length;
    const end = ta.selectionEnd ?? content.length;
    const next = content.slice(0, start) + variable + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + variable.length, start + variable.length);
    });
  };

  const isEmail = type === "email";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {template ? "Edit Template" : "New Template"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Template Name</Label>
              <Input
                placeholder="e.g. Proposal Follow-Up"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as TemplateType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isEmail && (
            <div className="space-y-1.5">
              <Label>Subject Line</Label>
              <Input
                placeholder="e.g. Following up on your proposal…"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Content</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setPreview((p) => !p)}
              >
                {preview ? (
                  <><EyeOff className="h-3.5 w-3.5" /> Edit</>
                ) : (
                  <><Eye className="h-3.5 w-3.5" /> Preview</>
                )}
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5 pb-1">
              {VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertAtCursor(v)}
                  className="text-[11px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5 hover:bg-primary/20 transition-colors"
                >
                  {v}
                </button>
              ))}
            </div>

            {preview ? (
              <div className="min-h-[180px] rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap text-foreground">
                {applyPreview(content) || (
                  <span className="text-muted-foreground">Nothing to preview yet.</span>
                )}
              </div>
            ) : (
              <Textarea
                ref={textareaRef}
                placeholder="Write your template content here. Click a variable above to insert it."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[180px] font-mono text-sm resize-y"
              />
            )}
          </div>
        </div>

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!name.trim() || save.isPending}
            className="gap-1.5"
          >
            <Save className="h-4 w-4" />
            {save.isPending ? "Saving…" : "Save Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
