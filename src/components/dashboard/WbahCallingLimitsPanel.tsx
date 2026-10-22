import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gauge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { cn } from "@/lib/utils";
import {
  getWbahCallingLimits,
  setWbahCallingLimit,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import {
  WBAH_CALLING_LIMIT_UI_MAX,
  parseWbahCallingLimitInput,
  type WbahCallingLimitKind,
  type WbahCallingLimitState,
} from "@/lib/integrations/webespokeEnterprise/wbah-campaign-sync.types";
import { getMyPermissions } from "@/lib/permissions/team-access.functions";
import { hasPageAccess, type RolePermissions } from "@/lib/permissions/permissions.shared";

type LimitResult = { state: WbahCallingLimitState | null; error: string | null };
type LimitsResponse = Record<WbahCallingLimitKind, LimitResult>;

const QK = ["wbah-calling-limits"];

const LIMITS: Array<{
  kind: WbahCallingLimitKind;
  title: string;
  unit: string;
  description: string;
}> = [
  {
    kind: "daily",
    title: "Daily call cap",
    unit: "calls per lead per day",
    description:
      "Most times any one lead can be dialled in a UK day (resets 6am London). Counts every dial path — campaigns, callbacks and one-off calls — so this sets call volume for the whole system.",
  },
  {
    kind: "voicemail",
    title: "Voicemail cap",
    unit: "voicemails in a row",
    description:
      "Stop redialling a lead after this many voicemail-only calls in a row (no live answer). The lead is flagged for a person to review — not disqualified.",
  },
];

export function WbahCallingLimitsPanel() {
  const getLimitsFn = useServerFn(getWbahCallingLimits);
  const myPermsFn = useServerFn(getMyPermissions);

  const permsQ = useQuery({
    queryKey: ["my-permissions"],
    queryFn: () => myPermsFn(),
    staleTime: 5 * 60_000,
    throwOnError: false,
  });
  const perms = permsQ.data as RolePermissions | undefined;
  const canView = perms ? hasPageAccess(perms, "campaigns", "view") : false;
  const canEdit = perms ? hasPageAccess(perms, "campaigns", "edit") : false;

  const limitsQ = useQuery({
    queryKey: QK,
    queryFn: () => getLimitsFn() as Promise<LimitsResponse>,
    enabled: canView,
    staleTime: 30_000,
    throwOnError: false,
  });

  if (permsQ.isLoading || !canView) return null;

  return (
    <div className="rounded-xl border border-border dark:border-white/[0.06] bg-card/50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Gauge className="h-4 w-4 text-amber-400" />
        Calling Limits
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground max-w-2xl">
        How often the dialler may call each lead. Changes apply straight away — no restart needed.
      </p>

      {limitsQ.isError && (
        <p className="mt-3 text-[11px] text-destructive">
          {(limitsQ.error as Error)?.message || "Could not load calling limits"}
        </p>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {LIMITS.map((limit) => (
          <CallingLimitField
            key={limit.kind}
            {...limit}
            result={limitsQ.data?.[limit.kind]}
            loading={limitsQ.isLoading}
            canEdit={canEdit}
          />
        ))}
      </div>
    </div>
  );
}

function CallingLimitField({
  kind,
  title,
  unit,
  description,
  result,
  loading,
  canEdit,
}: (typeof LIMITS)[number] & { result?: LimitResult; loading: boolean; canEdit: boolean }) {
  const qc = useQueryClient();
  const setLimitFn = useServerFn(setWbahCallingLimit);
  const state = result?.state ?? null;

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Show the saved value whenever it loads or changes.
  useEffect(() => {
    if (state) setDraft(String(state.value));
  }, [state?.value]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseWbahCallingLimitInput(draft);
  const changed = state != null && parsed != null && parsed !== state.value;
  const inputId = `wbah-calling-limit-${kind}`;

  async function save() {
    if (parsed == null || saving) return;
    setSaving(true);
    try {
      const res = (await setLimitFn({ data: { kind, value: parsed } })) as { message: string };
      toast.success(res.message);
      await qc.invalidateQueries({ queryKey: QK });
    } catch (e) {
      toast.error((e as Error).message || `Failed to update ${title.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  }

  function onSave() {
    if (kind === "daily") setConfirmOpen(true);
    else void save();
  }

  return (
    <div className="rounded-lg border border-border dark:border-white/[0.06] bg-card/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={inputId} className="text-xs font-semibold">
          {title}
        </Label>
        {state && (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              state.source === "redis"
                ? "border-sky-500/30 bg-sky-500/10 text-sky-400"
                : "border-border bg-muted/40 text-muted-foreground",
            )}
          >
            {state.source === "redis" ? "Admin override" : "Server default"}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>

      {result?.error ? (
        <p className="mt-3 text-[11px] text-destructive">{result.error}</p>
      ) : loading || !state ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={1}
              max={WBAH_CALLING_LIMIT_UI_MAX}
              step={1}
              className="h-8 w-20 text-xs tabular-nums"
              value={draft}
              disabled={!canEdit || saving}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && changed) onSave();
              }}
            />
            <span className="text-[11px] text-muted-foreground">{unit}</span>
            {canEdit && (
              <Button size="sm" className="h-8 text-xs ml-auto" disabled={!changed || saving} onClick={onSave}>
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                Save
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            {draft.trim() !== "" && parsed == null ? (
              <span className="text-destructive">Enter a whole number from 1 to {WBAH_CALLING_LIMIT_UI_MAX}.</span>
            ) : (
              <>Server default is {state.envDefault}{state.source === "redis" ? " — used again if the override is cleared." : "."}</>
            )}
          </p>
        </>
      )}

      {kind === "daily" && (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Change the daily call cap to {parsed ?? "—"}?</AlertDialogTitle>
              <AlertDialogDescription>
                This changes how often every lead can be called, starting today, across campaigns,
                callbacks and one-off calls. It is currently {state?.value ?? "—"}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmOpen(false);
                  void save();
                }}
              >
                Change daily cap
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
