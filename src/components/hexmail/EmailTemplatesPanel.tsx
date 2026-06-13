import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listHexmailTemplates,
  cloneHexmailTemplate,
  archiveHexmailTemplate,
  type HexmailTemplate,
} from "@/lib/hexmail/templates.functions";
import { TemplateBuilder } from "./TemplateBuilder";

export function EmailTemplatesPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<HexmailTemplate | undefined>();

  const { data: templates = [], isLoading } = useQuery<HexmailTemplate[]>({
    queryKey: ["hexmail-templates", "email", showArchived],
    queryFn: () =>
      listHexmailTemplates({ data: { type: "email", includeArchived: showArchived } }),
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search email templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        <button
          onClick={() => setShowArchived((p) => !p)}
          className={cn(
            "text-xs transition-colors",
            showArchived ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </button>

        <div className="flex items-center gap-2 ml-auto">
          <Link to="/template-studio">
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs">
              <ExternalLink className="h-3.5 w-3.5" />
              All Templates
            </Button>
          </Link>
          <Button
            size="sm"
            className="gap-1.5 h-8"
            onClick={() => { setEditingTemplate(undefined); setBuilderOpen(true); }}
          >
            <Plus className="h-4 w-4" />
            New Email Template
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <p className="text-muted-foreground text-sm">
            {search ? "No templates match your search." : "No email templates yet."}
          </p>
          {!search && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => { setEditingTemplate(undefined); setBuilderOpen(true); }}
            >
              <Plus className="h-4 w-4" /> Create your first email template
            </Button>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Name</th>
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
                    "group hover:bg-muted/30 transition-colors cursor-pointer",
                    t.status === "archived" && "opacity-50",
                  )}
                  onClick={() => { setEditingTemplate(t); setBuilderOpen(true); }}
                >
                  <td className="px-4 py-3 font-medium text-foreground">{t.name}</td>
                  <td className="px-3 py-3 text-muted-foreground max-w-[240px] truncate">
                    {t.subject ?? <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground text-xs whitespace-nowrap">
                    {new Date(t.updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-3 text-center text-muted-foreground">{t.usage_count}</td>
                  <td className="px-3 py-3">
                    <Badge
                      variant={t.status === "active" ? "default" : "secondary"}
                      className="text-[10px]"
                    >
                      {t.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
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
                        <DropdownMenuItem onClick={() => { setEditingTemplate(t); setBuilderOpen(true); }}>
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

      <TemplateBuilder
        open={builderOpen}
        template={editingTemplate}
        defaultType="email"
        onClose={() => setBuilderOpen(false)}
        onSaved={() => {
          setBuilderOpen(false);
          qc.invalidateQueries({ queryKey: ["hexmail-templates"] });
        }}
      />
    </div>
  );
}
