import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sendLeadWhatsappTemplate } from "@/lib/dashboard/whatsapp.functions";
import { listWatiTemplates } from "@/lib/whatsapp/wati.functions";
import {
  defaultWatiTemplateParamMapping,
  encodeLiteralTemplateField,
  extractWatiTemplateParamSlots,
  isLiteralTemplateField,
  literalTemplateFieldText,
  WATI_TEMPLATE_PARAM_FIELD_OPTIONS,
} from "@/lib/whatsapp/wati-template-params.shared";
import { toast } from "sonner";

export function InboxTemplateComposer({
  leadId,
  phone,
  contactName,
  onSent,
}: {
  leadId?: string | null;
  phone: string;
  contactName?: string | null;
  onSent?: () => void;
}) {
  const sendFn = useServerFn(sendLeadWhatsappTemplate);
  const watiTmplFn = useServerFn(listWatiTemplates);
  const [templateName, setTemplateName] = useState("");
  const [paramMapping, setParamMapping] = useState<Record<string, string>>({});

  const {
    data: watiTemplates = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["wati-templates"],
    queryFn: () => watiTmplFn(),
    staleTime: 5 * 60_000,
    throwOnError: false,
  });

  const selected = (watiTemplates as any[]).find((t) => t.name === templateName);
  const paramSlots = useMemo(
    () => extractWatiTemplateParamSlots(selected),
    [selected],
  );

  const send = useMutation({
    mutationFn: () =>
      sendFn({
        data: {
          leadId: leadId ?? undefined,
          phone,
          contactName: contactName ?? undefined,
          templateName,
          templateParams: paramMapping,
          broadcastName: `inbox_reopen_${phone.replace(/\D/g, "").slice(-8)}`,
        },
      }),
    onSuccess: () => {
      toast.success("Template sent — the 24-hour window reopens when they reply");
      onSent?.();
    },
    onError: (e: Error) =>
      toast.error("Could not send the template", { description: e.message }),
  });

  const approved = (watiTemplates as any[]).filter(
    (t) => !t.status || String(t.status).toLowerCase() === "approved",
  );

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-warning">24-hour window closed.</span>{" "}
        Send an approved template to reconnect.
      </p>
      <div className="flex items-center gap-2">
        <Select
          value={templateName || undefined}
          onValueChange={(v) => {
            setTemplateName(v);
            const tpl = (watiTemplates as any[]).find((t) => t.name === v);
            setParamMapping(
              defaultWatiTemplateParamMapping(extractWatiTemplateParamSlots(tpl), tpl),
            );
          }}
          disabled={isLoading || approved.length === 0}
        >
          <SelectTrigger className="h-9 flex-1 text-sm" aria-label="Approved template">
            <SelectValue
              placeholder={
                isLoading
                  ? "Loading templates…"
                  : isError
                    ? "Could not load templates"
                    : approved.length === 0
                      ? "No approved templates"
                      : "Choose a template…"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {approved.map((t) => (
              <SelectItem key={t.id ?? t.name} value={t.name}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isLoading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
        {isError && (
          <Button type="button" variant="ghost" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        )}
        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={!templateName || send.isPending}
          onClick={() => send.mutate()}
        >
          {send.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send
        </Button>
      </div>

      {paramSlots.map((slot) => {
        const mapped = paramMapping[slot] ?? "";
        const isFixed = isLiteralTemplateField(mapped);
        const selectValue = isFixed ? "__fixed__" : mapped;
        return (
          <div key={slot} className="space-y-1">
            <div className="flex items-center gap-2">
              <Label className="w-16 shrink-0 text-[11px] text-muted-foreground">{`{{${slot}}}`}</Label>
              <Select
                value={selectValue || undefined}
                onValueChange={(v) =>
                  setParamMapping({
                    ...paramMapping,
                    [slot]: v === "__fixed__" ? encodeLiteralTemplateField("") : v,
                  })
                }
              >
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue placeholder="Map to field…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__fixed__">Fixed text</SelectItem>
                  {WATI_TEMPLATE_PARAM_FIELD_OPTIONS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isFixed && (
              <Input
                className="ml-[4.5rem] h-8 text-xs"
                placeholder="Fixed value"
                value={literalTemplateFieldText(mapped)}
                onChange={(e) =>
                  setParamMapping({
                    ...paramMapping,
                    [slot]: encodeLiteralTemplateField(e.target.value),
                  })
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
