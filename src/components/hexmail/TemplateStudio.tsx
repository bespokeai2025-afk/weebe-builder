import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Search,
  MoreHorizontal,
  Copy,
  Archive,
  Pencil,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listHexmailTemplates,
  cloneHexmailTemplate,
  archiveHexmailTemplate,
  type HexmailTemplate,
  type TemplateType,
} from "@/lib/hexmail/templates.functions";
import { TemplateBuilder } from "./TemplateBuilder";

// ── Filter config ──────────────────────────────────────────────────────────────

const DOC_SUB_TYPES: TemplateType[] = ["document", "proposal", "quote", "invoice", "contract"];
const DOC_SUB_LABELS: Record<string, string> = {
  document: "General",
  proposal: "Proposal",
  quote:    "Quote",
  invoice:  "Invoice",
  contract: "Contract",
};

type FilterValue = TemplateType | "all" | "documents";

// ── Type badge colours ─────────────────────────────────────────────────────────

const TYPE_COLORS: Record<TemplateType, string> = {
  email:    "bg-blue-500/10 text-blue-500 border-blue-500/20",
  sms:      "bg-green-500/10 text-green-500 border-green-500/20",
  whatsapp: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  document: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  proposal: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  quote:    "bg-amber-500/10 text-amber-500 border-amber-500/20",
  invoice:  "bg-orange-500/10 text-orange-500 border-orange-500/20",
  contract: "bg-rose-500/10 text-rose-500 border-rose-500/20",
};

const TYPE_DISPLAY: Record<TemplateType, string> = {
  email:    "Email",
  sms:      "SMS",
  whatsapp: "WhatsApp",
  document: "Document",
  proposal: "Proposal",
  quote:    "Quote",
  invoice:  "Invoice",
  contract: "Contract",
};

