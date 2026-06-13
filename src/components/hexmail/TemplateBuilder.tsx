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
  Plus,
  ScanText,
  Braces,
  Trash2,
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
  extractTemplateDocumentText,
} from "@/lib/hexmail/ai-edit.functions";
import {
  splitContent,
  joinContent,
  detectVars,
  mergeDetected,
  applyVars,
  VAR_TYPE_LABELS,
  type VarMap,
  type VarDef,
  type VarType,
} from "@/lib/hexmail/vars-helpers";

// ── Constants ──────────────────────────────────────────────────────────────────

// Top-level category choices shown in the primary selector
const PRIMARY_CATEGORIES = [
  { value: "email",    label: "Email" },
  { value: "sms",      label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "document", label: "Document" },  // triggers sub-type row
] as const;

type PrimaryCategory = (typeof PRIMARY_CATEGORIES)[number]["value"];

// Document sub-types
const DOC_SUB_TYPES: { value: TemplateType; label: string; description: string }[] = [
  { value: "document", label: "General",  description: "Generic business doc" },
  { value: "proposal", label: "Proposal", description: "Project / service proposal" },
  { value: "quote",    label: "Quote",    description: "Price quotation" },
  { value: "invoice",  label: "Invoice",  description: "Payment invoice" },
  { value: "contract", label: "Contract", description: "Legal agreement" },
];

const DOC_TYPES = new Set<TemplateType>(["document", "proposal", "quote", "invoice", "contract"]);

const EMAIL_VARIABLES = [
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
  "{{appointment_date}}": "01/06/2025",
  "{{pipeline_stage}}":   "Negotiation",
  "{{custom_fields}}":    "[custom value]",
};

function applyEmailPreview(text: string): string {
  return Object.entries(SAMPLE_VALUES).reduce(
    (t, [k, v]) => t.replaceAll(k, v), text,
  );
}

const ACCEPTED_DOC_MIME =
  ".pdf,.doc,.docx,.txt,.rtf,.odt,.xls,.xlsx,.csv,.ppt,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

// ── Variable type colour pills ─────────────────────────────────────────────────

