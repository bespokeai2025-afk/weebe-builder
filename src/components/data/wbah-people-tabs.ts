/** Data page — WBAH People category tabs: styles, defaults and row filtering. */
import type { WbahPeopleRow } from "./wbah-people-row";
import { isWbahLeadDisqualified } from "@/lib/integrations/webespokeEnterprise/wbah-crm-data.types";
import { NEW_LEAD_STATUS } from "@/lib/integrations/webespokeEnterprise/wbah-campaign-sync.types";
import { wbahStatusKey } from "./data-format";

// ── Per-category colour coding for the People sub-tabs ─────────────────────────
export type WbahCatStyle = { active: string; badge: string; icon: string; banner: string };

export function wbahCatStyleKey(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const WBAH_CAT_STYLES: Record<string, WbahCatStyle> = {
  disqualified: {
    active: "border-rose-400 text-rose-300",
    badge: "bg-rose-500/20 text-rose-400",
    icon: "text-rose-400",
    banner: "bg-rose-500/5 border-rose-500/10 text-rose-400",
  },
  tried_to_contact: {
    active: "border-amber-400 text-amber-300",
    badge: "bg-amber-500/20 text-amber-400",
    icon: "text-amber-400",
    banner: "bg-amber-500/5 border-amber-500/10 text-amber-400",
  },
  rebook_initial_consultation: {
    active: "border-violet-400 text-violet-300",
    badge: "bg-violet-500/20 text-violet-400",
    icon: "text-violet-400",
    banner: "bg-violet-500/5 border-violet-500/10 text-violet-400",
  },
  new: {
    active: "border-emerald-400 text-emerald-300",
    badge: "bg-emerald-500/20 text-emerald-400",
    icon: "text-emerald-400",
    banner: "bg-emerald-500/5 border-emerald-500/10 text-emerald-400",
  },
  rebooking: {
    active: "border-violet-400 text-violet-300",
    badge: "bg-violet-500/20 text-violet-400",
    icon: "text-violet-400",
    banner: "bg-violet-500/5 border-violet-500/10 text-violet-400",
  },
  callback_request: {
    active: "border-sky-400 text-sky-300",
    badge: "bg-sky-500/20 text-sky-400",
    icon: "text-sky-400",
    banner: "bg-sky-500/5 border-sky-500/10 text-sky-400",
  },
  call_back_request: {
    active: "border-sky-400 text-sky-300",
    badge: "bg-sky-500/20 text-sky-400",
    icon: "text-sky-400",
    banner: "bg-sky-500/5 border-sky-500/10 text-sky-400",
  },
  frontline_pre_qualified: {
    active: "border-emerald-400 text-emerald-300",
    badge: "bg-emerald-500/20 text-emerald-400",
    icon: "text-emerald-400",
    banner: "bg-emerald-500/5 border-emerald-500/10 text-emerald-400",
  },
  logged: {
    active: "border-slate-400 text-slate-300",
    badge: "bg-slate-500/20 text-slate-300",
    icon: "text-slate-400",
    banner: "bg-slate-500/5 border-slate-500/10 text-slate-300",
  },
  testlead: {
    active: "border-amber-400 text-amber-300",
    badge: "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30",
    icon: "text-amber-400",
    banner: "bg-amber-500/5 border-amber-500/10 text-amber-400",
  },
  test_lead: {
    active: "border-amber-400 text-amber-300",
    badge: "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30",
    icon: "text-amber-400",
    banner: "bg-amber-500/5 border-amber-500/10 text-amber-400",
  },
};

// Fixed People tabs — cohorts synced into UAT CRM_data by the backend.
export const WBAH_PEOPLE_TABS: { name: string; count: number }[] = [
  { name: "Disqualified", count: 0 },
  { name: "Tried To Contact", count: 0 },
  { name: "Rebook Initial Consultation", count: 0 },
  { name: NEW_LEAD_STATUS, count: 0 },
  { name: "Test Lead", count: 0 },
  { name: "Callback Request", count: 0 },
];

export const WBAH_CALLBACK_TAB = "Callback Request";

export const WBAH_CAT_FALLBACK_STYLES: WbahCatStyle[] = [
  {
    active: "border-blue-400 text-blue-300",
    badge: "bg-blue-500/20 text-blue-400",
    icon: "text-blue-400",
    banner: "bg-blue-500/5 border-blue-500/10 text-blue-400",
  },
  {
    active: "border-teal-400 text-teal-300",
    badge: "bg-teal-500/20 text-teal-400",
    icon: "text-teal-400",
    banner: "bg-teal-500/5 border-teal-500/10 text-teal-400",
  },
  {
    active: "border-fuchsia-400 text-fuchsia-300",
    badge: "bg-fuchsia-500/20 text-fuchsia-400",
    icon: "text-fuchsia-400",
    banner: "bg-fuchsia-500/5 border-fuchsia-500/10 text-fuchsia-400",
  },
  {
    active: "border-orange-400 text-orange-300",
    badge: "bg-orange-500/20 text-orange-400",
    icon: "text-orange-400",
    banner: "bg-orange-500/5 border-orange-500/10 text-orange-400",
  },
  {
    active: "border-cyan-400 text-cyan-300",
    badge: "bg-cyan-500/20 text-cyan-400",
    icon: "text-cyan-400",
    banner: "bg-cyan-500/5 border-cyan-500/10 text-cyan-400",
  },
];

export function wbahCatStyle(name: string): WbahCatStyle {
  const key = wbahCatStyleKey(name);
  if (WBAH_CAT_STYLES[key]) return WBAH_CAT_STYLES[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return WBAH_CAT_FALLBACK_STYLES[h % WBAH_CAT_FALLBACK_STYLES.length];
}

export function wbahRowPasses(
  r: WbahPeopleRow,
  search: string,
  statusF: string,
  sentimentF: string,
  dateCutoff: number,
  agentF: string,
): boolean {
  if (search) {
    const q = search.toLowerCase();
    if (!(r.name ?? "").toLowerCase().includes(q) && !String(r.contact ?? "").includes(q))
      return false;
  }
  if (statusF !== "all") {
    if (statusF === "need_to_call") {
      const callable = r.isCallable === true || r.needToCall === true;
      const callNeed = wbahStatusKey(r.callStatus) === "need_to_call";
      if (!callable && !callNeed) return false;
    } else if (statusF === "disqualified") {
      const crmDq =
        isWbahLeadDisqualified(r._crm) || (r.leadStatus ?? "").toLowerCase() === "disqualified";
      const callDq = wbahStatusKey(r.callStatus) === "disqualified";
      if (!crmDq && !callDq) return false;
    } else if (wbahStatusKey(r.callStatus) !== statusF) {
      return false;
    }
  }
  if (sentimentF !== "all" && !(r.sentimentAnalysis ?? "").toLowerCase().includes(sentimentF))
    return false;
  if (dateCutoff > 0) {
    // CRM-loaded category rows that have not been called yet carry no
    // startTimestamp, so fall back to their CRM load date for date filtering.
    const ts = r.startTimestamp
      ? Number(r.startTimestamp)
      : r.loadedAt
        ? Date.parse(r.loadedAt)
        : 0;
    if (!ts || ts < dateCutoff) return false;
  }
  if (agentF !== "all" && String(r.agentName ?? r.agent_name ?? "").trim() !== agentF) return false;
  return true;
}
