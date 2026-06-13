import { type DocHeader, type VarMap } from "@/lib/hexmail/vars-helpers";
import { type TemplateType } from "@/lib/hexmail/templates.functions";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  body:         string;
  header:       DocHeader;
  vars:         VarMap;
  fills:        Record<string, string>;
  templateType: TemplateType;
  templateName: string;
  mode:         "edit" | "preview";
  className?:   string;
}

// ── Document-type labels ──────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Partial<Record<TemplateType, string>> = {
  document: "Document",
  proposal: "Proposal",
  quote:    "Quote",
  invoice:  "Invoice",
  contract: "Contract",
};

// ── Inline-format parser ──────────────────────────────────────────────────────
// Handles **bold**, *italic*, __bold__, _italic_

type TextNode = { kind: "text"; text: string };
type BoldNode = { kind: "bold"; children: InlineNode[] };
type ItalicNode = { kind: "italic"; children: InlineNode[] };
type VarNode = { kind: "var"; key: string };
type InlineNode = TextNode | BoldNode | ItalicNode | VarNode;

function parseInline(raw: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  // Split on {{var}}, **bold**, *italic* tokens in one pass
  const re = /(\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}|\*\*([\s\S]+?)\*\*|\*([\s\S]+?)\*|__([\s\S]+?)__|_([^_]+?)_)/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > cursor) {
      nodes.push({ kind: "text", text: raw.slice(cursor, m.index) });
    }
    if (m[2]) {
      nodes.push({ kind: "var", key: m[2] });
    } else if (m[3]) {
      nodes.push({ kind: "bold", children: parseInline(m[3]) });
    } else if (m[5]) {
      nodes.push({ kind: "bold", children: parseInline(m[5]) });
    } else if (m[4]) {
      nodes.push({ kind: "italic", children: parseInline(m[4]) });
    } else if (m[6]) {
      nodes.push({ kind: "italic", children: parseInline(m[6]) });
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < raw.length) {
    nodes.push({ kind: "text", text: raw.slice(cursor) });
  }
  return nodes;
}

function renderInlineNodes(
  nodes: InlineNode[],
  fills: Record<string, string>,
  mode: "edit" | "preview",
  keyPrefix: string,
): React.ReactNode {
  return nodes.map((node, i) => {
    const k = `${keyPrefix}-${i}`;
    if (node.kind === "text") return node.text ? <span key={k}>{node.text}</span> : null;
    if (node.kind === "bold")   return <strong key={k}>{renderInlineNodes(node.children, fills, mode, k)}</strong>;
    if (node.kind === "italic") return <em key={k}>{renderInlineNodes(node.children, fills, mode, k)}</em>;
    if (node.kind === "var") {
      if (mode === "preview") {
        const val = fills[node.key];
        return (
          <span key={k} className={val ? "font-medium" : "italic text-gray-400"}>
            {val || `[${node.key}]`}
          </span>
        );
      }
      return (
        <span key={k} className="bg-amber-100 text-amber-800 rounded px-1 py-0 text-[0.75em] font-mono border border-amber-300/60">
          {`{{${node.key}}}`}
        </span>
      );
    }
    return null;
  });
}

function renderText(
  text: string,
  fills: Record<string, string>,
  mode: "edit" | "preview",
  keyPrefix: string,
): React.ReactNode {
  return renderInlineNodes(parseInline(text), fills, mode, keyPrefix);
}

// ── Line renderer ─────────────────────────────────────────────────────────────

