import { useRef, useState, useEffect, useCallback } from "react";
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
import {
  Eye,
  EyeOff,
  Save,
  Upload,
  FileText,
  X,
  Sparkles,
  Loader2,
  RotateCcw,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  upsertHexmailTemplate,
  type HexmailTemplate,
  type TemplateType,
} from "@/lib/hexmail/templates.functions";
import {
  aiEditTemplateContent,
  createTemplateDocumentUploadUrl,
} from "@/lib/hexmail/ai-edit.functions";

// ── Constants ──────────────────────────────────────────────────────────────────

const TEMPLATE_TYPES: { value: TemplateType; label: string }[] = [
  { value: "email",    label: "Email" },
  { value: "sms",      label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "document", label: "Document" },
  { value: "proposal", label: "Proposal" },
  { value: "quote",    label: "Quote" },
  { value: "invoice",  label: "Invoice" },
  { value: "contract", label: "Contract" },
];

const DOC_TYPES = new Set<TemplateType>(["document", "proposal", "quote", "invoice", "contract"]);

const VARIABLES = [
  "{{contact_name}}",
  "{{company_name}}",
  "{{agent_name}}",
  "{{appointment_date}}",
  "{{pipeline_stage}}",
  "{{custom_fields}}",
];

const SAMPLE_VALUES: Record<string, string> = {
  "{{contact_name}}":     "John Smith",
  "{{company_name}}":     "Acme Corp",
  "{{agent_name}}":       "Sarah Johnson",
  "{{appointment_date}}": new Date().toLocaleDateString(),
  "{{pipeline_stage}}":   "Negotiation",
  "{{custom_fields}}":    "[custom value]",
};

function applyPreview(text: string): string {
  return Object.entries(SAMPLE_VALUES).reduce(
    (t, [k, v]) => t.replaceAll(k, v),
    text,
  );
}

