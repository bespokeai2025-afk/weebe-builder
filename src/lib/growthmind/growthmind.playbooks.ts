import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Static playbook library ─────────────────────────────────────────────────

export type PlaybookSection = {
  channel: "Calling" | "Email" | "WhatsApp" | "Follow-up Sequences";
  tactics: string[];
};

export type Playbook = {
  id:          string;
  industry:    string;
  iconName:    string;
  description: string;
  sections:    PlaybookSection[];
};

export const PLAYBOOKS: Playbook[] = [
  {
    id: "real_estate",
    industry: "Real Estate",
    iconName: "Home",
    description: "Convert property enquiries into viewings and listings with multi-touch outreach.",
    sections: [
      {
        channel: "Calling",
        tactics: [
          "Call every new lead within 5 minutes of enquiry — speed wins in property.",
          "Use a 3-attempt calling cadence: call on day 1, 3, and 7.",
          "Ask open discovery questions: 'What's your ideal move-in timeline?'",
          "Book viewings directly on the call — never leave it open-ended.",
          "Confirm viewing appointments via a follow-up call 24 hours before.",
        ],
      },
      {
        channel: "Email",
        tactics: [
          "Send a personalised property match email within 1 hour of enquiry.",
          "Include 3 shortlisted properties based on their search criteria.",
          "Send a weekly 'new to market' digest to all active leads.",
          "Follow up post-viewing with a comparison guide of pros/cons.",
        ],
      },
      {
        channel: "WhatsApp",
        tactics: [
          "Send virtual tour video links via WhatsApp for initial engagement.",
          "Use WhatsApp to share price reduction alerts instantly.",
          "Send viewing confirmation and location pin via WhatsApp 1 hour before.",
          "Request feedback via WhatsApp message after each viewing.",
        ],
      },
      {
        channel: "Follow-up Sequences",
        tactics: [
          "Day 1: Property match email + call attempt.",
          "Day 3: WhatsApp with featured listing + call if no response.",
          "Day 7: Email with 'Are you still looking?' re-engagement.",
          "Day 14: Send market update report to rekindle interest.",
          "Day 30: 'Last chance' alert on properties they viewed.",
        ],
      },
    ],
  },
  {
    id: "mortgage",
    industry: "Mortgage",
    iconName: "Landmark",
    description: "Guide prospective borrowers from enquiry to application with trust-building outreach.",
    sections: [
      {
        channel: "Calling",
        tactics: [
          "Call within 10 minutes of an online mortgage enquiry — conversion rate is 3× higher.",
          "Open with affordability pre-qualification to save time for both parties.",
          "Explain the 3-step process: fact-find, recommendation, application.",
          "Offer a free mortgage health check to new cold leads.",
        ],
      },
      {
        channel: "Email",
        tactics: [
          "Send an educational '5 things to know before applying' email on day 1.",
          "Follow up with a personalised rate illustration after the fact-find.",
          "Send reminders for document submissions to prevent stalled applications.",
          "Share mortgage news and rate updates monthly to stay top of mind.",
        ],
      },
      {
        channel: "WhatsApp",
        tactics: [
          "Send document checklists via WhatsApp for easy reference.",
          "Notify clients instantly when their mortgage offer is issued.",
          "Use WhatsApp for quick query responses to reduce churn.",
        ],
      },
      {
        channel: "Follow-up Sequences",
        tactics: [
          "Day 1: Intro call + educational email.",
          "Day 3: Follow-up call if no document pack received.",
          "Day 7: 'Are you still interested?' re-engagement email.",
          "Day 21: Rate update email with a call to re-engage warm leads.",
          "Day 60: Remortgage opportunity check for existing clients.",
        ],
      },
    ],
  },
  {
    id: "recruitment",
    industry: "Recruitment",
    iconName: "Users",
    description: "Fill roles faster by qualifying candidates and engaging clients with structured outreach.",
    sections: [
      {
        channel: "Calling",
        tactics: [
          "Call every new candidate within 30 minutes of application.",
          "Use a 5-minute screening call to qualify before full briefing.",
          "Call hiring managers on Monday mornings for the week's priorities.",
          "Proactively call placed candidates at 1 week to gather feedback.",
        ],
      },
      {
        channel: "Email",
        tactics: [
          "Send a tailored job shortlist email within 1 hour of registration.",
          "Email clients a 'top 3 candidates' summary each Friday.",
          "Send automated interview confirmation emails with prep tips.",
          "Post-placement: send a 30/60/90-day check-in email sequence.",
        ],
      },
      {
        channel: "WhatsApp",
        tactics: [
          "Send interview reminders via WhatsApp 24 hours and 2 hours before.",
          "Use WhatsApp to share last-minute job alerts with active candidates.",
          "Collect interview feedback via a WhatsApp voice note request.",
        ],
      },
      {
        channel: "Follow-up Sequences",
        tactics: [
          "Day 1: Screening call + job match email.",
          "Day 3: Follow-up on job applications sent on their behalf.",
          "Day 7: Re-engage with new vacancies if no interview booked.",
          "Day 14: 'Passive talent' nurture email with market salary data.",
        ],
      },
    ],
  },
  {
    id: "solar",
    industry: "Solar",
    iconName: "Sun",
    description: "Qualify homeowners for solar installations with education-first outreach.",
    sections: [
      {
        channel: "Calling",
        tactics: [
          "Call within 5 minutes of a solar quote enquiry — intent is highest at this moment.",
          "Qualify on property ownership, roof type, and current energy bill.",
          "Walk through a simple savings calculation on the first call.",
          "Book a free home survey during the call — never leave it open.",
          "Call on evenings (6–8pm) when homeowners are available.",
        ],
      },
      {
        channel: "Email",
        tactics: [
          "Send a personalised savings estimate email within 30 minutes of enquiry.",
          "Include government incentives and 0% finance options in the first email.",
          "Send a case study of a local installation after the first call.",
          "Post-survey: send a detailed quote with ROI breakdown.",
        ],
      },
      {
        channel: "WhatsApp",
        tactics: [
          "Send a short explainer video about solar panel benefits via WhatsApp.",
          "Share before/after energy bill comparisons from past customers.",
          "Confirm survey appointments with a WhatsApp reminder + address confirmation.",
        ],
      },
      {
        channel: "Follow-up Sequences",
        tactics: [
          "Day 1: Call + savings estimate email.",
          "Day 2: WhatsApp video + case study email.",
          "Day 5: Follow-up call to address objections.",
          "Day 10: 'Limited survey slots' urgency email.",
          "Day 21: Re-engagement with updated energy tariff information.",
        ],
      },
    ],
  },
  {
    id: "insurance",
    industry: "Insurance",
    iconName: "Shield",
    description: "Convert insurance enquiries into policies with needs-based consultative selling.",
    sections: [
      {
        channel: "Calling",
        tactics: [
          "Call within 5 minutes — insurance enquirers compare multiple providers simultaneously.",
          "Use a discovery script focused on life events: new home, baby, promotion.",
          "Present 3 policy options at different price points on every call.",
          "Offer a 'free cover review' to existing policyholders as a re-engagement hook.",
        ],
      },
      {
        channel: "Email",
        tactics: [
          "Send a personalised quote comparison email within 15 minutes.",
          "Include a 'why cover matters' story to overcome price objections.",
          "Send renewal reminders 90, 60, and 30 days before expiry.",
          "Share monthly 'protection tips' content to stay relevant.",
        ],
      },
      {
        channel: "WhatsApp",
        tactics: [
          "Send policy documents and certificates via WhatsApp for instant access.",
          "Use WhatsApp to confirm claims submissions and updates.",
          "Send renewal alerts via WhatsApp with a direct call-to-action link.",
        ],
      },
      {
        channel: "Follow-up Sequences",
        tactics: [
          "Day 1: Call + quote email.",
          "Day 3: Objection-handling email ('Is price the barrier?').",
          "Day 7: Call with alternative lower-cost option.",
          "Day 14: Final quote expiry warning email.",
          "Day 30: Re-engagement with a life-event trigger email.",
        ],
      },
    ],
  },
  {
    id: "dental",
    industry: "Dental",
    iconName: "Smile",
    description: "Fill appointment books and retain patients with proactive recall and nurture campaigns.",
    sections: [
      {
        channel: "Calling",
        tactics: [
          "Call every new patient enquiry within 1 hour to book a consultation.",
          "Use recall calling for patients overdue a check-up (12+ months).",
          "Call no-shows within 30 minutes to rebook.",
          "Offer treatment plan calls for cosmetic enquiries (Invisalign, whitening).",
        ],
      },
      {
        channel: "Email",
        tactics: [
          "Send a practice welcome email with new patient forms on day 1.",
          "Send appointment confirmation emails with parking/preparation instructions.",
          "Recall email at 11 months: 'Time for your annual check-up.'",
          "Post-treatment: send care instructions and a review request.",
        ],
      },
      {
        channel: "WhatsApp",
        tactics: [
          "Send appointment reminders via WhatsApp 48 hours and 2 hours before.",
          "Share smile transformation results (with consent) to prompt cosmetic interest.",
          "Use WhatsApp to send post-treatment check-in messages.",
        ],
      },
      {
        channel: "Follow-up Sequences",
        tactics: [
          "Day 1: Welcome email + call to book first appointment.",
          "Day 3: Follow-up call if no booking made.",
          "Month 11: Recall email + outbound call.",
          "Post no-show: immediate call + rebook WhatsApp message.",
        ],
      },
    ],
  },
  {
    id: "saas",
    industry: "SaaS",
    iconName: "Monitor",
    description: "Convert trial signups and inbound leads into paid accounts with product-led outreach.",
    sections: [
      {
        channel: "Calling",
        tactics: [
          "Call every high-intent signup (viewed pricing page 3+ times) within 1 hour.",
          "Use a discovery call to understand their use case before demoing.",
          "Offer a 30-minute live onboarding call for trial users on day 3.",
          "Call churned customers at day 7 of cancellation to identify fix opportunities.",
        ],
      },
      {
        channel: "Email",
        tactics: [
          "Send a personalised onboarding email sequence: days 1, 3, 7, 14.",
          "Trigger a 'you're not using X feature' nudge email based on usage gaps.",
          "Send ROI case studies to trial users approaching day 14.",
          "Monthly product update emails to keep customers engaged.",
        ],
      },
      {
        channel: "WhatsApp",
        tactics: [
          "Send a WhatsApp welcome message from a named CSM on signup.",
          "Share quick feature tip videos via WhatsApp weekly during trial.",
          "Use WhatsApp for renewal upsell conversations with power users.",
        ],
      },
      {
        channel: "Follow-up Sequences",
        tactics: [
          "Day 1: Welcome email + in-app checklist.",
          "Day 3: Onboarding call offer + feature highlight email.",
          "Day 7: ROI case study + call if not logged in.",
          "Day 12: 'Days left in trial' urgency email with discount offer.",
          "Day 14: Final trial expiry call + retention offer.",
        ],
      },
    ],
  },
  {
    id: "agencies",
    industry: "Agencies",
    iconName: "Briefcase",
    description: "Win new clients and retain accounts for marketing, creative, and digital agencies.",
    sections: [
      {
        channel: "Calling",
        tactics: [
          "Call inbound enquiries within 15 minutes — agencies are often comparing 3+ options.",
          "Lead with a discovery call: understand their goals before pitching.",
          "Call past clients annually for 'audit and refresh' opportunities.",
          "Call lost pitches at 90 days — circumstances change.",
        ],
      },
      {
        channel: "Email",
        tactics: [
          "Send a 'we reviewed your current marketing' cold email to ICPs.",
          "Follow up a pitch with a personalised proposal within 24 hours.",
          "Send monthly performance reports to retain and upsell clients.",
          "Share relevant industry case studies tailored to each prospect's vertical.",
        ],
      },
      {
        channel: "WhatsApp",
        tactics: [
          "Use WhatsApp for fast client approvals on creative assets.",
          "Send monthly report previews via WhatsApp with a summary card.",
          "Share quick wins and PR coverage with clients via WhatsApp for delight moments.",
        ],
      },
      {
        channel: "Follow-up Sequences",
        tactics: [
          "Day 1: Discovery call + tailored credential email.",
          "Day 3: Case study email most relevant to their sector.",
          "Day 7: Follow-up call to address decision timeline.",
          "Day 14: Proposal expiry reminder + revised scope option.",
          "Day 30: 'Market update' email to re-engage cold prospects.",
        ],
      },
    ],
  },
];

