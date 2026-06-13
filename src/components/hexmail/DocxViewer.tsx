import { useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  fileUrl:         string;
  fills:           Record<string, string>;
  mode:            "edit" | "preview";
  className?:      string;
  onVarsDetected?: (vars: string[]) => void;
}

// ── Variable highlight injector ───────────────────────────────────────────────

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function injectHighlights(
  container: HTMLElement,
  fills: Record<string, string>,
  mode: "edit" | "preview",
): void {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (["SCRIPT", "STYLE"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return /\{\{[a-zA-Z_]/.test(node.textContent ?? "")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    },
  );

  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);

  for (const textNode of nodes) {
    const parent = textNode.parentNode;
    if (!parent) continue;
    const wrapper = document.createElement("span");
    wrapper.innerHTML = (textNode.textContent ?? "").replace(
      /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g,
      (_, key: string) => {
        if (mode === "preview") {
          const val = fills[key];
          return val
            ? `<strong style="font-weight:700">${escHtml(val)}</strong>`
            : `<em style="color:#9ca3af">[${escHtml(key)}]</em>`;
        }
        return `<mark style="background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:3px;font-family:ui-monospace,monospace;font-size:0.82em;border:1px solid rgba(217,119,6,0.35);font-weight:600">{{${escHtml(key)}}}</mark>`;
      },
    );
    parent.replaceChild(wrapper, textNode);
  }
}

// ── DocxViewer component ──────────────────────────────────────────────────────

export function DocxViewer({ fileUrl, fills, mode, className, onVarsDetected }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const styleRef      = useRef<HTMLDivElement>(null);
  const bufRef        = useRef<ArrayBuffer | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  // ── Render the cached buffer into the container ───────────────────────────

  const doRender = async (buf: ArrayBuffer) => {
    if (!containerRef.current) return;
    const { renderAsync } = await import("docx-preview");
    containerRef.current.innerHTML = "";
    await renderAsync(buf.slice(0), containerRef.current, styleRef.current ?? undefined, {
      inWrapper:              true,
      breakPages:             true,
      useBase64URL:           true,
      experimental:           true,
      ignoreWidth:            false,
      ignoreHeight:           false,
      ignoreFonts:            false,
      trimXmlDeclaration:     true,
    } as Parameters<typeof renderAsync>[3]);

    if (!containerRef.current) return;

    // Detect vars before highlighting (text nodes are still raw)
    const rawText = containerRef.current.textContent ?? "";
    const varNames: string[] = [];
    for (const m of rawText.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g)) {
      if (!varNames.includes(m[1])) varNames.push(m[1]);
    }
    onVarsDetected?.(varNames);

    // Inject highlights
    injectHighlights(containerRef.current, fills, mode);
  };

  // ── Fetch once on fileUrl change ──────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    bufRef.current = null;
    setLoading(true);
    setError(null);

    fetch(fileUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} loading document`);
        return r.arrayBuffer();
      })
      .then(async (buf) => {
        if (cancelled) return;
        bufRef.current = buf;
        await doRender(buf);
        if (!cancelled) setLoading(false);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load document");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  // ── Re-render when fills / mode change (uses cached buffer) ──────────────

  useEffect(() => {
    if (!bufRef.current || loading) return;
    let cancelled = false;
    doRender(bufRef.current).catch(() => {}).finally(() => {
      if (!cancelled) {} // no state change needed
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fills, mode]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={cn("relative bg-[#f0f0f0] rounded-lg overflow-auto", className)}>
      {/* docx-preview injects <style> tags — give it a scoped container */}
      <div ref={styleRef} className="hidden" />

      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#f0f0f0]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Rendering document…</p>
        </div>
      )}

      {error && !loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* docx-preview renders pages into this div */}
      <div
        ref={containerRef}
        className={cn("docx-render-root", loading && "invisible")}
        style={{ minHeight: 900 }}
      />
    </div>
  );
}