function TypeBadge({ type }: { type: TemplateType }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium",
      TYPE_COLORS[type],
    )}>
      {TYPE_DISPLAY[type]}
    </span>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function TemplateStudio() {
  const qc = useQueryClient();
  const [filter, setFilter]           = useState<FilterValue>("all");
  const [docsExpanded, setDocsExpanded] = useState(true);
  const [search, setSearch]           = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<HexmailTemplate | undefined>();
  const [newDefaultType, setNewDefaultType] = useState<TemplateType | undefined>();

  // Always fetch all so sidebar counts are live
  const { data: allTemplates = [], isLoading } = useQuery<HexmailTemplate[]>({
    queryKey: ["hexmail-templates", "all", showArchived],
    queryFn: () => listHexmailTemplates({ data: { includeArchived: showArchived } }),
  });

  const clone = useMutation({
    mutationFn: (id: string) => cloneHexmailTemplate({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hexmail-templates"] }),
  });

  const toggleArchive = useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      archiveHexmailTemplate({ data: { id, archive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hexmail-templates"] }),
  });

  // ── Filtering ────────────────────────────────────────────────────────────────

  const visibleTypes: TemplateType[] | null =
    filter === "all"       ? null :
    filter === "documents" ? DOC_SUB_TYPES :
    [filter as TemplateType];

  const filtered = allTemplates.filter((t) => {
    if (visibleTypes && !visibleTypes.includes(t.type)) return false;
    if (!t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Counts
  const countOf = (types: TemplateType | TemplateType[]) => {
    const arr = Array.isArray(types) ? types : [types];
    return allTemplates.filter((t) => arr.includes(t.type)).length;
  };

  // ── Open builder ─────────────────────────────────────────────────────────────

  const openNew = (defaultType?: TemplateType) => {
    setEditingTemplate(undefined);
    setNewDefaultType(defaultType);
    setBuilderOpen(true);
  };

  const openEdit = (t: HexmailTemplate) => {
    setEditingTemplate(t);
    setNewDefaultType(undefined);
    setBuilderOpen(true);
  };

  // ── Sidebar nav item ──────────────────────────────────────────────────────────

  const NavItem = ({
    value,
    label,
    count,
    indent = false,
  }: {
    value: FilterValue;
    label: string;
    count?: number;
    indent?: boolean;
  }) => (
    <button
      onClick={() => setFilter(value)}
      className={cn(
        "flex items-center gap-2 rounded-md py-1.5 text-sm text-left transition-colors w-full",
        indent ? "pl-7 pr-3" : "px-3",
        filter === value
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
      )}
    >
      <span className="flex-1">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-[10px] text-muted-foreground">{count}</span>
      )}
    </button>
  );

  return (
    <div className="flex h-full min-h-0">

      {/* ── Left sidebar ── */}
      <aside className="w-48 shrink-0 border-r py-1 flex flex-col gap-0.5 pr-0">
        <NavItem value="all" label="All Templates" count={allTemplates.length} />

        <div className="h-px bg-border/50 my-1 mx-3" />

        <NavItem value="email"    label="Email"    count={countOf("email")} />
        <NavItem value="sms"      label="SMS"      count={countOf("sms")} />
        <NavItem value="whatsapp" label="WhatsApp" count={countOf("whatsapp")} />

        <div className="h-px bg-border/50 my-1 mx-3" />

        {/* Documents group */}
        <button
          onClick={() => { setDocsExpanded((p) => !p); setFilter("documents"); }}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-left transition-colors w-full",
            (filter === "documents" || DOC_SUB_TYPES.includes(filter as TemplateType))
              ? "bg-primary/10 text-primary font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          )}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">Documents</span>
          <span className="text-[10px] text-muted-foreground mr-1">{countOf(DOC_SUB_TYPES) || ""}</span>
          {docsExpanded
            ? <ChevronDown className="h-3 w-3 shrink-0" />
            : <ChevronRight className="h-3 w-3 shrink-0" />}
        </button>

        {docsExpanded && (
          <div className="flex flex-col gap-0.5">
            {DOC_SUB_TYPES.map((sub) => (
              <NavItem
                key={sub}
                value={sub}
                label={DOC_SUB_LABELS[sub]}
                count={countOf(sub)}
                indent
              />
            ))}
          </div>
        )}

        {/* Archive toggle */}
        <div className="mt-auto pt-3 border-t">
          <button
            onClick={() => setShowArchived((p) => !p)}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-left transition-colors w-full",
              showArchived ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Archive className="h-3.5 w-3.5" />
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0 pl-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search templates…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Button
            onClick={() => openNew(
              filter === "all"       ? undefined :
              filter === "documents" ? "document" :
              filter as TemplateType
            )}
            size="sm"
            className="gap-1.5 ml-auto"
          >
            <Plus className="h-4 w-4" />
            New{" "}
            {filter === "all"       ? "Template" :
             filter === "documents" ? "Document" :
             DOC_SUB_LABELS[filter as string] ?? TYPE_DISPLAY[filter as TemplateType]}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Loading templates…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
            <p className="text-muted-foreground text-sm">
              {search ? "No templates match your search." : "No templates yet."}
            </p>
            {!search && (
              <Button size="sm" variant="outline" onClick={() => openNew()} className="gap-1.5">
                <Plus className="h-4 w-4" /> Create your first template
              </Button>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Subject / File</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Updated</th>
                  <th className="text-center px-3 py-2.5 text-xs font-medium text-muted-foreground">Uses</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    className={cn(
                      "group hover:bg-muted/30 transition-colors cursor-pointer",
                      t.status === "archived" && "opacity-50",
                    )}
                    onClick={() => openEdit(t)}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{t.name}</td>
                    <td className="px-3 py-3"><TypeBadge type={t.type} /></td>
                    <td className="px-3 py-3 text-muted-foreground max-w-[200px] truncate text-xs">
                      {t.subject?.startsWith("http")
                        ? <span className="flex items-center gap-1"><FileText className="h-3 w-3 shrink-0" /> Attachment</span>
                        : t.subject ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(t.updated_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-3 text-center text-muted-foreground">{t.usage_count}</td>
                    <td className="px-3 py-3">
                      <Badge variant={t.status === "active" ? "default" : "secondary"} className="text-[10px]">
                        {t.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => openEdit(t)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => clone.mutate(t.id)} disabled={clone.isPending}>
                            <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => toggleArchive.mutate({ id: t.id, archive: t.status === "active" })}
                            disabled={toggleArchive.isPending}
                            className={t.status === "active" ? "text-destructive focus:text-destructive" : ""}
                          >
                            {t.status === "active"
                              ? <><Archive className="mr-2 h-3.5 w-3.5" /> Archive</>
                              : <><ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Restore</>}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TemplateBuilder
        open={builderOpen}
        template={editingTemplate}
        defaultType={newDefaultType}
        onClose={() => setBuilderOpen(false)}
        onSaved={() => {
          setBuilderOpen(false);
          qc.invalidateQueries({ queryKey: ["hexmail-templates"] });
        }}
      />
    </div>
  );
}
