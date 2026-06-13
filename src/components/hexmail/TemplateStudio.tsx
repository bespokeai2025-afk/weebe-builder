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
import { Plus, Search, MoreHorizontal, Copy, Archive, Pencil, ArchiveRestore } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listHexmailTemplates,
  cloneHexmailTemplate,
  archiveHexmailTemplate,
  type HexmailTemplate,
  type TemplateType,
} from "@/lib/hexmail/templates.functions";
import { TemplateBuilder } from "./TemplateBuilder";

const TYPE_FILTERS: { value: TemplateType | "all"; label: string }[] = [
  { value: "all", label: "All Templates" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "document", label: "Document" },
  { value: "proposal", label: "Proposal" },
  { value: "quote", label: "Quote" },
  { value: "invoice", label: "Invoice" },
  { value: "contract", label: "Contract" },
];

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

function TypeBadge({ type }: { type: TemplateType }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize",
        TYPE_COLORS[type],
      )}
    >
      {type}
    </span>
  );
}

export function TemplateStudio() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<TemplateType | "all">("all");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<HexmailTemplate | undefined>();

  const { data: templates = [], isLoading } = useQuery<HexmailTemplate[]>({
    queryKey: ["hexmail-templates", typeFilter, showArchived],
    queryFn: () =>
      listHexmailTemplates({
        data: {
          type: typeFilter === "all" ? undefined : typeFilter,
          includeArchived: showArchived,
        },
      }),
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

  const filtered = templates.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()),
  );

  const openNew = () => {
    setEditingTemplate(undefined);
    setBuilderOpen(true);
  };

  const openEdit = (t: HexmailTemplate) => {
    setEditingTemplate(t);
    setBuilderOpen(true);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* ── Left type sidebar ── */}
      <aside className="w-44 shrink-0 border-r pr-0 py-1 flex flex-col gap-0.5">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setTypeFilter(f.value)}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-left transition-colors w-full",
              typeFilter === f.value
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            {f.label}
            {f.value !== "all" && (
              <span className="ml-auto text-[10px] text-muted-foreground">
                {templates.filter((t) => t.type === f.value).length || ""}
              </span>
            )}
          </button>
        ))}
        <div className="mt-auto pt-3 border-t">
          <button
            onClick={() => setShowArchived((p) => !p)}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-left transition-colors w-full",
              showArchived
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Archive className="h-3.5 w-3.5" />
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0 pl-6">
        {/* Header */}
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
          <Button onClick={openNew} size="sm" className="gap-1.5 ml-auto">
            <Plus className="h-4 w-4" />
            New Template
          </Button>
        </div>

        {/* Table */}
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
              <Button size="sm" variant="outline" onClick={openNew} className="gap-1.5">
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
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Subject</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Last Updated</th>
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
                      "group hover:bg-muted/30 transition-colors",
                      t.status === "archived" && "opacity-50",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{t.name}</td>
                    <td className="px-3 py-3">
                      <TypeBadge type={t.type} />
                    </td>
                    <td className="px-3 py-3 text-muted-foreground max-w-[200px] truncate">
                      {t.subject ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(t.updated_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-3 text-center text-muted-foreground">
                      {t.usage_count}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant={t.status === "active" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {t.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => openEdit(t)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => clone.mutate(t.id)}
                            disabled={clone.isPending}
                          >
                            <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() =>
                              toggleArchive.mutate({
                                id: t.id,
                                archive: t.status === "active",
                              })
                            }
                            disabled={toggleArchive.isPending}
                            className={t.status === "active" ? "text-destructive focus:text-destructive" : ""}
                          >
                            {t.status === "active" ? (
                              <><Archive className="mr-2 h-3.5 w-3.5" /> Archive</>
                            ) : (
                              <><ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Restore</>
                            )}
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
        onClose={() => setBuilderOpen(false)}
        onSaved={() => {
          setBuilderOpen(false);
          qc.invalidateQueries({ queryKey: ["hexmail-templates"] });
        }}
      />
    </div>
  );
}
