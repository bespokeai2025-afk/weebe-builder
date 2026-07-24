import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Trash2, Save } from "lucide-react";

export type OverlayFieldSpec = {
  tag: string; page: number; xPct: number; yPct: number; widthPct: number;
  fontSize: number; bold: boolean; align: "left" | "center" | "right";
  lineSpacing: number; color?: string | null;
};

export type OverlayFieldOption = { tag: string; label: string };

const inputCls = "bg-slate-950 border-slate-700 text-white";
const selectCls = "bg-slate-950 border border-slate-700 text-white text-xs";

/**
 * Generic drag-and-drop PDF overlay layout designer.
 *
 * Renders page 1 of the PDF behind draggable field chips whose positions are
 * stored as percentages from the top-left — the same coordinate system the
 * shared server renderer (src/lib/documents/pdf-overlay.server.ts) draws with.
 *
 * The component is host-agnostic: callers supply the PDF URL loader, the field
 * catalogue and the save handler, so the same designer serves both the
 * AccountsMind invoice templates and the Hexmail Template Studio documents.
 */
export function PdfOverlayDesigner({ open, title, loadPdfUrl, availableFields, initialFields, onSave, onClose }: {
  open: boolean;
  title: string;
  loadPdfUrl: () => Promise<string>;
  availableFields: OverlayFieldOption[];
  initialFields: OverlayFieldSpec[];
  onSave: (fields: OverlayFieldSpec[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [fields, setFields] = useState<OverlayFieldSpec[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const dragRef = useRef<{ idx: number; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const labelFor = (tag: string) => availableFields.find((f) => f.tag === tag)?.label ?? tag;

  useEffect(() => {
    if (!open) return;
    setFields(Array.isArray(initialFields) ? initialFields : []);
    setSelected(null);
    setLoadError("");
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const url = await loadPdfUrl();
        const buf = await (await fetch(url)).arrayBuffer();
        const pdfjs = await import("pdfjs-dist");
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        const page = await doc.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const targetW = 640;
        const vp1 = page.getViewport({ scale: 1 });
        const scale = targetW / vp1.width;
        const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${targetW}px`;
        canvas.style.height = `${(vp1.height / vp1.width) * targetW}px`;
        await page.render({ canvasContext: canvas.getContext("2d")!, viewport, canvas }).promise;
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message ?? "Failed to render PDF preview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addField = (tag: string) => {
    setFields((f) => [...f, {
      tag, page: 0, xPct: 8, yPct: 8 + (f.length * 4) % 60,
      widthPct: tag === "items_table" || tag === "payment_details" || tag.endsWith("address") ? 45 : 25,
      fontSize: 10, bold: tag === "total" || tag === "invoice_number", align: "left", lineSpacing: 1.2, color: "#111827",
    }]);
    setSelected(fields.length);
  };

  const onPointerDown = (e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    setSelected(idx);
    const f = fields[idx];
    dragRef.current = { idx, startX: e.clientX, startY: e.clientY, origX: f.xPct, origY: f.yPct };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const wrap = wrapRef.current;
    if (!d || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dx = ((e.clientX - d.startX) / rect.width) * 100;
    const dy = ((e.clientY - d.startY) / rect.height) * 100;
    setFields((fs) => fs.map((f, i) => i === d.idx
      ? { ...f, xPct: Math.min(98, Math.max(0, d.origX + dx)), yPct: Math.min(98, Math.max(0, d.origY + dy)) }
      : f));
  };
  const onPointerUp = () => { dragRef.current = null; };

  const patchSelected = (patch: Partial<OverlayFieldSpec>) => {
    if (selected == null) return;
    setFields((fs) => fs.map((f, i) => (i === selected ? { ...f, ...patch } : f)));
  };

  const save = async () => {
    setSaving(true);
    try {
      const ok = await onSave(fields);
      if (ok) onClose();
    } finally { setSaving(false); }
  };

  const sel = selected != null ? fields[selected] : null;
  const placedTags = useMemo(() => new Set(fields.map((f) => f.tag)), [fields]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl bg-slate-900 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-[190px_minmax(0,1fr)_220px] gap-4 items-start">
          {/* Left: available fields */}
          <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Fields — click to place</p>
            {availableFields.length === 0 && (
              <p className="text-xs text-slate-500">No fields available yet — add {"{{variables}}"} to the template body first.</p>
            )}
            {availableFields.map((f) => (
              <button key={f.tag} onClick={() => addField(f.tag)}
                className={`w-full text-left rounded-md border px-2 py-1 text-xs transition-colors ${placedTags.has(f.tag) ? "border-teal-700/60 bg-teal-900/20 text-teal-300" : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-600"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Centre: canvas + draggable chips */}
          <div className="overflow-auto max-h-[70vh]">
            {loadError ? (
              <p className="text-sm text-red-400 p-6">{loadError}</p>
            ) : (
              <div ref={wrapRef} className="relative inline-block select-none" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
                <canvas ref={canvasRef} className="rounded border border-slate-700 bg-white" />
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60">
                    <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
                  </div>
                )}
                {fields.map((f, i) => (
                  <div key={i}
                    onPointerDown={(e) => onPointerDown(e, i)}
                    style={{ left: `${f.xPct}%`, top: `${f.yPct}%`, width: `${f.widthPct}%`, fontSize: Math.max(8, f.fontSize) }}
                    className={`absolute cursor-move rounded border px-1 py-0.5 leading-tight truncate ${selected === i ? "border-sky-400 bg-sky-500/25 text-sky-100" : "border-teal-500/70 bg-teal-500/15 text-teal-900"} ${f.bold ? "font-bold" : ""}`}
                  >
                    <span style={{ textAlign: f.align, display: "block" }}>{labelFor(f.tag)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: selected field settings */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Field settings</p>
            {!sel ? (
              <p className="text-xs text-slate-500">Select a placed field to edit its size, font and alignment. Drag fields to position them.</p>
            ) : (
              <div className="space-y-2 text-xs">
                <p className="text-sm text-white">{labelFor(sel.tag)}</p>
                <label className="block text-slate-400">Font size
                  <Input type="number" min={5} max={48} value={sel.fontSize} onChange={(e) => patchSelected({ fontSize: Number(e.target.value) || 10 })} className={`mt-1 h-8 ${inputCls}`} />
                </label>
                <label className="block text-slate-400">Width %
                  <Input type="number" min={1} max={100} value={Math.round(sel.widthPct)} onChange={(e) => patchSelected({ widthPct: Math.min(100, Math.max(1, Number(e.target.value) || 25)) })} className={`mt-1 h-8 ${inputCls}`} />
                </label>
                <label className="block text-slate-400">Alignment
                  <select value={sel.align} onChange={(e) => patchSelected({ align: e.target.value as any })} className={`mt-1 w-full h-8 rounded-md px-2 ${selectCls}`}>
                    <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
                  </select>
                </label>
                <label className="block text-slate-400">Line spacing
                  <Input type="number" step={0.1} min={0.8} max={3} value={sel.lineSpacing} onChange={(e) => patchSelected({ lineSpacing: Number(e.target.value) || 1.2 })} className={`mt-1 h-8 ${inputCls}`} />
                </label>
                <label className="flex items-center gap-2 text-slate-400">
                  <input type="checkbox" checked={sel.bold} onChange={(e) => patchSelected({ bold: e.target.checked })} /> Bold
                </label>
                <label className="block text-slate-400">Colour
                  <input type="color" value={sel.color ?? "#111827"} onChange={(e) => patchSelected({ color: e.target.value })} className="mt-1 h-8 w-full rounded bg-slate-950 border border-slate-700" />
                </label>
                <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 w-full justify-start"
                  onClick={() => { setFields((fs) => fs.filter((_, i) => i !== selected)); setSelected(null); }}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove field
                </Button>
              </div>
            )}
            <Button size="sm" disabled={saving} onClick={save} className="w-full bg-sky-600 hover:bg-sky-500 mt-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save layout
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