// ── Server functions ────────────────────────────────────────────────────────

export type ActivePlaybook = {
  id:          string;
  industry:    string;
  activatedAt: string;
};

export const getActivePlaybook = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data } = await sb
      .from("growthmind_playbooks")
      .select("id, industry, activated_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("activated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return { activePlaybook: null };
    return {
      activePlaybook: {
        id:          data.id,
        industry:    data.industry,
        activatedAt: data.activated_at,
      } as ActivePlaybook,
    };
  });

export const activatePlaybook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ industry: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Archive any currently active playbook for this workspace
    await sb
      .from("growthmind_playbooks")
      .update({ status: "archived" })
      .eq("workspace_id", workspaceId)
      .eq("status", "active");

    // Upsert the selected playbook: insert or re-activate the existing row
    // Conflict target: unique constraint uq_growthmind_playbooks_workspace_industry
    const { error } = await sb.from("growthmind_playbooks").upsert(
      {
        workspace_id: workspaceId,
        industry:     data.industry,
        status:       "active",
        activated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,industry" },
    );

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deactivatePlaybook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_playbooks")
      .update({ status: "archived" })
      .eq("workspace_id", workspaceId)
      .eq("status", "active");

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── AI executive briefing for Playbooks ──────────────────────────────────────
export const getPlaybookBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const settings = (context as any).settings ?? {};
    const apiKey   = process.env.OPENAI_API_KEY ?? settings.openai_api_key;

    const { data: playbookRow } = await sb
      .from("growthmind_playbooks")
      .select("id, industry, activated_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (!playbookRow) {
      return {
        briefing:       "No marketing playbook is currently active. Activate an industry-specific playbook to get structured calling, email, and WhatsApp tactics proven for your sector.",
        score:          20,
        activeIndustry: null as string | null,
      };
    }

    const template  = PLAYBOOKS.find(p => p.id === playbookRow.industry);
    const daysSince = Math.floor((Date.now() - new Date(playbookRow.activated_at).getTime()) / 86400000);
    const score     = Math.min(90, 50 + Math.min(40, daysSince * 2));
    const topTactic = template?.sections[0]?.tactics[0] ?? "follow the calling and email sequences";
    const fallback  = `The ${playbookRow.industry} playbook has been active for ${daysSince} day${daysSince !== 1 ? "s" : ""}. Your highest-impact next action: ${topTactic}.`;

    if (!apiKey || !template) {
      return { briefing: fallback, score, activeIndustry: playbookRow.industry as string };
    }

    const allTactics = template.sections.flatMap(s => s.tactics.slice(0, 2)).slice(0, 6).join("; ");

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model:    "gpt-4o-mini",
          messages: [{
            role:    "user",
            content: `You are GrowthMind, an AI CMO. A business has activated the ${playbookRow.industry} playbook ${daysSince} days ago. Key tactics available: ${allTactics}.\n\nWrite a 2-sentence executive briefing telling them: (1) their single highest-impact tactic to execute RIGHT NOW, and (2) one specific metric to track this week to measure success. Return ONLY the 2-sentence briefing.`,
          }],
          max_tokens:  120,
          temperature: 0.4,
        }),
      });
      if (res.ok) {
        const json = await res.json() as any;
        const text = (json.choices?.[0]?.message?.content as string ?? "").trim();
        if (text) return { briefing: text, score, activeIndustry: playbookRow.industry as string };
      }
    } catch {}

    return { briefing: fallback, score, activeIndustry: playbookRow.industry as string };
  });
