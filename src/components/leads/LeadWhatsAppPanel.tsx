import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listLeadWhatsappMessages, sendLeadWhatsappTemplate } from "@/lib/dashboard/whatsapp.functions";
import { getWatiConnection, listWatiTemplates } from "@/lib/whatsapp/wati.functions";
import { checkWebuyanyhouseWorkspace } from "@/lib/integrations/webespokeEnterprise/wbah.functions";
import { toast } from "sonner";

const LEAD_PARAM_FIELDS: Array<{ value: string; label: string }> = [
  { value: "full_name", label: "Full Name" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "company_name", label: "Company" },
  { value: "call_summary", label: "Call Summary" },
  { value: "next_action", label: "Next Action" },
  { value: "source", label: "Source" },
  { value: "notes", label: "Notes" },
];

function watiTemplateParamSlots(components: unknown): string[] {
  const comps = Array.isArray(components) ? components : [];
  const slots = new Set<string>();
  for (const c of comps) {
    const text = (c as { text?: string; body?: string })?.text ?? (c as { body?: string })?.body ?? "";
    const matches = String(text).match(/\{\{(\d+)\}\}/g) ?? [];
    for (const m of matches) slots.add(m.replace(/\{\{|\}\}/g, ""));
  }
  return [...slots].sort((a, b) => Number(a) - Number(b));
}

export interface LeadWhatsAppPanelProps {
  leadId: string;
  phone?: string | null;
}

export function LeadWhatsAppPanel({ leadId, phone }: LeadWhatsAppPanelProps) {
  const qc = useQueryClient();
  const listFn = useServerFn(listLeadWhatsappMessages);
  const sendFn = useServerFn(sendLeadWhatsappTemplate);
  const watiConnFn = useServerFn(getWatiConnection);
  const watiTmplFn = useServerFn(listWatiTemplates);
  const wbahCheckFn = useServerFn(checkWebuyanyhouseWorkspace);

  const [templateName, setTemplateName] = useState("");
  const [paramMapping, setParamMapping] = useState<Record<string, string>>({});

  const { data: wbahCheck } = useQuery({
    queryKey: ["active-workspace-wbah"],
    queryFn: () => wbahCheckFn(),
    throwOnError: false,
  });
  const isWbahWorkspace = !!wbahCheck?.isWebuyanyhouse;

  const { data: watiConn } = useQuery({
    queryKey: ["wati-connection"],
    queryFn: () => watiConnFn(),
    throwOnError: false,
  });
  const watiConnected = !!watiConn && watiConn.status === "connected";

  const { data: watiTemplates = [] } = useQuery({
    queryKey: ["wati-templates"],
    queryFn: () => watiTmplFn(),
    enabled: watiConnected,
    throwOnError: false,
  });

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["lead-wa-messages", leadId],
    queryFn: () => listFn({ data: { leadId } }),
    enabled: !!leadId && watiConnected && !isWbahWorkspace,
    throwOnError: false,
  });

  const selectedTemplate = (watiTemplates as any[]).find((t) => t.name === templateName);
  const paramSlots = selectedTemplate ? watiTemplateParamSlots(selectedTemplate.components) : [];

  const send = useMutation({
    mutationFn: () =>
      sendFn({
        data: {
          leadId,
          templateName,
          templateParams: paramMapping,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-wa-messages", leadId] });
      toast.success("WhatsApp template sent");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!phone?.trim()) {
    return (
      <p className="text-[11px] text-muted-foreground/60 py-2 text-center">
        Add a phone number to this lead to use WhatsApp.
      </p>
    );
  }

  if (isWbahWorkspace) {
    return null;
  }

  if (!watiConnected) {
    return (
      <p className="text-[11px] text-muted-foreground/60 py-2 text-center">
        Connect WATI in Buzzchat → Settings to send WhatsApp messages.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-3.5 w-3.5 text-green-500" />
        <Label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          WhatsApp
        </Label>
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] max-h-48 overflow-y-auto divide-y divide-white/[0.04]">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (messages as any[]).length === 0 ? (
          <p className="text-[11px] text-muted-foreground/60 py-4 text-center">No messages yet.</p>
        ) : (
          (messages as any[]).map((m) => (
            <div
              key={m.id}
              className={`px-3 py-2 ${m.direction === "outbound" ? "bg-primary/5" : ""}`}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-[10px] font-medium capitalize text-muted-foreground">
                  {m.direction === "outbound" ? "Sent" : "Received"}
                </span>
                <RelativeTime date={m.sent_at} className="text-[10px] text-muted-foreground" />
              </div>
              <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">{m.body}</p>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <Label className="text-[10px] text-muted-foreground">Send template</Label>
        <Select
          value={templateName}
          onValueChange={(v) => {
            setTemplateName(v);
            setParamMapping({});
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Choose WATI template…" />
          </SelectTrigger>
          <SelectContent>
            {(watiTemplates as any[])
              .filter((t) => !t.status || String(t.status).toLowerCase() === "approved")
              .map((t) => (
                <SelectItem key={t.id} value={t.name}>
                  {t.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        {paramSlots.map((slot) => (
          <div key={slot} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-8 shrink-0">{`{{${slot}}}`}</span>
            <Select
              value={paramMapping[slot] ?? ""}
              onValueChange={(v) => setParamMapping({ ...paramMapping, [slot]: v })}
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue placeholder="Map to lead field…" />
              </SelectTrigger>
              <SelectContent>
                {LEAD_PARAM_FIELDS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}

        <Button
          size="sm"
          className="h-7 text-xs gap-1 w-full"
          disabled={!templateName || send.isPending}
          onClick={() => send.mutate()}
        >
          {send.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
          Send Template
        </Button>
      </div>
    </div>
  );
}