const VAR_TYPE_COLOR: Record<VarType, string> = {
  text:     "bg-slate-500/10 text-slate-500 border-slate-500/20",
  number:   "bg-blue-500/10 text-blue-500 border-blue-500/20",
  currency: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  address:  "bg-amber-500/10 text-amber-500 border-amber-500/20",
  date:     "bg-violet-500/10 text-violet-500 border-violet-500/20",
  email:    "bg-sky-500/10 text-sky-500 border-sky-500/20",
  phone:    "bg-rose-500/10 text-rose-500 border-rose-500/20",
};

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  template?: HexmailTemplate;
  defaultType?: TemplateType;
  onClose: () => void;
  onSaved: () => void;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function TemplateBuilder({ open, template, defaultType, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name,    setName]    = useState("");
  const [type,    setType]    = useState<TemplateType>(defaultType ?? "email");
  const [primaryCat, setPrimaryCat] = useState<PrimaryCategory>(
    defaultType && DOC_TYPES.has(defaultType) ? "document" : (defaultType ?? "email") as PrimaryCategory,
  );
  const [subject, setSubject] = useState("");
  const [body,    setBody]    = useState("");   // raw body without VARS sentinel
  const [vars,    setVars]    = useState<VarMap>({});
  const [preview, setPreview] = useState(false);
  const [previewFills, setPreviewFills] = useState<Record<string, string>>({});

  // Document upload
  const [fileUrl,     setFileUrl]     = useState<string | null>(null);
  const [fileMime,    setFileMime]    = useState<string>("");
  const [fileName,    setFileName]    = useState<string | null>(null);
  const [isDragging,  setIsDragging]  = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  // AI
  const [aiInstruction,   setAiInstruction]   = useState("");
  const [previousBody,    setPreviousBody]    = useState<string | null>(null);
  const [isAiLoading,     setIsAiLoading]     = useState(false);

  // New variable input
  const [newVarKey, setNewVarKey] = useState("");

  const isEmail   = type === "email";
  const isDocType = DOC_TYPES.has(type);

  // ── Load template ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    setAiInstruction("");
    setPreviousBody(null);
    setIsAiLoading(false);
    setPreview(false);
    setNewVarKey("");

    const rawContent = template?.content ?? "";
    const { body: parsedBody, vars: parsedVars } = splitContent(rawContent);

    setName(template?.name ?? "");
    const resolvedType = template?.type ?? defaultType ?? "email";
    setType(resolvedType);
    setPrimaryCat(DOC_TYPES.has(resolvedType) ? "document" : resolvedType as PrimaryCategory);
    setBody(parsedBody);

    // Sync vars: merge stored defs with anything detected in the body
    const detected = detectVars(parsedBody);
    setVars(mergeDetected(parsedVars, detected));

    // Preview fills: initialise with stored defaults
    const fills: Record<string, string> = {};
    for (const [k, def] of Object.entries(parsedVars)) fills[k] = def.default;
    setPreviewFills(fills);

    if (template?.type && DOC_TYPES.has(template.type) && template.subject?.startsWith("http")) {
      setSubject("");
      setFileUrl(template.subject);
      try {
        const parts = new URL(template.subject).pathname.split("/");
        const raw = parts[parts.length - 1] ?? "";
        setFileName(raw.replace(/^\d+_/, ""));
        setFileMime("");
      } catch { setFileName("attachment"); setFileMime(""); }
    } else {
      setSubject(template?.subject ?? "");
      setFileUrl(null);
      setFileName(null);
      setFileMime("");
    }
  }, [open, template, defaultType]);

  // Keep vars in sync as body changes
  useEffect(() => {
    const detected = detectVars(body);
    setVars((prev) => mergeDetected(prev, detected));
  }, [body]);

  // ── Save ─────────────────────────────────────────────────────────────────────

  const save = useMutation({
    mutationFn: () => {
      const content = isDocType ? joinContent(body, vars) : body;
      return upsertHexmailTemplate({
        data: {
          id:      template?.id,
          name,
          type,
          subject: isEmail ? subject : (isDocType && fileUrl ? fileUrl : null),
          content,
        },
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hexmail-templates"] }); onSaved(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save template"),
  });

  // ── Cursor insertion ─────────────────────────────────────────────────────────

  const insertAtCursor = (token: string) => {
    const ta = textareaRef.current;
    if (!ta) { setBody((p) => p + token); return; }
    const s = ta.selectionStart ?? body.length;
    const e = ta.selectionEnd   ?? body.length;
    setBody(body.slice(0, s) + token + body.slice(e));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + token.length, s + token.length);
    });
  };

  const insertNewVar = () => {
    const key = newVarKey.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (!key) return;
    insertAtCursor(`{{${key}}}`);
    setNewVarKey("");
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
      setFileMime(file.type);
      if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
      toast.success("File uploaded — click 'Extract Text' to pull in the content");
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

  // ── Text extraction ──────────────────────────────────────────────────────────

  const extractText = async () => {
    if (!fileUrl) return;
    setIsExtracting(true);
    try {
      const result = await extractTemplateDocumentText({
        data: { publicUrl: fileUrl, mimeType: fileMime, fileName: fileName ?? undefined },
      });
      setBody(result.text);
      toast.success("Text extracted — review and add {{variables}} where needed");
    } catch (e: any) {
      toast.error(e?.message ?? "Extraction failed");
    } finally {
      setIsExtracting(false);
    }
  };

  // ── AI edit ──────────────────────────────────────────────────────────────────

  const runAiEdit = async () => {
    if (!aiInstruction.trim()) return;
    setIsAiLoading(true);
    setPreviousBody(body);
    try {
      const result = await aiEditTemplateContent({
        data: { content: body, instruction: aiInstruction, type, subject: isEmail ? subject : (fileName ?? undefined) },
      });
      setBody(result.content);
      setAiInstruction("");
      toast.success("AI edit applied");
    } catch (e: any) {
      toast.error(e?.message ?? "AI edit failed");
      setPreviousBody(null);
    } finally {
      setIsAiLoading(false);
    }
  };

  // ── Variable helpers ─────────────────────────────────────────────────────────

  const updateVar = (key: string, patch: Partial<VarDef>) => {
    setVars((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const allVarKeys = Object.keys(vars);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={cn(
        "flex flex-col max-h-[92vh]",
        isDocType ? "max-w-5xl" : "max-w-2xl",
      )}>
        <DialogHeader>
          <DialogTitle>{template ? "Edit Template" : "New Template"}</DialogTitle>
        </DialogHeader>

        <div className={cn(
          "flex-1 overflow-hidden flex gap-5 min-h-0",
          isDocType ? "flex-row" : "flex-col overflow-y-auto",
        )}>

          {/* ── LEFT / MAIN column ── */}
          <div className={cn(
            "space-y-4",
            isDocType ? "flex-1 min-w-0 overflow-y-auto pr-1" : "flex-1",
          )}>

            {/* Name */}
            <div className="space-y-1.5">
              <Label>Template Name</Label>
              <Input placeholder="e.g. Invoice Template" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            {/* Type — primary category */}
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="flex gap-1.5">
                {PRIMARY_CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => {
                      setPrimaryCat(cat.value);
                      if (cat.value !== "document") setType(cat.value as TemplateType);
                      else setType("document");
                    }}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                      primaryCat === cat.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground",
                    )}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Document sub-type selector */}
              {primaryCat === "document" && (
                <div className="flex gap-1.5 pt-1">
                  {DOC_SUB_TYPES.map((sub) => (
                    <button
                      key={sub.value}
                      type="button"
                      onClick={() => setType(sub.value)}
                      title={sub.description}
                      className={cn(
                        "flex-1 rounded border px-2 py-1 text-xs font-medium transition-colors",
                        type === sub.value
                          ? "bg-primary/15 text-primary border-primary/40"
                          : "bg-muted/30 text-muted-foreground border-border hover:border-primary/30 hover:text-foreground",
                      )}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Email subject */}
            {isEmail && (
              <div className="space-y-1.5">
                <Label>Subject Line</Label>
                <Input
                  placeholder="e.g. Your invoice #{{invoice_number}} is ready"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
            )}

            {/* Document upload */}
            {isDocType && (
              <div className="space-y-2">
                <Label>
                  Attach Document{" "}
                  <span className="text-muted-foreground font-normal">(optional — used as reference)</span>
                </Label>

                {fileUrl ? (
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                    <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="flex-1 text-sm truncate font-medium">{fileName}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 text-xs shrink-0"
                      onClick={extractText}
                      disabled={isExtracting}
                    >
                      {isExtracting
                        ? <><Loader2 className="h-3 w-3 animate-spin" /> Extracting…</>
                        : <><ScanText className="h-3 w-3" /> Extract Text</>}
                    </Button>
                    <a href={fileUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-primary hover:underline shrink-0">
                      <Download className="h-3.5 w-3.5" /> Open
                    </a>
                    <button type="button" onClick={() => { setFileUrl(null); setFileName(null); setFileMime(""); }}
                      className="text-muted-foreground hover:text-destructive shrink-0">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 cursor-pointer transition-colors",
                      isDragging ? "border-primary/60 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30",
                    )}
                  >
                    {isUploading
                      ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" />
                      : <Upload className="h-5 w-5 text-muted-foreground shrink-0" />}
                    <div>
                      <p className="text-sm font-medium">
                        {isUploading ? "Uploading…" : "Drop or click to upload"}
                      </p>
                      <p className="text-xs text-muted-foreground">PDF, Word, Excel, TXT — up to 50 MB</p>
                    </div>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept={ACCEPTED_DOC_MIME} className="hidden" onChange={handleFileInput} />
              </div>
            )}

            {/* Content / body */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>{isDocType ? "Document Body" : "Content"}</Label>
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                  onClick={() => setPreview((p) => !p)}>
                  {preview ? <><EyeOff className="h-3.5 w-3.5" /> Edit</> : <><Eye className="h-3.5 w-3.5" /> Preview</>}
                </Button>
              </div>

              {/* Variable chips — email uses fixed set; doc types use detected vars */}
              {isEmail && (
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {EMAIL_VARIABLES.map((v) => (
                    <button key={v} type="button" onClick={() => insertAtCursor(v)}
                      className="text-[11px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5 hover:bg-primary/20 transition-colors">
                      {v}
                    </button>
                  ))}
                </div>
              )}

              {isDocType && allVarKeys.length > 0 && !preview && (
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {allVarKeys.map((k) => (
                    <button key={k} type="button" onClick={() => insertAtCursor(`{{${k}}}`)}
                      className="text-[11px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5 hover:bg-primary/20 transition-colors">
                      {`{{${k}}}`}
                    </button>
                  ))}
                </div>
              )}

              {preview ? (
                <div className="min-h-[200px] rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap text-foreground">
                  {isDocType
                    ? (applyVars(body, previewFills) || <span className="text-muted-foreground">Nothing to preview yet.</span>)
                    : (applyEmailPreview(body) || <span className="text-muted-foreground">Nothing to preview yet.</span>)
                  }
                </div>
              ) : (
                <Textarea
                  ref={textareaRef}
                  placeholder={
                    isDocType
                      ? `Write or paste your document body here.\n\nUse {{variable_name}} anywhere you want a fill-in field — e.g.\n  Invoice #: {{invoice_number}}\n  Billing Address: {{billing_address}}\n  Total: {{total_amount}}\n\nOr upload a file above and click 'Extract Text'.`
                      : "Write your template content here."
                  }
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="min-h-[200px] font-mono text-sm resize-y"
                />
              )}
            </div>

            {/* AI editor */}
            <div className="rounded-lg border bg-muted/20 p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
                <p className="text-sm font-semibold">AI Editor</p>
                {previousBody !== null && (
                  <Button variant="ghost" size="sm" className="ml-auto h-6 gap-1 text-xs text-muted-foreground"
                    onClick={() => { setBody(previousBody); setPreviousBody(null); }}>
                    <RotateCcw className="h-3 w-3" /> Undo
                  </Button>
                )}
              </div>
              <Textarea
                placeholder={
                  isDocType
                    ? `e.g. "Write a professional invoice for a web design project" or "Add a late payment clause"`
                    : `e.g. "Make it shorter and add urgency"`
                }
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                className="min-h-[64px] text-sm resize-none"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runAiEdit(); } }}
              />
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                  <kbd className="font-mono bg-muted rounded px-1 py-0.5">⌘ Enter</kbd> to run
                </p>
                <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={runAiEdit}
                  disabled={!aiInstruction.trim() || isAiLoading}>
                  {isAiLoading
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Editing…</>
                    : <><Sparkles className="h-3.5 w-3.5" /> Apply AI Edit</>}
                </Button>
              </div>
            </div>
          </div>

          {/* ── RIGHT column — Variables panel (doc types only) ── */}
          {isDocType && (
            <div className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto border-l pl-5">
              <div className="flex items-center gap-2 pt-0.5">
                <Braces className="h-4 w-4 text-primary shrink-0" />
                <p className="text-sm font-semibold">Variables</p>
                <span className="ml-auto text-xs text-muted-foreground">{allVarKeys.length} detected</span>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed -mt-1">
                Wrap any placeholder in <code className="font-mono bg-muted px-1 rounded">{"{{"}name{"}}"}</code> in the body — it appears here automatically. Set a label, type, and default value.
              </p>

              {/* Add new variable */}
              <div className="flex gap-1.5">
                <Input
                  placeholder="variable_name"
                  value={newVarKey}
                  onChange={(e) => setNewVarKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); insertNewVar(); } }}
                  className="h-8 text-xs font-mono flex-1"
                />
                <Button size="sm" variant="outline" className="h-8 w-8 p-0 shrink-0" onClick={insertNewVar}
                  disabled={!newVarKey.trim()}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Variable list */}
              {allVarKeys.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <Braces className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">
                    No variables yet. Type{" "}
                    <code className="font-mono bg-muted px-1 rounded">{"{{invoice_number}}"}</code>{" "}
                    anywhere in the body.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {allVarKeys.map((key) => {
                    const def = vars[key];
                    return (
                      <div key={key} className="rounded-lg border bg-card p-2.5 space-y-2">
                        {/* Key + type badge */}
                        <div className="flex items-center gap-2">
                          <code className="text-[11px] font-mono text-primary flex-1 truncate">
                            {`{{${key}}}`}
                          </code>
                          <span className={cn(
                            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium shrink-0",
                            VAR_TYPE_COLOR[def.type],
                          )}>
                            {VAR_TYPE_LABELS[def.type]}
                          </span>
                        </div>

                        {/* Label */}
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Label</p>
                          <Input
                            value={def.label}
                            onChange={(e) => updateVar(key, { label: e.target.value })}
                            className="h-7 text-xs"
                            placeholder="Display label"
                          />
                        </div>

                        {/* Type */}
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Type</p>
                          <Select value={def.type} onValueChange={(v) => updateVar(key, { type: v as VarType })}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(VAR_TYPE_LABELS).map(([v, l]) => (
                                <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Default / preview value */}
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                            Preview value
                          </p>
                          <Input
                            value={previewFills[key] ?? def.default}
                            onChange={(e) => {
                              setPreviewFills((p) => ({ ...p, [key]: e.target.value }));
                              updateVar(key, { default: e.target.value });
                            }}
                            className="h-7 text-xs"
                            placeholder={`e.g. ${key === "invoice_number" ? "INV-0042" : key === "total_amount" ? "£1,250.00" : "sample value"}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Preview toggle note */}
              {allVarKeys.length > 0 && (
                <p className="text-[11px] text-muted-foreground mt-auto pt-2 border-t">
                  Click <strong>Preview</strong> above to see the document with variables filled in.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="pt-4 border-t shrink-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending} className="gap-1.5">
            <Save className="h-4 w-4" />
            {save.isPending ? "Saving…" : "Save Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