const ACCEPTED_DOC_MIME =
  ".pdf,.doc,.docx,.txt,.rtf,.odt,.xls,.xlsx,.csv,.ppt,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  template?: HexmailTemplate;
  defaultType?: TemplateType;
  onClose: () => void;
  onSaved: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function TemplateBuilder({ open, template, defaultType, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name,    setName]    = useState("");
  const [type,    setType]    = useState<TemplateType>(defaultType ?? "email");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);

  // Document upload state
  const [fileUrl,       setFileUrl]       = useState<string | null>(null);
  const [fileName,      setFileName]      = useState<string | null>(null);
  const [isDragging,    setIsDragging]    = useState(false);
  const [isUploading,   setIsUploading]   = useState(false);

  // AI state
  const [aiInstruction,  setAiInstruction]  = useState("");
  const [previousContent, setPreviousContent] = useState<string | null>(null);
  const [isAiLoading,    setIsAiLoading]    = useState(false);

  const isEmail   = type === "email";
  const isDocType = DOC_TYPES.has(type);

  useEffect(() => {
    if (open) {
      setName(template?.name ?? "");
      setType(template?.type ?? defaultType ?? "email");
      setContent(template?.content ?? "");
      setPreview(false);
      setAiInstruction("");
      setPreviousContent(null);
      setIsAiLoading(false);

      // For email: subject = subject; for doc types: subject = file URL
      if (template?.type && DOC_TYPES.has(template.type) && template.subject?.startsWith("http")) {
        setSubject("");
        setFileUrl(template.subject);
        // Try to extract filename from URL
        try {
          const parts = new URL(template.subject).pathname.split("/");
          const raw = parts[parts.length - 1] ?? "";
          // strip timestamp prefix like 1234567890_filename.pdf
          setFileName(raw.replace(/^\d+_/, ""));
        } catch {
          setFileName("attachment");
        }
      } else {
        setSubject(template?.subject ?? "");
        setFileUrl(null);
        setFileName(null);
      }
    }
  }, [open, template, defaultType]);

  // ── Mutations ────────────────────────────────────────────────────────────────

  const save = useMutation({
    mutationFn: () =>
      upsertHexmailTemplate({
        data: {
          id:      template?.id,
          name,
          type,
          subject: isEmail ? subject : (isDocType && fileUrl ? fileUrl : null),
          content,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hexmail-templates"] });
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save template"),
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const insertAtCursor = (variable: string) => {
    const ta = textareaRef.current;
    if (!ta) { setContent((p) => p + variable); return; }
    const start = ta.selectionStart ?? content.length;
    const end   = ta.selectionEnd   ?? content.length;
    const next  = content.slice(0, start) + variable + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + variable.length, start + variable.length);
    });
  };

  // ── File upload ──────────────────────────────────────────────────────────────

  const uploadFile = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const { signedUrl, publicUrl } = await createTemplateDocumentUploadUrl({
        data: { fileName: file.name, mimeType: file.type },
      });

      const res = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);

      setFileUrl(publicUrl);
      setFileName(file.name);
      if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
      toast.success("File uploaded");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }, [name]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  // ── AI edit ──────────────────────────────────────────────────────────────────

  const runAiEdit = async () => {
    if (!aiInstruction.trim()) return;
    setIsAiLoading(true);
    setPreviousContent(content);
    try {
      const result = await aiEditTemplateContent({
        data: {
          content,
          instruction: aiInstruction,
          type,
          subject: isEmail ? subject : (fileName ?? undefined),
        },
      });
      setContent(result.content);
      setAiInstruction("");
      toast.success("AI edit applied");
    } catch (e: any) {
      toast.error(e?.message ?? "AI edit failed");
      setPreviousContent(null);
    } finally {
      setIsAiLoading(false);
    }
  };

  const undoAiEdit = () => {
    if (previousContent !== null) {
      setContent(previousContent);
      setPreviousContent(null);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={cn(
        "flex flex-col max-h-[90vh]",
        isDocType ? "max-w-3xl" : "max-w-2xl",
      )}>
        <DialogHeader>
          <DialogTitle>
            {template ? "Edit Template" : "New Template"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">

          {/* ── Name + Type ── */}
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
              <Select value={type} onValueChange={(v) => setType(v as TemplateType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Email subject ── */}
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

          {/* ── Document upload zone ── */}
          {isDocType && (
            <div className="space-y-2">
              <Label>Attach Document <span className="text-muted-foreground font-normal">(optional)</span></Label>

              {fileUrl ? (
                /* Uploaded file pill */
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-sm truncate font-medium">{fileName}</span>
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" /> Open
                  </a>
                  <button
                    type="button"
                    onClick={() => { setFileUrl(null); setFileName(null); }}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                /* Drop zone */
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-5 text-center transition-colors cursor-pointer",
                    isDragging
                      ? "border-primary/60 bg-primary/5"
                      : "border-border hover:border-primary/40 hover:bg-muted/30",
                  )}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isUploading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className="h-6 w-6 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm font-medium">
                      {isUploading ? "Uploading…" : "Drop file here or click to browse"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      PDF, Word, Excel, PowerPoint, TXT — up to 50 MB
                    </p>
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_DOC_MIME}
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
          )}

          {/* ── Content ── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>
                {isDocType ? "Document Content / Body Text" : "Content"}
              </Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setPreview((p) => !p)}
              >
                {preview
                  ? <><EyeOff className="h-3.5 w-3.5" /> Edit</>
                  : <><Eye   className="h-3.5 w-3.5" /> Preview</>}
              </Button>
            </div>

            {/* Merge variable chips */}
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
              <div className="min-h-[160px] rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap text-foreground">
                {applyPreview(content) || (
                  <span className="text-muted-foreground">Nothing to preview yet.</span>
                )}
              </div>
            ) : (
              <Textarea
                ref={textareaRef}
                placeholder={
                  isDocType
                    ? "Paste or type the document body here — or use the AI editor below to generate it…"
                    : "Write your template content here. Click a variable above to insert it."
                }
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[160px] font-mono text-sm resize-y"
              />
            )}
          </div>

          {/* ── AI Editor (all types) ── */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <p className="text-sm font-semibold">AI Editor</p>
              {previousContent !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 gap-1 text-xs text-muted-foreground"
                  onClick={undoAiEdit}
                >
                  <RotateCcw className="h-3 w-3" /> Undo last edit
                </Button>
              )}
            </div>

            <Textarea
              placeholder={
                isDocType
                  ? "e.g. "Write a professional NDA for a software consultancy" or "Make it more formal and add a confidentiality clause""
                  : `e.g. "Make it shorter and more friendly" or "Add urgency and a clear call to action"`
              }
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              className="min-h-[72px] text-sm resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  runAiEdit();
                }
              }}
            />

            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                Press <kbd className="font-mono bg-muted rounded px-1 py-0.5">⌘ Enter</kbd> to run
              </p>
              <Button
                size="sm"
                className="gap-1.5 h-8 text-xs"
                onClick={runAiEdit}
                disabled={!aiInstruction.trim() || isAiLoading}
              >
                {isAiLoading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Editing…</>
                  : <><Sparkles className="h-3.5 w-3.5" /> Apply AI Edit</>}
              </Button>
            </div>
          </div>

        </div>

        <DialogFooter className="pt-4 border-t shrink-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
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
