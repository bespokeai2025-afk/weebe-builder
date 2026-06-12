import { useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BookOpen,
  Plus,
  Trash2,
  ChevronDown,
  Settings,
  Settings2,
  Loader2,
  Globe,
  FileText,
  Upload,
  FileUp,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { useBuilderStore } from "@/lib/builder/store";
import {
  createRetellKnowledgeBase,
  addTextToRetellKb,
  addUrlToRetellKb,
  addFileToRetellKb,
  deleteRetellKnowledgeBase,
} from "@/lib/builder/knowledge-base.functions";

type KbDoc = NonNullable<ReturnType<typeof useBuilderStore.getState>["settings"]["kbDocuments"]>[number];

interface Props {
  isRetell: boolean;
  isHyperStream: boolean;
}

export function KnowledgeBaseSection({ isRetell, isHyperStream }: Props) {
  const settings = useBuilderStore((s) => s.settings);
  const setSettings = useBuilderStore((s) => s.setSettings);

  const docs: KbDoc[] = settings.kbDocuments ?? [];
  const kbIds = settings.knowledgeBaseIds ?? [];
  const kbConfig = settings.kbConfig ?? {};

  const [addOpen, setAddOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [instrOpen, setInstrOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [tab, setTab] = useState<"text" | "url" | "file">("text");
  const [textName, setTextName] = useState("");
  const [textContent, setTextContent] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [urlName, setUrlName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [topK, setTopK] = useState(kbConfig.topK ?? 3);
  const [filterScore, setFilterScore] = useState(kbConfig.filterScore ?? 0.6);
  const [instruction, setInstruction] = useState(kbConfig.instruction ?? "");

  const doCreateKb = useServerFn(createRetellKnowledgeBase);
  const doAddText = useServerFn(addTextToRetellKb);
  const doAddUrl = useServerFn(addUrlToRetellKb);
  const doAddFile = useServerFn(addFileToRetellKb);
  const doDeleteKb = useServerFn(deleteRetellKnowledgeBase);

  function resetAddForm() {
    setTextName("");
    setTextContent("");
    setUrlValue("");
    setUrlName("");
    setFile(null);
    setFileName("");
    setTab("text");
  }

  async function ensureKb(agentName: string): Promise<string> {
    if (kbIds.length > 0) return kbIds[0];
    const kb = await doCreateKb({ data: { name: `${agentName} — Knowledge Base` } });
    const newId = kb.knowledge_base_id as string;
    setSettings({ knowledgeBaseIds: [newId] });
    return newId;
  }

  async function handleAdd() {
    if (tab === "text" && !textContent.trim()) {
      toast.error("Enter some content first");
      return;
    }
    if (tab === "url" && !urlValue.trim()) {
      toast.error("Enter a URL first");
      return;
    }
    if (tab === "file" && !file) {
      toast.error("Choose a file first");
      return;
    }

    setSaving(true);
    try {
      const sourceId = `src_${Date.now().toString(36)}`;
      const agentName = settings.agentName || "Agent";

      let newDoc: KbDoc;

      if (isHyperStream) {
        newDoc = {
          id: sourceId,
          name: tab === "text" ? (textName || "Text document") : tab === "url" ? (urlName || urlValue) : (fileName || file!.name),
          type: tab,
          content: tab === "text" ? textContent : undefined,
          url: tab === "url" ? urlValue : undefined,
          fileName: tab === "file" ? (file?.name ?? fileName) : undefined,
          addedAt: new Date().toISOString(),
        };
        if (tab === "file" && file) {
          const text = await file.text().catch(() => "");
          newDoc.content = text;
        }
      } else {
        const kbId = await ensureKb(agentName);
        if (tab === "text") {
          await doAddText({ data: { kbId, text: textContent, sourceId } });
          newDoc = { id: sourceId, name: textName || "Text document", type: "text", content: textContent, retellKbId: kbId, retellSourceId: sourceId, addedAt: new Date().toISOString() };
        } else if (tab === "url") {
          await doAddUrl({ data: { kbId, url: urlValue, sourceId } });
          newDoc = { id: sourceId, name: urlName || urlValue, type: "url", url: urlValue, retellKbId: kbId, retellSourceId: sourceId, addedAt: new Date().toISOString() };
        } else {
          const arrayBuf = await file!.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
          await doAddFile({ data: { kbId, fileBase64: base64, fileName: file!.name, mimeType: file!.type || "application/octet-stream" } });
          newDoc = { id: sourceId, name: fileName || file!.name, type: "file", fileName: file!.name, retellKbId: kbId, retellSourceId: sourceId, addedAt: new Date().toISOString() };
        }
      }

      setSettings({ kbDocuments: [...docs, newDoc] });
      toast.success("Knowledge base updated");
      setAddOpen(false);
      resetAddForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add document");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(doc: KbDoc) {
    setDeleting(doc.id);
    try {
      if (isRetell && doc.retellKbId) {
        const remaining = docs.filter((d) => d.id !== doc.id && d.retellKbId === doc.retellKbId);
        if (remaining.length === 0) {
          await doDeleteKb({ data: { kbId: doc.retellKbId } });
          setSettings({
            kbDocuments: docs.filter((d) => d.id !== doc.id),
            knowledgeBaseIds: kbIds.filter((id) => id !== doc.retellKbId),
          });
        } else {
          setSettings({ kbDocuments: docs.filter((d) => d.id !== doc.id) });
        }
      } else {
        setSettings({ kbDocuments: docs.filter((d) => d.id !== doc.id) });
      }
      toast.success("Removed");
    } catch {
      setSettings({ kbDocuments: docs.filter((d) => d.id !== doc.id) });
      toast.success("Removed locally");
    } finally {
      setDeleting(null);
    }
  }

  function saveAdvanced() {
    setSettings({ kbConfig: { ...kbConfig, topK, filterScore } });
    setAdvOpen(false);
    toast.success("Retrieval settings saved");
  }

  function saveInstruction() {
    setSettings({ kbConfig: { ...kbConfig, instruction } });
    setInstrOpen(false);
    toast.success("Instruction saved");
  }

  const DocTypeIcon = ({ type }: { type: KbDoc["type"] }) => {
    if (type === "url") return <Globe className="h-3 w-3 text-sky-500 shrink-0" />;
    if (type === "file") return <FileUp className="h-3 w-3 text-violet-500 shrink-0" />;
    return <FileText className="h-3 w-3 text-emerald-500 shrink-0" />;
  };

  return (
    <>
      <Collapsible className="rounded-lg border border-white/[0.06] bg-white/[0.01]">
        <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
          <span className="flex items-center gap-1.5">
            <BookOpen className="h-3 w-3" />
            Knowledge Base
            {docs.length > 0 && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                {docs.length}
              </span>
            )}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>

        <CollapsibleContent className="px-2.5 pb-3 space-y-2.5">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Add knowledge base to provide context to the agent.
          </p>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] gap-1.5"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>

          {docs.length > 0 && (
            <ul className="space-y-1">
              {docs.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-2 rounded-md bg-muted/40 border border-muted px-2 py-1.5 text-[10px]"
                >
                  <DocTypeIcon type={doc.type} />
                  <span className="flex-1 truncate text-foreground/80">{doc.name}</span>
                  <button
                    onClick={() => handleDelete(doc)}
                    disabled={deleting === doc.id}
                    className="text-muted-foreground hover:text-rose-500 transition-colors"
                    aria-label="Remove"
                  >
                    {deleting === doc.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-1.5 pt-0.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">
              Advanced Settings
            </p>
            <button
              onClick={() => setAdvOpen(true)}
              className="flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[10px] text-foreground/80 hover:bg-muted/40 transition-colors text-left"
            >
              <Settings className="h-3 w-3 text-muted-foreground shrink-0" />
              Adjust KB Retrieval Chunks and Similarity
            </button>
            <button
              onClick={() => setInstrOpen(true)}
              className="flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[10px] text-foreground/80 hover:bg-muted/40 transition-colors text-left"
            >
              <Settings2 className="h-3 w-3 text-muted-foreground shrink-0" />
              Configure Knowledge Base Instruction
            </button>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* ── Add Document Dialog ── */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) resetAddForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4" />
              Add Knowledge Base Source
            </DialogTitle>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "text" | "url" | "file")}>
            <TabsList className="grid grid-cols-3 h-8 text-xs">
              <TabsTrigger value="text" className="text-xs gap-1">
                <FileText className="h-3 w-3" /> Text
              </TabsTrigger>
              <TabsTrigger value="url" className="text-xs gap-1">
                <Globe className="h-3 w-3" /> URL
              </TabsTrigger>
              <TabsTrigger value="file" className="text-xs gap-1">
                <Upload className="h-3 w-3" /> File
              </TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="space-y-3 mt-3">
              <div className="space-y-1">
                <Label className="text-xs">Document Name</Label>
                <Input
                  value={textName}
                  onChange={(e) => setTextName(e.target.value)}
                  placeholder="e.g. Product FAQ"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Content</Label>
                <Textarea
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder="Paste your knowledge base text here…"
                  rows={8}
                  className="text-sm resize-none"
                />
              </div>
            </TabsContent>

            <TabsContent value="url" className="space-y-3 mt-3">
              <div className="space-y-1">
                <Label className="text-xs">Display Name</Label>
                <Input
                  value={urlName}
                  onChange={(e) => setUrlName(e.target.value)}
                  placeholder="e.g. Company Website"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">URL to crawl</Label>
                <Input
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                  placeholder="https://yoursite.com/faq"
                  className="h-8 text-sm"
                />
              </div>
              {isHyperStream && (
                <p className="text-[10px] text-muted-foreground">
                  HyperStream mode: URL will be stored as a reference in the system prompt.
                </p>
              )}
              {isRetell && (
                <p className="text-[10px] text-muted-foreground">
                  Retell will crawl and index this URL automatically.
                </p>
              )}
            </TabsContent>

            <TabsContent value="file" className="space-y-3 mt-3">
              <div className="space-y-1">
                <Label className="text-xs">Display Name (optional)</Label>
                <Input
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="e.g. Product Brochure"
                  className="h-8 text-sm"
                />
              </div>
              <div
                className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                {file ? (
                  <>
                    <FileUp className="h-6 w-6 text-primary" />
                    <span className="text-sm font-medium">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                  </>
                ) : (
                  <>
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <span className="text-sm">Click to choose a file</span>
                    <span className="text-xs text-muted-foreground">
                      PDF, DOCX, TXT, CSV (max 50 MB)
                    </span>
                  </>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.txt,.csv,.md,.json"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f && !fileName) setFileName(f.name.replace(/\.[^.]+$/, ""));
                }}
              />
            </TabsContent>
          </Tabs>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setAddOpen(false); resetAddForm(); }}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleAdd} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              {saving ? "Adding…" : "Add to Knowledge Base"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Advanced: Retrieval Settings ── */}
      <Dialog open={advOpen} onOpenChange={setAdvOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Settings className="h-4 w-4" />
              KB Retrieval Settings
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-1">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Retrieval Chunks (top_k)</Label>
                <span className="text-xs font-mono text-muted-foreground">{topK}</span>
              </div>
              <Slider
                min={1}
                max={20}
                step={1}
                value={[topK]}
                onValueChange={([v]) => setTopK(v)}
              />
              <p className="text-[10px] text-muted-foreground">
                Number of KB chunks retrieved per query. Higher = more context, slower.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Similarity Threshold (filter_score)</Label>
                <span className="text-xs font-mono text-muted-foreground">{filterScore.toFixed(2)}</span>
              </div>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[filterScore]}
                onValueChange={([v]) => setFilterScore(v)}
              />
              <p className="text-[10px] text-muted-foreground">
                Minimum similarity score for a chunk to be included (0 = include all, 1 = exact match only).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAdvOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={saveAdvanced}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Knowledge Base Instruction ── */}
      <Dialog open={instrOpen} onOpenChange={setInstrOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4" />
              Knowledge Base Instruction
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label className="text-xs">Instruction for the agent on how to use the KB</Label>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={6}
              placeholder="e.g. Only use the knowledge base when the caller asks about products or pricing. Always cite the source if possible."
              className="text-sm resize-none"
            />
            <p className="text-[10px] text-muted-foreground">
              This instruction is prepended to the system prompt to guide how the agent queries and uses the knowledge base.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setInstrOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={saveInstruction}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