function renderLines(
  body: string,
  fills: Record<string, string>,
  mode: "edit" | "preview",
): React.ReactNode[] {
  if (!body.trim()) return [];
  const lines = body.split("\n");
  const elements: React.ReactNode[] = [];
  let listBuffer: React.ReactNode[] = [];

  const flushList = () => {
    if (listBuffer.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="list-disc pl-5 my-2 space-y-0.5">
          {listBuffer}
        </ul>,
      );
      listBuffer = [];
    }
  };

  lines.forEach((line, idx) => {
    const key = `line-${idx}`;
    const trimmed = line.trimStart();

    // Horizontal rule
    if (/^(-{3,}|={3,}|\*{3,})$/.test(trimmed)) {
      flushList();
      elements.push(<hr key={key} className="my-4 border-gray-200" />);
      return;
    }

    // Headings
    if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(
        <h3 key={key} className="text-base font-bold mt-4 mb-1 text-gray-800 tracking-tight">
          {renderText(trimmed.slice(4), fills, mode, key)}
        </h3>,
      );
      return;
    }
    if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(
        <h2 key={key} className="text-lg font-bold mt-5 mb-1.5 text-gray-900 tracking-tight">
          {renderText(trimmed.slice(3), fills, mode, key)}
        </h2>,
      );
      return;
    }
    if (trimmed.startsWith("# ")) {
      flushList();
      elements.push(
        <h1 key={key} className="text-xl font-bold mt-6 mb-2 text-gray-900 tracking-tight">
          {renderText(trimmed.slice(2), fills, mode, key)}
        </h1>,
      );
      return;
    }

    // List items
    if (/^[-•*] /.test(trimmed)) {
      listBuffer.push(
        <li key={key} className="text-sm text-gray-700 leading-relaxed">
          {renderText(trimmed.slice(2), fills, mode, key)}
        </li>,
      );
      return;
    }

    // Numbered list
    if (/^\d+\.\s/.test(trimmed)) {
      const content = trimmed.replace(/^\d+\.\s/, "");
      if (listBuffer.length === 0) {
        // switch to an ordered list — flush any unordered buffer first
        flushList();
      }
      listBuffer.push(
        <li key={key} className="text-sm text-gray-700 leading-relaxed">
          {renderText(content, fills, mode, key)}
        </li>,
      );
      return;
    }

    flushList();

    // Empty line
    if (trimmed === "") {
      elements.push(<div key={key} className="h-2" />);
      return;
    }

    // Table-like lines (|col|col|)
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      const isSep = cells.every((c) => /^[-:]+$/.test(c));
      if (!isSep) {
        elements.push(
          <div key={key} className="flex gap-px text-sm text-gray-700 border-b border-gray-100 last:border-0">
            {cells.map((cell, ci) => (
              <div key={ci} className="flex-1 py-1 px-2">
                {renderText(cell, fills, mode, `${key}-c${ci}`)}
              </div>
            ))}
          </div>,
        );
      }
      return;
    }

    // Normal paragraph
    elements.push(
      <p key={key} className="text-sm text-gray-700 leading-relaxed">
        {renderText(line, fills, mode, key)}
      </p>,
    );
  });

  flushList();
  return elements;
}

// ── Main component ────────────────────────────────────────────────────────────

export function DocumentPreview({
  body,
  header,
  fills,
  templateType,
  templateName,
  mode,
  className,
}: Props) {
  const typeLabel = DOC_TYPE_LABELS[templateType] ?? "Document";
  const hasHeader = header.logoUrl || header.companyName;
  const lines = renderLines(body, fills, mode);

  return (
    <div className={cn("bg-[#f0f0f0] rounded-lg overflow-auto", className)}>
      {/* A4-style paper */}
      <div
        className="bg-white mx-auto my-6 shadow-[0_4px_24px_rgba(0,0,0,0.12)] text-[#1a1a1a]"
        style={{
          maxWidth: 680,
          minHeight: 900,
          padding: "56px 64px 64px",
          fontFamily: '"Georgia", "Times New Roman", serif',
        }}
      >
        {/* ── Document header ─────────────────────────────────────────── */}
        {hasHeader && (
          <div className="flex items-start justify-between mb-8 pb-6 border-b border-gray-200">
            <div className="flex items-center gap-4">
              {header.logoUrl && (
                <img
                  src={header.logoUrl}
                  alt={header.companyName ?? "Logo"}
                  className="object-contain"
                  style={{ maxHeight: 52, maxWidth: 160 }}
                />
              )}
              {header.companyName && (
                <div>
                  <p className="font-bold text-base leading-tight" style={{ fontFamily: "system-ui, sans-serif" }}>
                    {header.companyName}
                  </p>
                  {header.tagline && (
                    <p className="text-xs text-gray-500 mt-0.5" style={{ fontFamily: "system-ui, sans-serif" }}>
                      {header.tagline}
                    </p>
                  )}
                </div>
              )}
            </div>
            <span
              className="text-[10px] uppercase tracking-widest text-gray-500 border border-gray-300 rounded px-2 py-0.5 mt-1"
              style={{ fontFamily: "system-ui, sans-serif" }}
            >
              {typeLabel}
            </span>
          </div>
        )}

        {/* ── Document title ───────────────────────────────────────────── */}
        {!hasHeader && (
          <div className="flex items-center justify-between mb-6">
            <span
              className="text-[10px] uppercase tracking-widest text-gray-500 border border-gray-300 rounded px-2 py-0.5"
              style={{ fontFamily: "system-ui, sans-serif" }}
            >
              {typeLabel}
            </span>
          </div>
        )}

        {templateName && (
          <h1
            className="text-2xl font-bold mb-6 text-gray-900 leading-snug"
            style={{ fontFamily: "system-ui, sans-serif" }}
          >
            {templateName}
          </h1>
        )}

        {/* ── Body ─────────────────────────────────────────────────────── */}
        {lines.length > 0 ? (
          <div className="space-y-0">{lines}</div>
        ) : (
          <p className="text-sm text-gray-400 italic" style={{ fontFamily: "system-ui, sans-serif" }}>
            Nothing to preview yet.
          </p>
        )}
      </div>
    </div>
  );
}
