import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTablePagination, TablePagBar } from "@/components/ui/table-pagination";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Trash2, Plus, Globe2, User, Radio, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useBuilderStore } from "@/lib/builder/store";
import type { BuilderSettings } from "@/lib/builder/types";
import {
  listAgentTemplates,
  getAgentTemplate,
  deleteAgentTemplate,
  isCurrentUserAdmin,
} from "@/lib/agents/templates.functions";

export const Route = createFileRoute("/_authenticated/templates")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search.mode === "picker" ? ("picker" as const) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Agent Templates — Webee" },
      {
        name: "description",
        content:
          "Browse global agent templates and your personal saved templates. Clone any template into the builder to start a new agent.",
      },
    ],
  }),
  component: TemplatesPage,
});

function TemplatesPage() {
  const { mode } = Route.useSearch();
  const isPicker = mode === "picker";
  const navigate = useNavigate();
  const listFn = useServerFn(listAgentTemplates);
  const getFn = useServerFn(getAgentTemplate);
  const deleteFn = useServerFn(deleteAgentTemplate);
  const adminFn = useServerFn(isCurrentUserAdmin);
  const qc = useQueryClient();

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [engineMismatch, setEngineMismatch] = useState<{
    templateId: string;
    selectedEngine: string;
    templateEngine: string;
  } | null>(null);

  const templatesQ = useQuery({
    queryKey: ["agent-templates"],
    queryFn: () => listFn(),
    refetchOnWindowFocus: false,
  });

  const adminQ = useQuery({
    queryKey: ["is-admin"],
    queryFn: () => adminFn(),
    refetchOnWindowFocus: false,
  });

  async function handleUse(id: string, skipMismatchCheck = false) {
    // In picker mode, warn if the template's engine differs from what the user
    // selected on the new-agent page before opening the template browser.
    if (isPicker && !skipMismatchCheck) {
      const storeProvider = useBuilderStore.getState().settings.voiceProvider ?? "RETELL";
      // Peek at the template list for the engine without a full fetch.
      const templateItem = (Array.isArray(templatesQ.data) ? (templatesQ.data as TemplateItem[]) : []).find((t) => t.id === id);
      const templateProvider =
        (templateItem?.settings?.voiceProvider as string | undefined) ?? "RETELL";
      if (storeProvider !== templateProvider) {
        setEngineMismatch({ templateId: id, selectedEngine: storeProvider, templateEngine: templateProvider });
        return;
      }
    }

    setLoadingId(id);
    try {
      const row = await getFn({ data: { id } });
      if (!row) throw new Error("Template not found");
      const flow = (row.flow_data ?? {}) as { nodes?: unknown; edges?: unknown };
      const rawNodes = Array.isArray(flow.nodes) ? flow.nodes : [];
      const edges = Array.isArray(flow.edges) ? flow.edges : [];
      const settings = (row.settings ?? {}) as Record<string, unknown>;
      const variables = Array.isArray(row.variables) ? row.variables : [];

      // Strip any per-node Cal.com credentials saved by the template author so
      // the user's own workspace credentials are used when they deploy.
      const nodes = (rawNodes as Array<Record<string, unknown>>).map((node) => {
        const data = node.data as Record<string, unknown> | undefined;
        if (!data) return node;
        const {
          toolApiKey: _k,
          toolEventTypeId: _e,
          toolTimezone: _tz,
          ...cleanData
        } = data as Record<string, unknown> & {
          toolApiKey?: unknown;
          toolEventTypeId?: unknown;
          toolTimezone?: unknown;
        };
        return { ...node, data: cleanData };
      });

      // Strip identifiers and admin-specific credentials so a fresh agent is
      // created and the user's own Retell API key / Cal.com webhooks are used.
      const cleanSettings = {
        ...settings,
        agentId: undefined,
        conversationFlowId: undefined,
        deployedRetellAgentId: undefined,
        deployedConversationFlowId: undefined,
        phoneNumber: undefined,
        productionRetellApiKey: undefined,
        productionRetellApiKeyMasked: undefined,
        productionRetellApiKeySavedAt: undefined,
        webhookUrl: undefined,
        agentName: `${row.name} (copy)`,
      };
      useBuilderStore.getState().loadFlow({
        nodes: nodes as never,
        edges: edges as never,
        settings: cleanSettings as never,
        variables: variables as never,
        agentRowId: null,
      });
      // Explicitly restore voice provider fields so the builder sidebar
      // always shows the engine card that matches the template's engine,
      // not whatever was left over from a previous session.
      // IMPORTANT: also derive and set deploymentMode from vp so that stale
      // deploymentMode values persisted in localStorage cannot contaminate
      // this template (resolveDeploymentMode checks deploymentMode first).
      const vp =
        (cleanSettings.voiceProvider as BuilderSettings["voiceProvider"] | undefined) ??
        "RETELL";
      const derivedDeploymentMode =
        vp === "OPENAI_REALTIME" ? "OPENAI_NATIVE" : "RETELL";
      useBuilderStore.getState().setSettings({
        voiceProvider: vp,
        deploymentMode: derivedDeploymentMode,
        openaiVoice:
          (cleanSettings.openaiVoice as BuilderSettings["openaiVoice"] | undefined) ?? "alloy",
        openaiReasoningEffort:
          (cleanSettings.openaiReasoningEffort as BuilderSettings["openaiReasoningEffort"] | undefined) ??
          "low",
      });
      toast.success("Template loaded", { description: row.name });
      navigate({ to: "/builder", search: { new: undefined } });
    } catch (e) {
      toast.error("Failed to load template", { description: (e as Error).message });
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteFn({ data: { id: deleteTarget.id } });
      toast.success("Template deleted");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["agent-templates"] });
    } catch (e) {
      toast.error("Delete failed", { description: (e as Error).message });
    } finally {
      setDeleting(false);
    }
  }

  if (templatesQ.isLoading) {
    return (
      <main className="min-h-screen bg-background">
        <header className="border-b">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
            <Link
              to="/builder"
              search={{ new: undefined }}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <Logo className="h-7" />
            </Link>
            <h1 className="text-sm font-medium hidden md:block">Agent Templates</h1>
            <div className="flex items-center gap-2">
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-6xl px-4 py-8 space-y-10">
          {[1, 2].map((section) => (
            <section key={section}>
              <div className="h-5 w-32 animate-pulse rounded bg-muted mb-4" />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="rounded-lg border p-5 space-y-3">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-full animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    );
  }

  if (templatesQ.isError) {
    return (
      <main className="min-h-screen bg-background">
        <header className="border-b">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
            {isPicker ? (
              <Link
                to="/agents/new"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                <Logo className="h-7" />
              </Link>
            ) : (
              <Link
                to="/builder"
                search={{ new: undefined }}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                <Logo className="h-7" />
              </Link>
            )}
            <h1 className="text-sm font-medium hidden md:block">Agent Templates</h1>
            <div className="flex items-center gap-2">
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="rounded-md border border-destructive/50 p-8 text-center text-sm text-destructive space-y-3">
            <p>Failed to load templates. Please try again.</p>
            <Button variant="outline" size="sm" onClick={() => templatesQ.refetch()}>
              Retry
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const all = templatesQ.data ?? [];
  const globals = all.filter((t) => t.scope === "global");
  const personals = all.filter((t) => t.scope === "personal");
  const isAdmin = adminQ.data?.isAdmin ?? false;

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          {isPicker ? (
            <Link
              to="/agents/new"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <Logo className="h-7" />
            </Link>
          ) : (
            <Link
              to="/builder"
              search={{ new: undefined }}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <Logo className="h-7" />
            </Link>
          )}
          <h1 className="text-sm font-medium hidden md:block">
            {isPicker ? "Choose a template" : "Agent Templates"}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild size="sm" variant="default" className="gap-1">
              <Link to="/agents/new">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New agent</span>
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 space-y-10">
        {isPicker && (
          <p className="text-sm text-muted-foreground">
            Pick a global template to load into the builder. You can edit the flow before saving.
          </p>
        )}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Globe2 className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Global templates</h2>
            <Badge variant="secondary" className="ml-1">
              {globals.length}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Curated starting points available to everyone in the workspace.
            {isAdmin
              ? " As an admin, open one in the builder and use Save as template → Global to add new ones."
              : ""}
          </p>
          <TemplateGrid
            items={globals}
            onUse={handleUse}
            onDelete={(t) => setDeleteTarget(t)}
            canDelete={(t) => (t.scope === "personal" ? true : isAdmin)}
            loadingId={loadingId}
            empty="No global templates yet."
          />
        </section>

        {!isPicker && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <User className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">My templates</h2>
            <Badge variant="secondary" className="ml-1">
              {personals.length}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Your private templates. Save the current builder draft from the builder header.
          </p>
          <TemplateGrid
            items={personals}
            onUse={handleUse}
            onDelete={(t) => setDeleteTarget(t)}
            canDelete={() => true}
            loadingId={loadingId}
            empty="You haven't saved any templates yet."
          />
        </section>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes &quot;{deleteTarget?.name}&quot;. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!engineMismatch} onOpenChange={(o) => !o && setEngineMismatch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Engine mismatch</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  You selected{" "}
                  <span className="font-medium text-foreground">
                    {engineMismatch?.selectedEngine === "OPENAI_REALTIME"
                      ? "HyperStream"
                      : "OmniVoice"}
                  </span>{" "}
                  on the new-agent page, but this template is built for{" "}
                  <span className="font-medium text-foreground">
                    {engineMismatch?.templateEngine === "OPENAI_REALTIME"
                      ? "HyperStream"
                      : "OmniVoice"}
                  </span>
                  .
                </p>
                <p>
                  Loading it will switch your agent to{" "}
                  <span className="font-medium text-foreground">
                    {engineMismatch?.templateEngine === "OPENAI_REALTIME"
                      ? "HyperStream"
                      : "OmniVoice"}
                  </span>{" "}
                  and apply the template's engine-specific settings (voice, reasoning effort, etc.).
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setEngineMismatch(null)}>
              Go back
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = engineMismatch!.templateId;
                setEngineMismatch(null);
                handleUse(id, true);
              }}
            >
              Switch engine &amp; use template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

interface TemplateItem {
  id: string;
  scope: "global" | "personal";
  name: string;
  description: string;
  settings: Record<string, unknown> | null;
  updated_at: string;
}

function TemplateGrid({
  items,
  onUse,
  onDelete,
  canDelete,
  loadingId,
  empty,
}: {
  items: TemplateItem[];
  onUse: (id: string) => void;
  onDelete: (t: { id: string; name: string }) => void;
  canDelete: (t: TemplateItem) => boolean;
  loadingId: string | null;
  empty: string;
}) {
  const pag = useTablePagination(items, 25);
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }
  return (
    <div>
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {pag.sliced.map((t) => (
        <Card key={t.id} data-tour={t.name.toLowerCase().includes("receptionist") ? "template-receptionist" : undefined}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base">{t.name}</CardTitle>
              {t.settings?.voiceProvider === "OPENAI_REALTIME" ? (
                <Badge
                  variant="outline"
                  className="shrink-0 border-violet-500/40 bg-violet-500/10 text-violet-300 text-xs gap-1 px-1.5 py-0.5"
                >
                  <Zap className="h-3 w-3" />
                  HyperStream
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="shrink-0 border-sky-500/40 bg-sky-500/10 text-sky-300 text-xs gap-1 px-1.5 py-0.5"
                >
                  <Radio className="h-3 w-3" />
                  OmniVoice
                </Badge>
              )}
            </div>
            <CardDescription className="line-clamp-2">
              {t.description || "No description."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Updated {new Date(t.updated_at).toLocaleDateString()}
            </span>
            <div className="flex items-center gap-1">
              {canDelete(t) ? (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => onDelete({ id: t.id, name: t.name })}
                  aria-label="Delete template"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
              <Button size="sm" onClick={() => onUse(t.id)} disabled={loadingId === t.id}>
                {loadingId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Use template"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
    <TablePagBar {...pag} />
    </div>
  );
}
