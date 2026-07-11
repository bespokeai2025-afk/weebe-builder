import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Mail, Send, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  sendComposedEmailToLead,
  sendTemplateEmailToLead,
  listLeadEmailLog,
} from "@/lib/lead-gen/lead-email.server";
import { listHexmailTemplates } from "@/lib/hexmail/templates.functions";

export interface LeadEmailDialogLead {
  id: string;
  full_name?: string | null;
  email?: string | null;
}

interface LeadEmailDialogProps {
  lead: LeadEmailDialogLead | null;
  onClose: () => void;
}

export function LeadEmailDialog({ lead, onClose }: LeadEmailDialogProps) {
  const qc = useQueryClient();
  const sendComposedFn = useServerFn(sendComposedEmailToLead);
  const sendTemplateFn = useServerFn(sendTemplateEmailToLead);
  const listTemplatesFn = useServerFn(listHexmailTemplates);
  const listLogFn = useServerFn(listLeadEmailLog);

  const [tab, setTab] = useState<"compose" | "template">("compose");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (lead) {
      setTab("compose");
      setSubject("");
      setBody("");
      setTemplateId("");
    }
  }, [lead?.id]);

  const templatesQ = useQuery({
    queryKey: ["hexmail-templates", "email"],
    queryFn: () => listTemplatesFn({ data: { type: "email" } }),
    enabled: !!lead,
    throwOnError: false,
  });

  const logQ = useQuery({
    queryKey: ["lead-email-log", lead?.id],
    queryFn: () => listLogFn({ data: { leadId: lead!.id } }),
    enabled: !!lead,
    throwOnError: false,
  });

  const templates = templatesQ.data ?? [];
  const selectedTemplate = templates.find((t: any) => t.id === templateId);

  async function handleSendComposed() {
    if (!lead) return;
    if (!subject.trim() || !body.trim()) {
      toast.error("Enter a subject and message body");
      return;
    }
    setSending(true);
    try {
      await sendComposedFn({ data: { leadId: lead.id, subject: subject.trim(), body: body.trim() } });
      toast.success(`Email sent to ${lead.email}`);
      setSubject("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["lead-email-log", lead.id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  async function handleSendTemplate() {
    if (!lead || !templateId) {
      toast.error("Choose a template first");
      return;
    }
    setSending(true);
    try {
      await sendTemplateFn({ data: { leadId: lead.id, templateId } });
      toast.success(`Template email sent to ${lead.email}`);
      setTemplateId("");
      qc.invalidateQueries({ queryKey: ["lead-email-log", lead.id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={!!lead} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email {lead?.full_name ?? "lead"}
          </DialogTitle>
          <DialogDescription>{lead?.email}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "compose" | "template")}>
          <TabsList className="w-full">
            <TabsTrigger value="compose" className="flex-1">Compose</TabsTrigger>
            <TabsTrigger value="template" className="flex-1">Send Template</TabsTrigger>
          </TabsList>

          <TabsContent value="compose" className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Message</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message…"
                className="min-h-[160px]"
              />
            </div>
            <DialogFooter>
              <Button onClick={handleSendComposed} disabled={sending} className="gap-2">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send Email
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="template" className="space-y-3 pt-3">
            {templatesQ.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
              </div>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No email templates yet. Create one in HexMail → Email Templates.
              </p>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">Template</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTemplate?.subject && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Subject: <span className="text-foreground">{selectedTemplate.subject}</span>
                  </p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button onClick={handleSendTemplate} disabled={sending || !templateId} className="gap-2">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send Template
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>

        {(logQ.data?.length ?? 0) > 0 && (
          <div className="border-t pt-3 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Recent emails</p>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {logQ.data!.map((row: any) => (
                <div key={row.id} className="flex items-center gap-2 text-xs">
                  {row.status === "sent" ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                  ) : (
                    <XCircle className="h-3 w-3 text-destructive shrink-0" />
                  )}
                  <span className="truncate flex-1 text-muted-foreground">{row.subject ?? "(no subject)"}</span>
                  <RelativeTime date={row.created_at} className="shrink-0 text-muted-foreground" />
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
