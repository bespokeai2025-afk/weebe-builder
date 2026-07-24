import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dna, Save, RefreshCw, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, Sparkles, History, Check, X } from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { BusinessDnaKnowledgeUpload } from "@/components/hivemind/BusinessDnaKnowledgeUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  getBusinessDna, upsertBusinessDna, generateInitialDna,
  getBusinessDnaVersions, getDnaProposals, resolveDnaProposal,
  computeDnaCompletionScore, type BusinessDna,
} from "@/lib/growthmind/growthmind.business-dna";
import { runOpportunityEngine } from "@/lib/growthmind/opportunity-engine.server";
import { runTrendingValueEngine } from "@/lib/growthmind/trending-value-engine.server";

export const Route = createFileRoute("/_authenticated/growthmind/business-dna")({
  head: () => ({ meta: [{ title: "Business DNA — GrowthMind" }] }),
  component: BusinessDnaPage,
});

type SectionState = Record<string, boolean>;

function Section({ title, description, children, id, open, onToggle }: {
  title: string; description: string; children: React.ReactNode;
  id: string; open: boolean; onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors text-left"
      >
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {open && <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-white/[0.04] pt-4">{children}</div>}
    </div>
  );
}

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1.5", wide && "md:col-span-2")}>
      <Label className="text-xs font-medium text-foreground">{label}</Label>
      {hint && <p className="text-[11px] text-muted-foreground -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

function BusinessDnaPage() {
  const getDnaFn      = useServerFn(getBusinessDna);
  const upsertDnaFn   = useServerFn(upsertBusinessDna);
  const runOppFn      = useServerFn(runOpportunityEngine);
  const runValueFn    = useServerFn(runTrendingValueEngine);
  const generateFn    = useServerFn(generateInitialDna);
  const getVersionsFn = useServerFn(getBusinessDnaVersions);
  const getProposalsFn = useServerFn(getDnaProposals);
  const resolveProposalFn = useServerFn(resolveDnaProposal);
  const qc            = useQueryClient();

  const [saving,      setSaving]      = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [generating,  setGenerating]  = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [mounted,     setMounted]     = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [sections,    setSections]    = useState<SectionState>({
    company: true, products: true, customers: false,
    financials: false, strategy: false, brand: false,
    messaging: false, guardrails: false, contentPrefs: false,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["growthmind-business-dna"],
    queryFn:  () => getDnaFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const dna        = data?.dna;
  const completion = data?.completion ?? computeDnaCompletionScore({});

  const { data: proposalsData } = useQuery({
    queryKey: ["growthmind-dna-proposals"],
    queryFn:  () => getProposalsFn(),
    staleTime: 60_000,
    throwOnError: false,
  });
  const proposals = proposalsData?.proposals ?? [];

  const { data: versionsData } = useQuery({
    queryKey: ["growthmind-dna-versions"],
    queryFn:  () => getVersionsFn(),
    staleTime: 60_000,
    throwOnError: false,
    enabled: showHistory,
  });
  const versions = versionsData?.versions ?? [];

  const [form, setForm] = useState<Partial<BusinessDna>>({});

  // Initialise form from loaded data
  const merged: Partial<BusinessDna> = dna ? { ...dna, ...form } : form;

  function set(key: keyof BusinessDna, value: string | number | null) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function toggleSection(id: string) {
    setSections(prev => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await upsertDnaFn({ data: {
        companyName:            String(merged.companyName            ?? ""),
        website:                String(merged.website                ?? ""),
        industry:               String(merged.industry               ?? ""),
        products:               String(merged.products               ?? ""),
        services:               String(merged.services               ?? ""),
        pricing:                String(merged.pricing                ?? ""),
        offers:                 String(merged.offers                 ?? ""),
        locations:              String(merged.locations              ?? ""),
        idealCustomerProfiles:  String(merged.idealCustomerProfiles  ?? ""),
        targetMarkets:          String(merged.targetMarkets          ?? ""),
        uniqueSellingPoints:    String(merged.uniqueSellingPoints    ?? ""),
        competitorsSummary:     String(merged.competitorsSummary     ?? ""),
        revenueGoals:           String(merged.revenueGoals           ?? ""),
        monthlyMarketingBudget: merged.monthlyMarketingBudget != null ? Number(merged.monthlyMarketingBudget) : null,
        mainGrowthObjective:    String(merged.mainGrowthObjective    ?? ""),
        salesProcess:           String(merged.salesProcess           ?? ""),
        averageDealValue:       merged.averageDealValue != null ? Number(merged.averageDealValue) : null,
        profitMarginPct:        merged.profitMarginPct  != null ? Number(merged.profitMarginPct)  : null,
        bestCustomers:          String(merged.bestCustomers          ?? ""),
        worstCustomers:         String(merged.worstCustomers         ?? ""),
        caseStudies:            String(merged.caseStudies            ?? ""),
        brandVoice:             String(merged.brandVoice             ?? ""),
        complianceNotes:        String(merged.complianceNotes        ?? ""),
        customerPainPoints:     String(merged.customerPainPoints     ?? ""),
        commonObjections:       String(merged.commonObjections       ?? ""),
        buyingTriggers:         String(merged.buyingTriggers         ?? ""),
        approvedClaims:         String(merged.approvedClaims         ?? ""),
        restrictedClaims:       String(merged.restrictedClaims       ?? ""),
        restrictedTopics:       String(merged.restrictedTopics       ?? ""),
        preferredCtas:          String(merged.preferredCtas          ?? ""),
        contentStyles:          String(merged.contentStyles          ?? ""),
        priorityTopics:         String(merged.priorityTopics         ?? ""),
        avoidTopics:            String(merged.avoidTopics            ?? ""),
        proofPoints:            String(merged.proofPoints            ?? ""),
        brandAssets:            (merged.brandAssets ?? {}) as Record<string, unknown>,
        approvedVoices:         String(merged.approvedVoices         ?? ""),
        contentObjectives:      String(merged.contentObjectives      ?? ""),
        commercialObjectives:   String(merged.commercialObjectives   ?? ""),
      }});
      await qc.invalidateQueries({ queryKey: ["growthmind-dna-versions"] });
      await qc.invalidateQueries({ queryKey: ["growthmind-business-dna"] });
      setForm({});
      toast.success("Business DNA saved");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await generateFn();
      const suggestions = res?.suggestions ?? {};
      const keys = Object.keys(suggestions);
      if (keys.length === 0) {
        toast.info("Not enough workspace data to draft suggestions yet.");
      } else {
        // Prefill ONLY empty fields — never overwrite existing values.
        setForm(prev => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(suggestions)) {
            const currentVal = (prev as any)[k] ?? (dna as any)?.[k];
            const isEmpty = currentVal == null || String(currentVal).trim() === "";
            if (isEmpty) (next as any)[k] = v;
          }
          return next;
        });
        toast.success(`GrowthMind drafted ${keys.length} field${keys.length === 1 ? "" : "s"} — review and save to apply`);
      }
    } catch (err: any) {
      toast.error(err.message ?? "Draft generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleResolveProposal(proposalId: string, decision: "approve" | "reject") {
    setResolvingId(proposalId);
    try {
      await resolveProposalFn({ data: { proposalId, decision } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["growthmind-dna-proposals"] }),
        qc.invalidateQueries({ queryKey: ["growthmind-business-dna"] }),
        qc.invalidateQueries({ queryKey: ["growthmind-dna-versions"] }),
      ]);
      toast.success(decision === "approve" ? "Proposal applied to Business DNA" : "Proposal rejected");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to resolve proposal");
    } finally {
      setResolvingId(null);
    }
  }

  async function handleRefreshAll() {
    setRefreshing(true);
    try {
      await Promise.all([runOppFn(), runValueFn()]);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["growthmind-opportunities"] }),
        qc.invalidateQueries({ queryKey: ["growthmind-value-point"] }),
      ]);
      toast.success("All GrowthMind analysis refreshed");
    } catch (err: any) {
      toast.error(err.message ?? "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const pct   = completion.pct;
  const grade = completion.grade;
  const barColor = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
  const textColor = pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-red-400";

  if (isLoading) return (
    <GrowthMindShell>
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    </GrowthMindShell>
  );

  return (
    <GrowthMindShell>
      <form onSubmit={handleSave} className="px-6 py-5 max-w-3xl space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/25">
              <Dna className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold">Business DNA</h1>
              <p className="text-xs text-muted-foreground">Context used by every GrowthMind engine and strategy</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button" variant="ghost" size="sm"
              onClick={handleGenerate} disabled={generating}
              className="text-xs gap-1.5"
              title="Draft empty fields from your existing WEBEE data — you review and save"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Auto-Draft from Data
            </Button>
            <Button
              type="button" variant="ghost" size="sm"
              onClick={handleRefreshAll} disabled={refreshing}
              className="text-xs gap-1.5"
            >
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh All Analysis
            </Button>
            <Button type="submit" size="sm" disabled={saving} className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-xs">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save DNA
            </Button>
          </div>
        </div>

        {/* Completion score */}
        <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {pct >= 80
                ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                : <AlertCircle className="h-4 w-4 text-amber-400" />}
              <span className="text-sm font-medium">DNA Completion</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn("text-xl font-bold tabular-nums", textColor)}>{pct}%</span>
              <span className={cn("text-sm font-semibold px-2 py-0.5 rounded-full text-xs", barColor.replace("bg-", "bg-") + "/20", textColor)}>
                Grade {grade}
              </span>
            </div>
          </div>
          <div className="h-1.5 w-full bg-white/[0.06] rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all duration-500", barColor)} style={{ width: `${pct}%` }} />
          </div>
          {completion.missing.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-2">
              Missing: {completion.missing.slice(0, 4).join(", ")}{completion.missing.length > 4 ? ` +${completion.missing.length - 4} more` : ""}
            </p>
          )}
        </div>

        {/* GrowthMind-proposed DNA updates — explicit approval, never silent */}
        {proposals.length > 0 && (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-400" />
              <p className="text-sm font-semibold">GrowthMind suggests {proposals.length} DNA update{proposals.length === 1 ? "" : "s"}</p>
            </div>
            {proposals.map((p: any) => (
              <div key={p.id} className="rounded-lg border border-white/[0.06] bg-card/60 p-3 space-y-2">
                {p.rationale && <p className="text-xs text-muted-foreground">{p.rationale}</p>}
                <div className="space-y-1">
                  {Object.entries((p.field_changes ?? {}) as Record<string, any>).slice(0, 6).map(([field, ch]) => (
                    <p key={field} className="text-[11px]">
                      <span className="font-medium text-foreground">{field.replace(/_/g, " ")}:</span>{" "}
                      <span className="text-muted-foreground line-through">{String(ch?.current ?? "—").slice(0, 60)}</span>{" "}
                      <span className="text-emerald-400">→ {String(ch?.proposed ?? "").slice(0, 120)}</span>
                    </p>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" disabled={resolvingId === p.id}
                    onClick={() => handleResolveProposal(p.id, "approve")}
                    className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-500">
                    {resolvingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Approve
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={resolvingId === p.id}
                    onClick={() => handleResolveProposal(p.id, "reject")}
                    className="h-7 text-xs gap-1">
                    <X className="h-3 w-3" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Knowledge base document upload — feeds discovery + GrowthMind */}
        <BusinessDnaKnowledgeUpload accent="emerald" />

        {/* Section: Company */}
        <Section id="company" title="Company Information" description="Core identity — used in every strategy and content piece"
          open={sections.company} onToggle={() => toggleSection("company")}>
          <Field label="Company Name" wide>
            <Input value={String(merged.companyName ?? "")} onChange={e => set("companyName", e.target.value)}
              placeholder="e.g. WeeBee AI" className="bg-background/50 text-sm h-9" />
          </Field>
          <Field label="Website">
            <Input value={String(merged.website ?? "")} onChange={e => set("website", e.target.value)}
              placeholder="https://..." className="bg-background/50 text-sm h-9" />
          </Field>
          <Field label="Industry">
            <Input value={String(merged.industry ?? "")} onChange={e => set("industry", e.target.value)}
              placeholder="e.g. AI SaaS, Real Estate, Healthcare" className="bg-background/50 text-sm h-9" />
          </Field>
          <Field label="Locations" hint="Offices, target geographies">
            <Input value={String(merged.locations ?? "")} onChange={e => set("locations", e.target.value)}
              placeholder="e.g. Dubai, London, UK" className="bg-background/50 text-sm h-9" />
          </Field>
          <Field label="Main Growth Objective" wide hint="What is the #1 thing you're trying to achieve right now?">
            <Textarea value={String(merged.mainGrowthObjective ?? "")} onChange={e => set("mainGrowthObjective", e.target.value)}
              placeholder="e.g. Acquire 50 new agency clients in the UAE in the next 90 days"
              className="bg-background/50 text-sm resize-none" rows={2} />
          </Field>
        </Section>

        {/* Section: Products & Services */}
        <Section id="products" title="Products & Services" description="What you sell, how you price it, and your current offers"
          open={sections.products} onToggle={() => toggleSection("products")}>
          <Field label="Products" hint="Specific products you sell" wide>
            <Textarea value={String(merged.products ?? "")} onChange={e => set("products", e.target.value)}
              placeholder="List your main products..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Services" hint="Services you deliver" wide>
            <Textarea value={String(merged.services ?? "")} onChange={e => set("services", e.target.value)}
              placeholder="List your services..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Pricing" hint="Pricing model, tiers, or ranges">
            <Textarea value={String(merged.pricing ?? "")} onChange={e => set("pricing", e.target.value)}
              placeholder="e.g. £499/month starter, £999/month growth" className="bg-background/50 text-sm resize-none" rows={2} />
          </Field>
          <Field label="Current Offers / Lead Magnets" hint="Active promotions or entry offers">
            <Textarea value={String(merged.offers ?? "")} onChange={e => set("offers", e.target.value)}
              placeholder="e.g. Free 14-day trial, Free AI audit call" className="bg-background/50 text-sm resize-none" rows={2} />
          </Field>
          <Field label="Unique Selling Points" wide hint="What makes you genuinely different?">
            <Textarea value={String(merged.uniqueSellingPoints ?? "")} onChange={e => set("uniqueSellingPoints", e.target.value)}
              placeholder="e.g. Only platform combining AI voice + WhatsApp + email..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
        </Section>

        {/* Section: Customers */}
        <Section id="customers" title="Customers & Markets" description="Who you serve, who you want, and who to avoid"
          open={sections.customers} onToggle={() => toggleSection("customers")}>
          <Field label="Ideal Customer Profiles" wide hint="Describe your best-fit customer in detail">
            <Textarea value={String(merged.idealCustomerProfiles ?? "")} onChange={e => set("idealCustomerProfiles", e.target.value)}
              placeholder="e.g. SME owners with 2-20 staff, B2B service businesses, UK & UAE..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Target Markets">
            <Textarea value={String(merged.targetMarkets ?? "")} onChange={e => set("targetMarkets", e.target.value)}
              placeholder="e.g. Estate agents, mortgage brokers, clinics" className="bg-background/50 text-sm resize-none" rows={2} />
          </Field>
          <Field label="Competitors Overview">
            <Textarea value={String(merged.competitorsSummary ?? "")} onChange={e => set("competitorsSummary", e.target.value)}
              placeholder="e.g. Competitor A does X, we do Y better because..." className="bg-background/50 text-sm resize-none" rows={2} />
          </Field>
          <Field label="Best Customers" hint="Traits of your highest-value clients">
            <Textarea value={String(merged.bestCustomers ?? "")} onChange={e => set("bestCustomers", e.target.value)}
              placeholder="e.g. Marketing agencies with 5+ clients who need AI automation..." className="bg-background/50 text-sm resize-none" rows={2} />
          </Field>
          <Field label="Worst Customers / Who to Avoid" hint="Helps AI filter targeting">
            <Textarea value={String(merged.worstCustomers ?? "")} onChange={e => set("worstCustomers", e.target.value)}
              placeholder="e.g. Solo freelancers, price-only buyers, one-off projects..." className="bg-background/50 text-sm resize-none" rows={2} />
          </Field>
          <Field label="Case Studies" wide hint="Wins you can reference in campaigns">
            <Textarea value={String(merged.caseStudies ?? "")} onChange={e => set("caseStudies", e.target.value)}
              placeholder="e.g. Estate agent client booked 40% more viewings in 30 days using AI..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
        </Section>

        {/* Section: Financials */}
        <Section id="financials" title="Revenue & Financials" description="Used in forecasts, campaign ROI, and strategy priorities"
          open={sections.financials} onToggle={() => toggleSection("financials")}>
          <Field label="Revenue Goals" wide>
            <Textarea value={String(merged.revenueGoals ?? "")} onChange={e => set("revenueGoals", e.target.value)}
              placeholder="e.g. £500k ARR by end of 2025, 100 paying clients by Q3..." className="bg-background/50 text-sm resize-none" rows={2} />
          </Field>
          <Field label="Monthly Marketing Budget (£)">
            <Input type="number" min={0}
              value={merged.monthlyMarketingBudget ?? ""} onChange={e => set("monthlyMarketingBudget", e.target.value ? Number(e.target.value) : null)}
              placeholder="e.g. 2000" className="bg-background/50 text-sm h-9" />
          </Field>
          <Field label="Average Deal Value (£)">
            <Input type="number" min={0}
              value={merged.averageDealValue ?? ""} onChange={e => set("averageDealValue", e.target.value ? Number(e.target.value) : null)}
              placeholder="e.g. 5000" className="bg-background/50 text-sm h-9" />
          </Field>
          <Field label="Profit Margin (%)">
            <Input type="number" min={0} max={100}
              value={merged.profitMarginPct ?? ""} onChange={e => set("profitMarginPct", e.target.value ? Number(e.target.value) : null)}
              placeholder="e.g. 65" className="bg-background/50 text-sm h-9" />
          </Field>
        </Section>

        {/* Section: Strategy */}
        <Section id="strategy" title="Sales & Growth Strategy" description="How you sell and what you're optimising for"
          open={sections.strategy} onToggle={() => toggleSection("strategy")}>
          <Field label="Sales Process" wide hint="How a lead becomes a client">
            <Textarea value={String(merged.salesProcess ?? "")} onChange={e => set("salesProcess", e.target.value)}
              placeholder="e.g. Lead → AI call → demo → proposal → close in 7 days..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
        </Section>

        {/* Section: Brand */}
        <Section id="brand" title="Brand & Compliance" description="Voice, tone, and constraints for all AI-generated content"
          open={sections.brand} onToggle={() => toggleSection("brand")}>
          <Field label="Brand Voice" wide hint="How you want to sound in content and campaigns">
            <Textarea value={String(merged.brandVoice ?? "")} onChange={e => set("brandVoice", e.target.value)}
              placeholder="e.g. Professional but approachable. Never pushy. Data-driven..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Compliance Notes" wide hint="Anything AI must never say, legal constraints, regulated industries">
            <Textarea value={String(merged.complianceNotes ?? "")} onChange={e => set("complianceNotes", e.target.value)}
              placeholder="e.g. Do not make income claims. GDPR compliant messaging only..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
        </Section>

        {/* Section: Messaging & Objections */}
        <Section id="messaging" title="Messaging & Customer Psychology" description="Pain points, objections, triggers and evidence used in every content piece"
          open={sections.messaging} onToggle={() => toggleSection("messaging")}>
          <Field label="Customer Pain Points" wide hint="The real problems your customers describe, in their words">
            <Textarea value={String(merged.customerPainPoints ?? "")} onChange={e => set("customerPainPoints", e.target.value)}
              placeholder="e.g. Missing calls after hours, leads going cold before follow-up..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Common Objections" hint="What stops people buying">
            <Textarea value={String(merged.commonObjections ?? "")} onChange={e => set("commonObjections", e.target.value)}
              placeholder="e.g. 'AI sounds robotic', 'Too expensive', 'We already have a receptionist'..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Buying Triggers" hint="Events that make customers ready to buy">
            <Textarea value={String(merged.buyingTriggers ?? "")} onChange={e => set("buyingTriggers", e.target.value)}
              placeholder="e.g. Receptionist quit, missed a big lead, new office opening..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Proof Points & Evidence" wide hint="Numbers, results and evidence content can reference">
            <Textarea value={String(merged.proofPoints ?? "")} onChange={e => set("proofPoints", e.target.value)}
              placeholder="e.g. 40% more viewings booked in 30 days for estate agent client..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
        </Section>

        {/* Section: Claims & Guardrails */}
        <Section id="guardrails" title="Claims & Guardrails" description="What GrowthMind may and may not say — enforced across all generated content"
          open={sections.guardrails} onToggle={() => toggleSection("guardrails")}>
          <Field label="Approved Claims" wide hint="Statements that are verified and safe to use">
            <Textarea value={String(merged.approvedClaims ?? "")} onChange={e => set("approvedClaims", e.target.value)}
              placeholder="e.g. 'Answers 100% of calls 24/7', 'Set up in under a week'..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Restricted Claims" hint="Claims that must never appear in content">
            <Textarea value={String(merged.restrictedClaims ?? "")} onChange={e => set("restrictedClaims", e.target.value)}
              placeholder="e.g. Income guarantees, medical outcomes, 'best in the world'..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Restricted Topics" hint="Topics content must never cover">
            <Textarea value={String(merged.restrictedTopics ?? "")} onChange={e => set("restrictedTopics", e.target.value)}
              placeholder="e.g. Politics, religion, competitor bashing..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Approved Voices / Spokespeople" wide hint="Who may appear or be quoted in content (incl. AI spokespeople rules)">
            <Textarea value={String(merged.approvedVoices ?? "")} onChange={e => set("approvedVoices", e.target.value)}
              placeholder="e.g. Founder only for pricing topics; AI presenter allowed for educational content..." className="bg-background/50 text-sm resize-none" rows={2} />
          </Field>
        </Section>

        {/* Section: Content Preferences */}
        <Section id="contentPrefs" title="Content Preferences & Objectives" description="Styles, topics, CTAs and objectives that steer the content engine"
          open={sections.contentPrefs} onToggle={() => toggleSection("contentPrefs")}>
          <Field label="Content Styles" hint="Formats and tones that work for your brand">
            <Textarea value={String(merged.contentStyles ?? "")} onChange={e => set("contentStyles", e.target.value)}
              placeholder="e.g. Short talking-head reels, before/after demos, myth-busting posts..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Preferred Calls-to-Action" hint="How content should ask for the next step">
            <Textarea value={String(merged.preferredCtas ?? "")} onChange={e => set("preferredCtas", e.target.value)}
              placeholder="e.g. 'Book a free AI audit', 'Call Ava now', 'DM us START'..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Priority Topics" hint="Topics GrowthMind should prioritise">
            <Textarea value={String(merged.priorityTopics ?? "")} onChange={e => set("priorityTopics", e.target.value)}
              placeholder="e.g. Missed-call cost, AI receptionists, WhatsApp automation..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Topics to Avoid" hint="Low-value or off-brand topics">
            <Textarea value={String(merged.avoidTopics ?? "")} onChange={e => set("avoidTopics", e.target.value)}
              placeholder="e.g. Generic motivational content, AI doom debates..." className="bg-background/50 text-sm resize-none" rows={3} />
          </Field>
          <Field label="Content Objectives" hint="What content should achieve">
            <Textarea value={String(merged.contentObjectives ?? "")} onChange={e => set("contentObjectives", e.target.value)}
              placeholder="e.g. Build trust with SME owners, educate on AI reception, drive demo bookings..." className="bg-background/50 text-sm resize-none" rows={2} />
          </Field>
          <Field label="Commercial Objectives" hint="Business outcomes content supports">
            <Textarea value={String(merged.commercialObjectives ?? "")} onChange={e => set("commercialObjectives", e.target.value)}
              placeholder="e.g. 20 qualified demos per month, £30k new MRR per quarter..." className="bg-background/50 text-sm resize-none" rows={2} />
          </Field>
        </Section>

        {/* Version history */}
        <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
          <button type="button" onClick={() => setShowHistory(v => !v)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors text-left">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-semibold">Version History</p>
                <p className="text-xs text-muted-foreground mt-0.5">Every save is recorded — current version {dna?.dnaVersion ?? 1}</p>
              </div>
            </div>
            {showHistory ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
          </button>
          {showHistory && (
            <div className="px-5 pb-4 border-t border-white/[0.04] pt-3 space-y-1.5">
              {versions.length === 0 && <p className="text-xs text-muted-foreground">No versions recorded yet — save the DNA to create the first snapshot.</p>}
              {versions.map((v: any) => (
                <div key={v.id} className="flex items-center justify-between text-xs py-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium tabular-nums">v{v.version}</span>
                    <span className="text-muted-foreground">{v.changed_by === "growthmind" ? "GrowthMind (approved proposal)" : "Manual save"}</span>
                    {v.change_summary && <span className="text-muted-foreground truncate max-w-[280px]">— {v.change_summary}</span>}
                  </div>
                  <span className="text-muted-foreground tabular-nums">{mounted ? new Date(v.created_at).toLocaleString() : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer save */}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="gap-2 bg-emerald-600 hover:bg-emerald-500">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Business DNA
          </Button>
        </div>

      </form>
    </GrowthMindShell>
  );
}
