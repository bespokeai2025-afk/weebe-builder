import { useState, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  RefreshCw,
  ClipboardList,
  ChevronDown,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  DollarSign,
  Wrench,
} from "lucide-react";
import {
  adminListChangeRequestsFn,
  adminUpdateChangeRequestFn,
} from "@/lib/systemmind/custom-agent.functions";

export const Route = createFileRoute("/_authenticated/admin/change-requests")({
  component: AdminChangeRequestsPage,
});

interface ChangeRequest {
  id: string;
  workspace_id: string;
  request_type: string;
  title: string;
  missing_capability: string | null;
  technical_summary: string | null;
  estimated_effort: string | null;
  billable: boolean;
  billing_status: string;
  quote_amount_pence: number | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  workspaces?: { name: string };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; Icon: any }> = {
  open: { label: "Open", color: "bg-blue-500/10 text-blue-400 border-blue-500/20", Icon: AlertCircle },
  in_progress: { label: "In Progress", color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", Icon: Clock },
  resolved: { label: "Resolved", color: "bg-green-500/10 text-green-400 border-green-500/20", Icon: CheckCircle },
  declined: { label: "Declined", color: "bg-red-500/10 text-red-400 border-red-500/20", Icon: XCircle },
};

const BILLING_CONFIG: Record<string, { label: string; color: string }> = {
  pending_quote: { label: "Pending Quote", color: "bg-muted/60 text-muted-foreground" },
  quoted: { label: "Quoted", color: "bg-purple-500/10 text-purple-400" },
  approved: { label: "Approved", color: "bg-green-500/10 text-green-400" },
  declined: { label: "Declined", color: "bg-red-500/10 text-red-400" },
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  custom_extraction: "Custom Extraction",
  crm_field: "CRM Field",
  webhook_transformer: "Webhook Transform",
  custom_tool: "Custom Tool",
  unsupported_provider: "Provider",
  custom_builder_node: "Builder Node",
  custom_automation: "Automation",
};

function AdminChangeRequestsPage() {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [selected, setSelected] = useState<ChangeRequest | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editBilling, setEditBilling] = useState("");
  const [editQuote, setEditQuote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListChangeRequestsFn({ data: { status: filterStatus } });
      setRequests(res.requests);
    } catch (e: any) {
      toast.error("Failed to load change requests", { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  function openRow(r: ChangeRequest) {
    setSelected(r);
    setEditNotes(r.admin_notes ?? "");
    setEditStatus(r.status);
    setEditBilling(r.billing_status);
    setEditQuote(r.quote_amount_pence ? String(r.quote_amount_pence / 100) : "");
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      const quoteP = editQuote ? Math.round(parseFloat(editQuote) * 100) : undefined;
      await adminUpdateChangeRequestFn({
        data: {
          id: selected.id,
          status: editStatus,
          billingStatus: editBilling,
          quoteAmountPence: quoteP,
          adminNotes: editNotes,
        },
      });
      toast.success("Change request updated");
      setSelected(null);
      load();
    } catch (e: any) {
      toast.error("Update failed", { description: e.message });
    } finally {
      setSaving(false);
    }
  }

  const counts = {
    all: requests.length,
    open: requests.filter((r) => r.status === "open").length,
    in_progress: requests.filter((r) => r.status === "in_progress").length,
    resolved: requests.filter((r) => r.status === "resolved").length,
    declined: requests.filter((r) => r.status === "declined").length,
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold">Change Requests</h1>
              <p className="text-xs text-muted-foreground">
                Billable capability requests from custom agent configurations
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "open", "in_progress", "resolved", "declined"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                filterStatus === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {s === "all" ? "All" : s === "in_progress" ? "In Progress" : s.charAt(0).toUpperCase() + s.slice(1)}
              <span className="ml-1.5 opacity-60">{counts[s as keyof typeof counts]}</span>
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.01] overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              Loading…
            </div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <ClipboardList className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No change requests</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.06]">
                  <TableHead className="text-[10px] text-muted-foreground">Workspace</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">Title</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">Type</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">Status</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">Billing</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">Quote</TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => {
                  const sc = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.open;
                  const bc = BILLING_CONFIG[r.billing_status] ?? BILLING_CONFIG.pending_quote;
                  return (
                    <TableRow
                      key={r.id}
                      className="border-white/[0.04] cursor-pointer hover:bg-white/[0.02]"
                      onClick={() => openRow(r)}
                    >
                      <TableCell className="text-xs text-muted-foreground">
                        {r.workspaces?.name ?? r.workspace_id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-xs font-medium max-w-[200px] truncate">
                        {r.title}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] py-0">
                          {REQUEST_TYPE_LABELS[r.request_type] ?? r.request_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${sc.color}`}>
                          <sc.Icon className="h-2.5 w-2.5" />
                          {sc.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] ${bc.color}`}>
                          {bc.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.quote_amount_pence
                          ? `£${(r.quote_amount_pence / 100).toFixed(2)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Wrench className="h-4 w-4" />
              {selected?.title}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 text-xs">
              {/* Read-only info */}
              <div className="rounded-md bg-muted/20 p-3 space-y-1">
                <p className="text-muted-foreground">
                  <span className="text-foreground font-medium">Workspace:</span>{" "}
                  {selected.workspaces?.name ?? selected.workspace_id.slice(0, 12)}
                </p>
                {selected.missing_capability && (
                  <p className="text-muted-foreground">
                    <span className="text-foreground font-medium">Capability:</span>{" "}
                    {selected.missing_capability}
                  </p>
                )}
                {selected.technical_summary && (
                  <p className="text-muted-foreground">
                    <span className="text-foreground font-medium">Summary:</span>{" "}
                    {selected.technical_summary}
                  </p>
                )}
                {selected.estimated_effort && (
                  <p className="text-muted-foreground">
                    <span className="text-foreground font-medium">Effort:</span>{" "}
                    {selected.estimated_effort}
                  </p>
                )}
              </div>

              {/* Editable fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px]">Status</Label>
                  <Select value={editStatus} onValueChange={setEditStatus}>
                    <SelectTrigger className="h-7 text-[11px] mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="declined">Declined</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Billing Status</Label>
                  <Select value={editBilling} onValueChange={setEditBilling}>
                    <SelectTrigger className="h-7 text-[11px] mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending_quote">Pending Quote</SelectItem>
                      <SelectItem value="quoted">Quoted</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="declined">Declined</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-[10px]">Quote Amount (£)</Label>
                <div className="relative mt-1">
                  <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    className="h-7 text-[11px] pl-6"
                    placeholder="0.00"
                    value={editQuote}
                    onChange={(e) => setEditQuote(e.target.value)}
                    type="number"
                    step="0.01"
                    min="0"
                  />
                </div>
              </div>

              <div>
                <Label className="text-[10px]">Admin Notes</Label>
                <Textarea
                  className="mt-1 text-[11px] min-h-[70px] resize-none"
                  placeholder="Internal notes, implementation details…"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <Button variant="outline" size="sm" onClick={() => setSelected(null)} className="text-[11px] h-7">
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving} className="text-[11px] h-7">
                  {saving ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
