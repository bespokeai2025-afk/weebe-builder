import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { EquationClause, EquationJoin, Transition } from "@/lib/builder/types";
import {
  EQUATION_OPERATORS,
  emptyEquationClause,
  operatorNeedsRight,
  serializeEquationPrompt,
} from "@/lib/voice/graph/equations.shared";
import { VariableBareInput, VariableInput } from "./VariableAutocompleteField";

function wrapLeft(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^\{\{.+\}\}$/.test(t)) return t;
  return `{{${t.replace(/^\{\{|\}\}$/g, "")}}}`;
}

export function patchEquationTransition(
  t: Transition,
  patch: Partial<Pick<Transition, "equationJoin" | "equations">>,
): Transition {
  const equations = patch.equations ?? t.equations ?? [emptyEquationClause()];
  const equationJoin = patch.equationJoin ?? t.equationJoin ?? "||";
  return {
    ...t,
    conditionType: "equation",
    equationJoin,
    equations,
    condition: serializeEquationPrompt({ join: equationJoin, equations }),
  };
}

export function EquationConditionEditor({
  transition,
  onChange,
  compact,
}: {
  transition: Transition;
  onChange: (next: Transition) => void;
  compact?: boolean;
}) {
  const clauses = transition.equations?.length
    ? transition.equations
    : [emptyEquationClause()];
  const join = transition.equationJoin ?? "||";

  const setJoin = (next: EquationJoin) => onChange(patchEquationTransition(transition, { equationJoin: next, equations: clauses }));

  const setClause = (i: number, clause: EquationClause) => {
    const next = clauses.map((c, idx) => (idx === i ? clause : c));
    onChange(patchEquationTransition(transition, { equations: next, equationJoin: join }));
  };

  const addClause = () =>
    onChange(
      patchEquationTransition(transition, {
        equationJoin: join,
        equations: [...clauses, emptyEquationClause()],
      }),
    );

  const removeClause = (i: number) => {
    const next = clauses.filter((_, idx) => idx !== i);
    onChange(
      patchEquationTransition(transition, {
        equationJoin: join,
        equations: next.length ? next : [emptyEquationClause()],
      }),
    );
  };

  return (
    <div className={cn("min-w-0 flex-1 space-y-1.5", compact && "space-y-1")}>
      <div className="flex items-center gap-1.5">
        <Select value={join} onValueChange={(v: EquationJoin) => setJoin(v)}>
          <SelectTrigger
            className={cn(
              "shrink-0",
              compact ? "nodrag nopan h-7 w-[88px] text-[11px]" : "h-8 w-[110px] text-xs",
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="||">If any</SelectItem>
            <SelectItem value="&&">If all</SelectItem>
          </SelectContent>
        </Select>
        {!compact && (
          <span className="text-[11px] text-muted-foreground">
            {join === "&&" ? "every clause must match" : "one matching clause is enough"}
          </span>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn("ml-auto h-7 px-2 text-[11px]", compact && "nodrag nopan h-6 px-1.5")}
          onClick={(e) => {
            e.stopPropagation();
            addClause();
          }}
        >
          <Plus className="mr-0.5 h-3 w-3" />
          Clause
        </Button>
      </div>
      {clauses.map((clause, i) => (
        <div key={i} className={cn("flex items-center gap-1", compact && "gap-0.5")}>
          {compact ? (
            <VariableBareInput
              value={clause.left}
              onValueChange={(v) => setClause(i, { ...clause, left: wrapLeft(v) })}
              placeholder="{{variable}}"
              className="nodrag nopan nowheel h-7 min-w-0 flex-1 rounded border bg-background px-1.5 font-mono text-[11px] outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <VariableInput
              value={clause.left}
              onValueChange={(v) => setClause(i, { ...clause, left: wrapLeft(v) })}
              placeholder="{{variable}}"
              className="h-8 font-mono text-xs"
            />
          )}
          <Select
            value={clause.operator}
            onValueChange={(v) =>
              setClause(i, { ...clause, operator: v as EquationClause["operator"] })
            }
          >
            <SelectTrigger
              className={cn(
                "shrink-0",
                compact ? "nodrag nopan h-7 w-[92px] text-[11px]" : "h-8 w-[140px] text-xs",
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EQUATION_OPERATORS.map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {operatorNeedsRight(clause.operator) ? (
            compact ? (
              <VariableBareInput
                value={clause.right ?? ""}
                onValueChange={(v) => setClause(i, { ...clause, right: v })}
                placeholder="value"
                className="nodrag nopan nowheel h-7 min-w-0 flex-1 rounded border bg-background px-1.5 text-[11px] outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <VariableInput
                value={clause.right ?? ""}
                onValueChange={(v) => setClause(i, { ...clause, right: v })}
                placeholder='Yes'
                className="h-8 text-xs"
              />
            )
          ) : (
            <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
              no value needed
            </span>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn("shrink-0", compact ? "nodrag nopan h-6 w-6" : "h-8 w-8")}
            onClick={(e) => {
              e.stopPropagation();
              removeClause(i);
            }}
            aria-label="Remove clause"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
