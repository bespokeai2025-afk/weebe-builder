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

  const { data: watiTemplates = [] } = useQuery({
    queryKey: ["wati-templates"],
    queryFn: () => watiTmplFn(),
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
    onError: (e: Error) => toast.error(e.message),
  });

  const approved = (watiTemplates as any[]).filter(
    (t) => !t.status || String(t.status).toLowerCase() === "approved",
  );

  return (
    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
        24-hour session closed
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        WhatsApp only allows free-text replies within 24 hours of the client’s last message.
        Send an approved template to reconnect. The session reopens when they reply.
      </p>
      <div className="space-y-1.5">
        <Label className="text-[10px] text-muted-foreground">Approved template</Label>
        <Select
          value={templateName}
          onValueChange={(v) => {
            setTemplateName(v);
            const tpl = (watiTemplates as any[]).find((t) => t.name === v);
            setParamMapping(
              defaultWatiTemplateParamMapping(extractWatiTemplateParamSlots(tpl), tpl),
            );
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Choose a template…" />
          </SelectTrigger>
          <SelectContent>
            {approved.map((t) => (
              <SelectItem key={t.id ?? t.name} value={t.name}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {paramSlots.map((slot) => {
        const mapped = paramMapping[slot] ?? "";
        const isFixed = isLiteralTemplateField(mapped);
        const selectValue = isFixed ? "__fixed__" : mapped;
        return (
          <div key={slot} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[10px] text-muted-foreground">{`{{${slot}}}`}</span>
              <Select
                value={selectValue || undefined}
                onValueChange={(v) =>
                  setParamMapping({
                    ...paramMapping,
                    [slot]: v === "__fixed__" ? encodeLiteralTemplateField("") : v,
                  })
                }
              >
                <SelectTrigger className="h-7 flex-1 text-xs">
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
                className="ml-10 h-7 text-xs"
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

      <Button
        size="sm"
        className="h-8 w-full gap-1.5 text-xs"
        disabled={!templateName || send.isPending}
        onClick={() => send.mutate()}
      >
        {send.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        Send template to reopen
      </Button>
    </div>
  );
}
