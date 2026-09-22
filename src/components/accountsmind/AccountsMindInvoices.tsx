import { useState } from "react";
import { Receipt, LayoutDashboard, FilePlus2, FileText, Package, Building2, Settings } from "lucide-react";
import { InvoicesDashboardTab } from "./invoices/InvoicesDashboardTab";
import { CreateInvoiceTab } from "./invoices/CreateInvoiceTab";
import { TemplatesTab } from "./invoices/TemplatesTab";
import { ServicesTab } from "./invoices/ServicesTab";
import { BusinessDetailsTab } from "./invoices/BusinessDetailsTab";
import { InvoiceSettingsTab } from "./invoices/InvoiceSettingsTab";

type TabKey = "dashboard" | "create" | "templates" | "services" | "business" | "settings";

const TABS: Array<{ key: TabKey; label: string; icon: any }> = [
  { key: "dashboard", label: "Invoices", icon: LayoutDashboard },
  { key: "create", label: "Create Invoice", icon: FilePlus2 },
  { key: "templates", label: "Templates", icon: FileText },
  { key: "services", label: "Services & Pricing", icon: Package },
  { key: "business", label: "Business Details", icon: Building2 },
  { key: "settings", label: "Settings", icon: Settings },
];

export function AccountsMindInvoices() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [editingId, setEditingId] = useState<string | null>(null);

  const openDraft = (id: string) => {
    setEditingId(id);
    setTab("create");
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground dark:text-white flex items-center gap-2">
          <Receipt className="w-5 h-5 text-emerald-400" /> Invoices
        </h1>
        <p className="text-sm text-muted-foreground dark:text-slate-400 mt-1">
          Create, issue and track invoices — with reusable services, bank details, drafts, payments and a full audit trail.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border dark:border-slate-800">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-lg border-b-2 -mb-px transition-colors ${
                active
                  ? "border-emerald-500 text-foreground bg-muted dark:text-white dark:bg-slate-900/60"
                  : "border-transparent text-muted-foreground hover:text-foreground dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "dashboard" && <InvoicesDashboardTab onEditDraft={openDraft} />}
      {tab === "create" && (
        <CreateInvoiceTab
          editingId={editingId}
          onSaved={() => setTab("dashboard")}
          onDoneEditing={() => setEditingId(null)}
        />
      )}
      {tab === "templates" && <TemplatesTab />}
      {tab === "services" && <ServicesTab />}
      {tab === "business" && <BusinessDetailsTab />}
      {tab === "settings" && <InvoiceSettingsTab />}
    </div>
  );
}
