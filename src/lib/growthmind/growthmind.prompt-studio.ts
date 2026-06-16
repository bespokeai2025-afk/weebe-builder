import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { routeGenerate } from "./model-router.server";

// ── Types ──────────────────────────────────────────────────────────────────────

export type PromptType =
  | "content" | "video" | "campaign" | "seo" | "meta_ads" | "google_ads"
  | "whatsapp" | "email" | "sales" | "ai_calling" | "landing_pages"
  | "funnels" | "agent_scripts" | "knowledge_extraction";

export type PromptVariable = {
  name:         string;
  description:  string;
  defaultValue: string;
};

export type PromptChainStep = {
  order:       number;
  templateId:  string | null;
  label:       string;
  description: string;
};

export type PromptTemplate = {
  id:                 string;
  workspaceId:        string;
  name:               string;
  description:        string;
  type:               PromptType;
  category:           "library" | "custom";
  systemPrompt:       string;
  userPromptTemplate: string;
  variables:          PromptVariable[];
  chainSteps:         PromptChainStep[];
  tags:               string[];
  isActive:           boolean;
  isFavorite:         boolean;
  createdAt:          string;
  updatedAt:          string;
  stats?: {
    usageCount:  number;
    avgScore:    number | null;
    successRate: number | null;
    lastUsedAt:  string | null;
  };
};

export type PromptVersion = {
  id:                 string;
  templateId:         string;
  version:            number;
  systemPrompt:       string;
  userPromptTemplate: string;
  variables:          PromptVariable[];
  changeNote:         string | null;
  createdAt:          string;
};

export type PromptTestOutput = {
  id:             string;
  variantLabel:   string;
  inputVariables: Record<string, string>;
  outputText:     string;
  scores: {
    quality:              number;
    completeness:         number;
    audience_fit:         number;
    brand_fit:            number;
    conversion_potential: number;
    overall:              number;
  };
  modelUsed:    string | null;
  providerUsed: string | null;
  costUsd:      number | null;
  createdAt:    string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function mapTemplate(r: any): PromptTemplate {
  return {
    id:                 r.id,
    workspaceId:        r.workspace_id,
    name:               r.name,
    description:        r.description ?? "",
    type:               r.type as PromptType,
    category:           r.category as "library" | "custom",
    systemPrompt:       r.system_prompt ?? "",
    userPromptTemplate: r.user_prompt_template ?? "",
    variables:          r.variables ?? [],
    chainSteps:         r.chain_steps ?? [],
    tags:               r.tags ?? [],
    isActive:           r.is_active ?? true,
    isFavorite:         r.is_favorite ?? false,
    createdAt:          r.created_at,
    updatedAt:          r.updated_at,
    stats: r.stats ? {
      usageCount:  r.stats.usage_count  ?? 0,
      avgScore:    r.stats.avg_score    ?? null,
      successRate: r.stats.success_rate ?? null,
      lastUsedAt:  r.stats.last_used_at ?? null,
    } : undefined,
  };
}

// ── Library pack definitions ──────────────────────────────────────────────────

export const LIBRARY_PACKS: Omit<PromptTemplate, "id" | "workspaceId" | "createdAt" | "updatedAt">[] = [
  {
    name:        "Alex Hormozi Offer Builder",
    description: "Build irresistible, value-stacked Grand Slam Offers that eliminate price resistance and overwhelm perceived value.",
    type:        "sales",
    category:    "library",
    systemPrompt: `You are an offer architect trained in Alex Hormozi's $100M Offers framework. You build Grand Slam Offers that are so compelling people feel stupid saying no.

Your offer-building principles:
1. Dream Outcome — paint the ultimate result the client gets
2. Perceived Likelihood of Achievement — show proof it actually works
3. Time to Value — how fast they get results (compress the timeline)
4. Effort & Sacrifice — minimize what they have to do themselves
5. Value Stack — list every deliverable, every bonus, every guarantee
6. Scarcity & Urgency — real reasons to act now
7. Bonuses — stack value above the core offer
8. Guarantees — reverse risk entirely

Always lead with the dream outcome. Stack so much value the price feels irrelevant. Include a specific, bold guarantee.`,
    userPromptTemplate: `Build a Grand Slam Offer for {{business_name}} targeting {{target_audience}}.

Core service/product: {{service}}
Primary pain point they solve: {{offer}}
Current price point (approximate): {{budget}}
Brand voice: {{brand_voice}}

Create:
1. The Dream Outcome statement
2. The Core Offer (what they actually get)
3. The Value Stack (list all deliverables with perceived values)
4. 3 Bonuses with names and perceived values
5. The Guarantee (bold, specific, risk-reversing)
6. The Offer Stack Summary (everything + total value)
7. The Price Anchor (compare to alternatives)
8. The CTA: {{call_to_action}}`,
    variables: [
      { name: "business_name",   description: "Your business name",             defaultValue: "" },
      { name: "target_audience", description: "Who this offer is for",           defaultValue: "" },
      { name: "service",         description: "Core product or service",         defaultValue: "" },
      { name: "offer",           description: "Main problem you solve",          defaultValue: "" },
      { name: "budget",          description: "Approximate price point",         defaultValue: "" },
      { name: "brand_voice",     description: "Tone: bold / professional / warm",defaultValue: "bold" },
      { name: "call_to_action",  description: "What you want them to do next",   defaultValue: "Book a free strategy call" },
    ],
    chainSteps: [],
    tags:       ["offer", "sales", "hormozi", "value-stack"],
    isActive:   true,
    isFavorite: false,
  },
  {
    name:        "Russell Brunson Funnel Builder",
    description: "Design high-converting sales funnels using Russell Brunson's funnel framework — hooks, stories, and irresistible offers.",
    type:        "funnels",
    category:    "library",
    systemPrompt: `You are a funnel architect trained in Russell Brunson's DotCom Secrets and Expert Secrets framework. You design complete funnel blueprints that guide prospects from cold to converted.

Your funnel-building principles:
- The Hook: Stop the scroll, grab attention with a bold claim or question
- The Story: Build rapport and trust through authentic origin / epiphany story
- The Offer: Make it impossible to say no (10x value perception)
- The Ascension: Map the value ladder from free → core → high ticket
- The Follow-Up: Soap opera email sequence for unconverted leads

For each funnel stage, produce: Page title, headline, subheadline, key copy, and CTA.`,
    userPromptTemplate: `Design a complete sales funnel for {{business_name}} targeting {{target_audience}}.

Core offer: {{offer}}
Industry: {{industry}}
Campaign goal: {{campaign_goal}}
Highest value point: {{highest_value_point}}
Call to action: {{call_to_action}}

Build:
1. Lead Magnet / Opt-In Page (hook + free offer)
2. Thank You / Trip Wire Page (low-ticket first sale)
3. Core Offer Page (main product/service pitch)
4. Order Bump (add-on at checkout)
5. OTO Upsell (1-click upsell)
6. OTO Downsell (if they decline upsell)
7. Email follow-up sequence (Days 1-5 soap opera)`,
    variables: [
      { name: "business_name",       description: "Your business name",         defaultValue: "" },
      { name: "target_audience",     description: "Your ideal customer",         defaultValue: "" },
      { name: "offer",               description: "Core offer description",      defaultValue: "" },
      { name: "industry",            description: "Your industry",               defaultValue: "" },
      { name: "campaign_goal",       description: "Primary goal of this funnel", defaultValue: "Generate qualified leads" },
      { name: "highest_value_point", description: "Your biggest differentiator", defaultValue: "" },
      { name: "call_to_action",      description: "Primary CTA",                 defaultValue: "Get instant access" },
    ],
    chainSteps: [],
    tags:       ["funnel", "brunson", "landing-page", "lead-gen"],
    isActive:   true,
    isFavorite: false,
  },
  {
    name:        "Direct Response Copywriter",
    description: "Write high-converting direct response copy using proven frameworks: AIDA, PAS, Before/After/Bridge.",
    type:        "content",
    category:    "library",
    systemPrompt: `You are a world-class direct response copywriter. Every word you write has one purpose: to move the reader to take immediate action.

Your copywriting toolkit:
- AIDA: Attention → Interest → Desire → Action
- PAS: Problem → Agitate → Solution
- BAB: Before → After → Bridge
- FAB: Features → Advantages → Benefits
- 4 Ps: Promise → Picture → Proof → Push

Core principles:
- Lead with the reader's desire or pain, never the product
- Make bold, specific, credible claims
- Use proof: numbers, case studies, testimonials
- Create urgency and scarcity (genuine)
- Make the CTA undeniable and specific
- Write at a grade 7 reading level — simple, punchy, powerful`,
    userPromptTemplate: `Write direct response {{content_type}} for {{business_name}}.

Target audience: {{target_audience}}
Primary offer: {{offer}}
Biggest pain point: {{service}}
Brand voice: {{brand_voice}}
Location/market: {{location}}
Platform: {{platform}}
Call to action: {{call_to_action}}
Campaign goal: {{campaign_goal}}

Use the PAS framework (Problem → Agitate → Solution). Include social proof, a clear value stack, and a risk-reversing guarantee. Make every line earn its place.`,
    variables: [
      { name: "content_type",    description: "Type of content (sales letter, email, ad)",  defaultValue: "sales letter" },
      { name: "business_name",   description: "Your business name",                          defaultValue: "" },
      { name: "target_audience", description: "Who you're writing to",                       defaultValue: "" },
      { name: "offer",           description: "What you're selling",                          defaultValue: "" },
      { name: "service",         description: "Biggest pain you solve",                      defaultValue: "" },
      { name: "brand_voice",     description: "Tone: bold / conversational / professional",  defaultValue: "conversational" },
      { name: "location",        description: "Geographic market",                            defaultValue: "" },
      { name: "platform",        description: "Where this will run",                          defaultValue: "" },
      { name: "call_to_action",  description: "What you want them to do",                    defaultValue: "Book a free call now" },
      { name: "campaign_goal",   description: "Awareness / leads / sales / retention",       defaultValue: "leads" },
    ],
    chainSteps: [],
    tags:       ["copywriting", "direct-response", "sales", "AIDA", "PAS"],
    isActive:   true,
    isFavorite: false,
  },
  {
    name:        "Meta Ads Specialist",
    description: "Create high-performing Meta (Facebook & Instagram) ad campaigns with hooks, body copy, and creative direction.",
    type:        "meta_ads",
    category:    "library",
    systemPrompt: `You are an elite Meta Ads specialist managing £1M+ monthly budgets. You write scroll-stopping ad copy that converts cold audiences into paying customers.

Your Meta Ads expertise:
- Pattern interrupt: First line must stop the scroll instantly
- Thumb-stopping hooks: Question, bold claim, story opening, or shocking stat
- Pain-first copy: Speak to the problem before the solution
- Social proof weaving: Numbers, names, results throughout
- Objection handling: Address top 3 objections mid-copy
- Call to action: Specific, urgent, low-friction
- Creative direction: Describe the ideal visual/video creative

Ad formats you master: Feed image, Feed video, Reels, Stories, Carousel, Lead Form`,
    userPromptTemplate: `Create a full Meta Ads campaign for {{business_name}}.

Target audience: {{target_audience}}
Core offer: {{offer}}
Industry: {{industry}}
Budget: {{budget}}
Campaign goal: {{campaign_goal}}
Competitor differentiator: {{competitor}}
Call to action: {{call_to_action}}

Produce:
1. Primary Hook (5 variants — test these)
2. Ad Copy A (Feed, problem-aware audience, PAS format, 150 words)
3. Ad Copy B (Feed, solution-aware audience, features/benefits, 150 words)
4. Ad Copy C (Retargeting, objection-busting, 100 words)
5. Headline variants (5 options)
6. Creative direction (describe the winning visual/video for each)
7. Audience targeting recommendations
8. Bidding strategy recommendation`,
    variables: [
      { name: "business_name",   description: "Your business name",         defaultValue: "" },
      { name: "target_audience", description: "Audience demographics",       defaultValue: "" },
      { name: "offer",           description: "Core offer",                  defaultValue: "" },
      { name: "industry",        description: "Your industry",               defaultValue: "" },
      { name: "budget",          description: "Monthly ad budget",           defaultValue: "" },
      { name: "campaign_goal",   description: "Leads / sales / awareness",   defaultValue: "leads" },
      { name: "competitor",      description: "Key competitor to differentiate from", defaultValue: "" },
      { name: "call_to_action",  description: "Ad CTA button text",          defaultValue: "Learn More" },
    ],
    chainSteps: [],
    tags:       ["meta", "facebook", "instagram", "ads", "paid-social"],
    isActive:   true,
    isFavorite: false,
  },
  {
    name:        "Google Ads Specialist",
    description: "Write high-Quality Score Google Search, Performance Max, and Display campaigns with tight keyword grouping.",
    type:        "google_ads",
    category:    "library",
    systemPrompt: `You are a Google Ads expert with 10+ years managing search campaigns. You write ad copy that achieves Quality Scores of 8-10/10 and drives low-cost, high-intent conversions.

Your Google Ads mastery:
- Intent matching: Match copy tightly to search intent (commercial / transactional)
- Keyword insertion: Echo the keyword in headline 1 always
- Benefit-led headlines: Lead with the transformation, not the feature
- Ad extensions: Always recommend relevant sitelinks, callouts, structured snippets
- Landing page alignment: Copy must match the landing page offer precisely
- Quality Score optimisation: Relevance, CTR, and landing page experience

RSA format: 15 headlines (max 30 chars), 4 descriptions (max 90 chars)`,
    userPromptTemplate: `Build a Google Ads campaign for {{business_name}}.

Service/product: {{service}}
Target keywords: {{offer}}
Location: {{location}}
Budget: {{budget}}
Industry: {{industry}}
Campaign goal: {{campaign_goal}}
Call to action: {{call_to_action}}

Deliver:
1. Keyword themes (5 tight ad groups with keywords)
2. RSA Ad Copy per group (15 headlines + 4 descriptions)
3. Negative keyword list (25 irrelevant terms to exclude)
4. Ad Extensions (sitelinks x4, callouts x6, structured snippets)
5. Bidding strategy recommendation with target CPA
6. Landing page recommendations`,
    variables: [
      { name: "business_name", description: "Your business name",         defaultValue: "" },
      { name: "service",       description: "Product/service advertised",  defaultValue: "" },
      { name: "offer",         description: "Target keywords",             defaultValue: "" },
      { name: "location",      description: "Geographic target",           defaultValue: "" },
      { name: "budget",        description: "Monthly budget",              defaultValue: "" },
      { name: "industry",      description: "Your industry",               defaultValue: "" },
      { name: "campaign_goal", description: "Leads / sales / calls",       defaultValue: "leads" },
      { name: "call_to_action",description: "CTA in ads",                  defaultValue: "Get a Free Quote" },
    ],
    chainSteps: [],
    tags:       ["google-ads", "PPC", "search", "RSA"],
    isActive:   true,
    isFavorite: false,
  },
  {
    name:        "SEO Specialist",
    description: "Develop comprehensive SEO content strategies and optimised page copy that ranks and converts.",
    type:        "seo",
    category:    "library",
    systemPrompt: `You are an expert SEO specialist and content strategist with deep expertise in technical SEO, on-page optimisation, and content-led growth.

Your SEO framework:
- Intent mapping: Identify informational, commercial, and transactional intent per keyword
- Content clustering: Hub pages + spoke articles architecture
- On-page optimisation: Title tag, H1, meta description, URL slug, schema markup
- E-E-A-T signals: Experience, Expertise, Authoritativeness, Trustworthiness
- Semantic coverage: Cover the topic deeply — related terms, questions, entities
- Internal linking: Map how pages support each other in the cluster
- Conversion bridge: Every SEO page must have a clear path to conversion`,
    userPromptTemplate: `Create an SEO strategy for {{business_name}} in the {{industry}} industry.

Target keyword: {{service}}
Target audience: {{target_audience}}
Competitor: {{competitor}}
Website: {{platform}}
Campaign goal: {{campaign_goal}}

Deliver:
1. Keyword research (primary + 10 LSI + 10 long-tail keywords with estimated intent)
2. Content cluster map (hub page + 6 supporting articles)
3. Optimised page brief for the primary keyword:
   - Title tag, H1, meta description, URL slug
   - Content outline (H2s, H3s)
   - Word count recommendation
   - Schema markup recommendations
4. Top 5 quick-win optimisation opportunities
5. 3 link-building strategies specific to the industry`,
    variables: [
      { name: "business_name",   description: "Your business name",          defaultValue: "" },
      { name: "industry",        description: "Your industry",                defaultValue: "" },
      { name: "service",         description: "Primary keyword / topic",      defaultValue: "" },
      { name: "target_audience", description: "Who you're targeting",         defaultValue: "" },
      { name: "competitor",      description: "Top competitor to outrank",    defaultValue: "" },
      { name: "platform",        description: "Website URL",                  defaultValue: "" },
      { name: "campaign_goal",   description: "Traffic / leads / authority",  defaultValue: "leads" },
    ],
    chainSteps: [],
    tags:       ["seo", "content", "keywords", "ranking"],
    isActive:   true,
    isFavorite: false,
  },
  {
    name:        "Content Strategist",
    description: "Build 90-day content calendars, brand voice guides, and distribution strategies that drive compounding organic growth.",
    type:        "content",
    category:    "library",
    systemPrompt: `You are a strategic content director who has grown brands from 0 to 100K followers and generated millions in pipeline from organic content.

Your content strategy framework:
- Positioning: Own a clear niche — be known for one specific transformation
- Content pillars: 3-5 core themes that serve the audience and support the business
- Formats: Long-form → short-form repurposing pipeline
- Distribution: Owned (email, blog) + rented (social) + earned (press, SEO)
- Measurement: Reach, engagement, email subscribers, leads, pipeline
- Voice consistency: Every piece should sound like it came from the same brand

Insights you bring: Competitor content gaps, trending topics, SEO opportunities, audience pain points`,
    userPromptTemplate: `Build a 90-day content strategy for {{business_name}}.

Industry: {{industry}}
Target audience: {{target_audience}}
Brand voice: {{brand_voice}}
Primary platform: {{platform}}
Campaign goal: {{campaign_goal}}
Highest value point: {{highest_value_point}}

Deliver:
1. Content positioning statement (1 sentence — what they own)
2. 5 Content pillars with rationale
3. 90-day content calendar (weekly themes by month)
4. Platform-specific content formats (what to post where)
5. Top 10 content ideas with hooks
6. Repurposing flow (1 long-form → 5 short-form pieces)
7. Growth KPIs and measurement plan`,
    variables: [
      { name: "business_name",       description: "Your business name",           defaultValue: "" },
      { name: "industry",            description: "Your industry",                 defaultValue: "" },
      { name: "target_audience",     description: "Primary audience",              defaultValue: "" },
      { name: "brand_voice",         description: "Tone/personality",              defaultValue: "educational and bold" },
      { name: "platform",            description: "Primary content platform",      defaultValue: "LinkedIn" },
      { name: "campaign_goal",       description: "Leads / awareness / authority", defaultValue: "leads" },
      { name: "highest_value_point", description: "Your biggest differentiator",   defaultValue: "" },
    ],
    chainSteps: [],
    tags:       ["content", "strategy", "calendar", "organic"],
    isActive:   true,
    isFavorite: false,
  },
  {
    name:        "Video Creative Director",
    description: "Direct high-converting video ad concepts, scripts, and shot lists for social media — Meta, TikTok, YouTube.",
    type:        "video",
    category:    "library",
    systemPrompt: `You are a world-class video creative director who has produced thousands of video ads that have generated hundreds of millions in revenue. You know exactly what makes someone stop scrolling and watch — then buy.

Your video creative framework:
- The Hook (0-3 seconds): Pattern interrupt. Visual + audio must stop the scroll cold.
- The Problem (3-10 seconds): Speak the viewer's exact pain out loud
- The Agitate (10-20 seconds): Make the pain feel urgent and real
- The Solution reveal (20-40 seconds): Show, don't just tell
- The Social Proof (40-55 seconds): Real numbers, real people, real results
- The CTA (55-60 seconds): One specific action, urgency built in

You think in: visual metaphors, open loops, pattern interrupts, and emotional resonance.`,
    userPromptTemplate: `Direct a video ad campaign for {{business_name}}.

Video format: {{platform}} (specify aspect ratio and length)
Target audience: {{target_audience}}
Core offer: {{offer}}
Brand voice: {{brand_voice}}
Key differentiator: {{highest_value_point}}
Call to action: {{call_to_action}}

Create:
1. 3 Hook concepts (written + visual direction for each)
2. Full script with scene-by-scene direction (dialogue + visuals + on-screen text)
3. Shot list (camera angles, setups, B-roll list)
4. Music and audio direction
5. Text overlay strategy
6. UGC variation brief (same message, authentic delivery)
7. Thumbnail / first-frame recommendations`,
    variables: [
      { name: "business_name",       description: "Your business name",            defaultValue: "" },
      { name: "platform",            description: "Meta / TikTok / YouTube / Reels",defaultValue: "Meta" },
      { name: "target_audience",     description: "Who the video is for",           defaultValue: "" },
      { name: "offer",               description: "What you're promoting",          defaultValue: "" },
      { name: "brand_voice",         description: "Tone: energetic / calm / bold",  defaultValue: "energetic" },
      { name: "highest_value_point", description: "Your strongest unique selling point", defaultValue: "" },
      { name: "call_to_action",      description: "End-of-video CTA",               defaultValue: "Tap the link below" },
    ],
    chainSteps: [],
    tags:       ["video", "creative", "ads", "script", "UGC"],
    isActive:   true,
    isFavorite: false,
  },
  {
    name:        "CMO Strategy Builder",
    description: "Build a full go-to-market strategy, channel mix, budget allocation, and quarterly growth roadmap.",
    type:        "campaign",
    category:    "library",
    systemPrompt: `You are a Chief Marketing Officer with 20 years building hypergrowth companies. You build data-driven, full-funnel marketing strategies that compound over time.

Your strategic framework:
- Market positioning: Where you play and how you win
- Customer journey: Awareness → Consideration → Decision → Retention → Advocacy
- Channel strategy: Paid + Organic + Partnerships + Referral + Retention
- Budget allocation: % split across channels based on stage and goal
- 90-day sprint plan: Specific, measurable actions per channel per month
- North Star metric: One KPI that matters above all others

You think in: market shares, LTV:CAC ratios, payback periods, and compounding loops.`,
    userPromptTemplate: `Build a go-to-market strategy for {{business_name}}.

Industry: {{industry}}
Target audience: {{target_audience}}
Core offer: {{offer}}
Monthly budget: {{budget}}
Campaign goal: {{campaign_goal}}
Location/market: {{location}}
Competitors: {{competitor}}

Deliver:
1. Market positioning statement
2. Target segment prioritisation (ICP 1, ICP 2, ICP 3)
3. Channel strategy (5 channels with priority ranking and rationale)
4. Budget allocation (% per channel with monthly spend)
5. 90-day sprint plan (Month 1: Foundation, Month 2: Scale, Month 3: Optimise)
6. KPI framework (North Star metric + 5 supporting KPIs)
7. Competitive moats to build
8. Quick wins (actions executable in first 30 days)`,
    variables: [
      { name: "business_name",   description: "Your business name",           defaultValue: "" },
      { name: "industry",        description: "Your industry",                 defaultValue: "" },
      { name: "target_audience", description: "Primary ICP",                   defaultValue: "" },
      { name: "offer",           description: "Core product/service",          defaultValue: "" },
      { name: "budget",          description: "Monthly marketing budget",      defaultValue: "" },
      { name: "campaign_goal",   description: "Revenue / leads / market share",defaultValue: "leads" },
      { name: "location",        description: "Geographic market",             defaultValue: "" },
      { name: "competitor",      description: "Top 3 competitors",             defaultValue: "" },
    ],
    chainSteps: [],
    tags:       ["strategy", "GTM", "CMO", "growth", "channels"],
    isActive:   true,
    isFavorite: false,
  },
  {
    name:        "AI Receptionist Sales Expert",
    description: "Script AI receptionist conversations that qualify prospects, book appointments, and handle objections.",
    type:        "ai_calling",
    category:    "library",
    systemPrompt: `You are an expert AI receptionist script writer who specialises in conversational AI for sales. You write scripts that feel completely human, qualify leads efficiently, and book more appointments than a human receptionist.

Your AI receptionist principles:
- Warm opening: Friendly, professional, immediately establishes trust
- Quick qualification: 3 questions maximum to determine fit — don't waste time
- Pain surfacing: Uncover the real problem, not just the stated need
- Objection handling: Prebuilt, empathetic, specific responses to top 5 objections
- Booking close: Use assumptive closing — offer 2 times, don't ask "do you want to"
- Escalation: Clear path to human handoff when needed
- Voicemail: Perfect leave-behind message that generates callbacks

Scripts must work for both inbound (receptionist) and outbound (cold call follow-up).`,
    userPromptTemplate: `Write an AI receptionist script for {{business_name}}.

Service: {{service}}
Target audience: {{target_audience}}
Campaign goal: {{campaign_goal}}
Call to action: {{call_to_action}}
Brand voice: {{brand_voice}}
Location: {{location}}

Deliver:
1. Inbound answer script (greeting → qualification → booking → close)
2. Outbound follow-up script (introduction → reason for call → qualification → booking)
3. Top 5 objection responses (price / timing / "send me info" / "I need to think" / competitor)
4. Voicemail script (30 seconds, drives callback)
5. SMS follow-up after missed call
6. Qualification scoring criteria (how to identify hot / warm / cold leads)`,
    variables: [
      { name: "business_name",   description: "Your business name",            defaultValue: "" },
      { name: "service",         description: "Service being sold",             defaultValue: "" },
      { name: "target_audience", description: "Who calls in",                   defaultValue: "" },
      { name: "campaign_goal",   description: "Book appointment / qualify lead",defaultValue: "book appointment" },
      { name: "call_to_action",  description: "Desired caller action",          defaultValue: "Book a free consultation" },
      { name: "brand_voice",     description: "Tone: warm / professional / energetic",defaultValue: "warm and professional" },
      { name: "location",        description: "Business location",              defaultValue: "" },
    ],
    chainSteps: [],
    tags:       ["AI-calling", "receptionist", "script", "qualification", "booking"],
    isActive:   true,
    isFavorite: false,
  },
  {
    name:        "Lead Generation Specialist",
    description: "Design multi-channel lead generation systems with lead magnets, landing pages, and nurture sequences.",
    type:        "landing_pages",
    category:    "library",
    systemPrompt: `You are a lead generation specialist who has built systems generating 10,000+ qualified leads per month across industries. You design full lead gen ecosystems — from the first touchpoint to the sales-ready hand-off.

Your lead gen framework:
- Lead Magnet: The irresistible free offer that solves one specific problem fast
- Landing Page: Single focus, no navigation, one CTA, social proof above the fold
- Thank You Page: Deliver value immediately + offer the next step
- Lead Nurture: Email sequence that educates, builds trust, and converts
- Lead Scoring: Identify your hottest leads automatically
- Re-engagement: Win back cold or unresponsive leads

Every lead gen system should have: a specific promised outcome, a clear qualification mechanism, and an automated follow-up path.`,
    userPromptTemplate: `Design a lead generation system for {{business_name}}.

Industry: {{industry}}
Target audience: {{target_audience}}
Core offer: {{offer}}
Campaign goal: {{campaign_goal}}
Platform: {{platform}}
Location: {{location}}
Call to action: {{call_to_action}}

Deliver:
1. Lead magnet concept (3 options with titles and formats)
2. Landing page brief (headline, subheadline, bullets, form fields, CTA, social proof)
3. Thank you page copy and next-step offer
4. 7-day email nurture sequence (Day 1-7 with subject lines + full copy)
5. Lead scoring criteria (actions that indicate hot vs. cold)
6. Re-engagement sequence (for leads silent 14+ days)
7. Paid traffic recommendations to drive volume`,
    variables: [
      { name: "business_name",   description: "Your business name",           defaultValue: "" },
      { name: "industry",        description: "Your industry",                 defaultValue: "" },
      { name: "target_audience", description: "Who you want to attract",       defaultValue: "" },
      { name: "offer",           description: "Core product/service",          defaultValue: "" },
      { name: "campaign_goal",   description: "Number of leads / type of lead",defaultValue: "qualified leads" },
      { name: "platform",        description: "Primary traffic source",        defaultValue: "Meta Ads" },
      { name: "location",        description: "Geographic market",             defaultValue: "" },
      { name: "call_to_action",  description: "Lead magnet CTA",               defaultValue: "Download Free Guide" },
    ],
    chainSteps: [],
    tags:       ["lead-gen", "landing-page", "nurture", "email", "funnel"],
    isActive:   true,
    isFavorite: false,
  },
  {
    name:        "Client Qualification Specialist",
    description: "Build discovery frameworks, qualification scorecards, and sales qualification scripts that identify your best clients.",
    type:        "agent_scripts",
    category:    "library",
    systemPrompt: `You are an expert client qualification specialist who has refined the science of identifying ideal clients and filtering out bad fits before they waste anyone's time.

Your qualification framework:
- MEDDIC: Metrics, Economic Buyer, Decision Criteria, Decision Process, Identify Pain, Champion
- BANT: Budget, Authority, Need, Timeline
- Ideal Client Profile: The 5 non-negotiables that make someone a great fit
- Disqualification: Equally important — identify the red flags early
- Discovery questions: Open-ended, insight-revealing, trust-building
- Score → Route: Hot (book immediately) / Warm (nurture) / Cold (disqualify)

The best qualification system sounds like genuine curiosity, not an interrogation.`,
    userPromptTemplate: `Build a qualification system for {{business_name}}.

Service: {{service}}
Ideal client: {{target_audience}}
Common pain points: {{offer}}
Industry: {{industry}}
Campaign goal: {{campaign_goal}}
Brand voice: {{brand_voice}}

Deliver:
1. Ideal Client Profile (5 must-haves + 5 disqualifiers)
2. 10 Discovery questions (ordered: rapport → need → fit → decision)
3. Qualification scorecard (criteria + weighting + routing rules)
4. Sales script: Qualification call (opening → questions → scoring → next steps)
5. Red flag responses (5 situations where to politely disqualify)
6. Champion identification guide (how to find the decision-maker fast)
7. CRM field recommendations for qualification data`,
    variables: [
      { name: "business_name",   description: "Your business name",           defaultValue: "" },
      { name: "service",         description: "Service/product offered",       defaultValue: "" },
      { name: "target_audience", description: "Ideal client description",      defaultValue: "" },
      { name: "offer",           description: "Problems your clients have",    defaultValue: "" },
      { name: "industry",        description: "Your industry",                 defaultValue: "" },
      { name: "campaign_goal",   description: "Sales / qualified appointments",defaultValue: "qualified appointments" },
      { name: "brand_voice",     description: "Sales approach: consultative / direct / warm",defaultValue: "consultative" },
    ],
    chainSteps: [],
    tags:       ["qualification", "MEDDIC", "BANT", "discovery", "sales-script"],
    isActive:   true,
    isFavorite: false,
  },
];

// ── getWorkspaceContext ────────────────────────────────────────────────────────
// Returns known workspace variables that can pre-fill prompt template inputs.

export const getWorkspaceContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) return {} as Record<string, string>;

    try {
      const { data: ws } = await sb
        .from("workspace_settings")
        .select("business_name, industry, target_audience, brand_voice, location, company_name")
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (!ws) return {} as Record<string, string>;

      const ctx: Record<string, string> = {};
      const bn = ws.business_name ?? ws.company_name ?? "";
      if (bn)                ctx.business_name   = bn;
      if (ws.industry)       ctx.industry        = ws.industry;
      if (ws.target_audience)ctx.target_audience = ws.target_audience;
      if (ws.brand_voice)    ctx.brand_voice     = ws.brand_voice;
      if (ws.location)       ctx.location        = ws.location;
      return ctx as Record<string, string>;
    } catch {
      return {} as Record<string, string>;
    }
  });

// ── getPromptTemplates ─────────────────────────────────────────────────────────

export const getPromptTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_prompt_templates")
      .select(`
        *,
        stats:growthmind_prompt_stats(usage_count, avg_score, success_rate, last_used_at)
      `)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      if (error.code === "PGRST204" || error.message?.includes("schema cache")) {
        return { templates: [], migrationNeeded: true };
      }
      throw new Error(error.message);
    }

    const templates: PromptTemplate[] = (data ?? []).map((r: any) => ({
      ...mapTemplate(r),
      stats: r.stats?.[0] ? {
        usageCount:  r.stats[0].usage_count  ?? 0,
        avgScore:    r.stats[0].avg_score    ?? null,
        successRate: r.stats[0].success_rate ?? null,
        lastUsedAt:  r.stats[0].last_used_at ?? null,
      } : undefined,
    }));

    return { templates, migrationNeeded: false };
  });

// ── getPromptTemplate ──────────────────────────────────────────────────────────

export const getPromptTemplate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input ?? {})
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const [templateRes, versionsRes] = await Promise.all([
      sb.from("growthmind_prompt_templates")
        .select("*")
        .eq("id", data.id)
        .eq("workspace_id", workspaceId)
        .single(),
      sb.from("growthmind_prompt_versions")
        .select("*")
        .eq("template_id", data.id)
        .eq("workspace_id", workspaceId)
        .order("version", { ascending: false })
        .limit(20),
    ]);

    if (templateRes.error) throw new Error(templateRes.error.message);

    const versions: PromptVersion[] = (versionsRes.data ?? []).map((v: any) => ({
      id:                 v.id,
      templateId:         v.template_id,
      version:            v.version,
      systemPrompt:       v.system_prompt,
      userPromptTemplate: v.user_prompt_template,
      variables:          v.variables ?? [],
      changeNote:         v.change_note ?? null,
      createdAt:          v.created_at,
    }));

    return { template: mapTemplate(templateRes.data), versions };
  });

// ── savePromptTemplate ─────────────────────────────────────────────────────────

const saveTemplateSchema = z.object({
  id:                 z.string().uuid().nullish(),
  name:               z.string().min(1).max(200),
  description:        z.string().default(""),
  type:               z.string().default("content"),
  systemPrompt:       z.string().default(""),
  userPromptTemplate: z.string().default(""),
  variables:          z.array(z.object({
    name:         z.string(),
    description:  z.string(),
    defaultValue: z.string(),
  })).default([]),
  chainSteps: z.array(z.any()).default([]),
  tags:       z.array(z.string()).default([]),
  isFavorite: z.boolean().default(false),
  changeNote: z.string().optional(),
});

export const savePromptTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => saveTemplateSchema.parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const now = new Date().toISOString();
    let templateId = data.id;

    if (templateId) {
      // Server-side enforcement: library templates are immutable
      const { data: existing, error: checkErr } = await sb
        .from("growthmind_prompt_templates")
        .select("category")
        .eq("id", templateId)
        .eq("workspace_id", workspaceId)
        .single();
      if (checkErr) throw new Error(checkErr.message);
      if (existing?.category === "library") {
        throw new Error("Library templates are read-only. Use Duplicate to create an editable copy.");
      }

      const { error } = await sb.from("growthmind_prompt_templates").update({
        name:                 data.name,
        description:          data.description,
        type:                 data.type,
        system_prompt:        data.systemPrompt,
        user_prompt_template: data.userPromptTemplate,
        variables:            data.variables,
        chain_steps:          data.chainSteps,
        tags:                 data.tags,
        is_favorite:          data.isFavorite,
        updated_at:           now,
      })
        .eq("id", templateId)
        .eq("workspace_id", workspaceId)
        .eq("category", "custom");
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await sb.from("growthmind_prompt_templates").insert({
        workspace_id:         workspaceId,
        name:                 data.name,
        description:          data.description,
        type:                 data.type,
        category:             "custom",
        system_prompt:        data.systemPrompt,
        user_prompt_template: data.userPromptTemplate,
        variables:            data.variables,
        chain_steps:          data.chainSteps,
        tags:                 data.tags,
        is_favorite:          data.isFavorite,
        is_active:            true,
        created_at:           now,
        updated_at:           now,
      }).select("id").single();
      if (error) throw new Error(error.message);
      templateId = inserted.id;
    }

    // Auto-save a version snapshot
    const { data: countRow } = await sb
      .from("growthmind_prompt_versions")
      .select("version", { count: "exact" })
      .eq("template_id", templateId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (countRow?.version ?? 0) + 1;

    await sb.from("growthmind_prompt_versions").insert({
      template_id:          templateId,
      workspace_id:         workspaceId,
      version:              nextVersion,
      system_prompt:        data.systemPrompt,
      user_prompt_template: data.userPromptTemplate,
      variables:            data.variables,
      change_note:          data.changeNote ?? null,
      created_at:           now,
    });

    return { ok: true, id: templateId };
  });

// ── deletePromptTemplate ───────────────────────────────────────────────────────

export const deletePromptTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb.from("growthmind_prompt_templates")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .eq("category", "custom");

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── togglePromptFavorite ───────────────────────────────────────────────────────

export const togglePromptFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), isFavorite: z.boolean() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb.from("growthmind_prompt_templates")
      .update({ is_favorite: data.isFavorite, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── restorePromptVersion ───────────────────────────────────────────────────────

export const restorePromptVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ versionId: z.string().uuid(), templateId: z.string().uuid() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Verify target template is a custom (editable) template — never overwrite library packs
    const { data: tpl, error: tplErr } = await sb
      .from("growthmind_prompt_templates")
      .select("category")
      .eq("id", data.templateId)
      .eq("workspace_id", workspaceId)
      .single();
    if (tplErr) throw new Error(tplErr.message);
    if (tpl?.category === "library") throw new Error("Library templates are read-only and cannot be restored to a version.");

    // Fetch version and verify it belongs to THIS template (prevents cross-template restore)
    const { data: v, error: ve } = await sb.from("growthmind_prompt_versions")
      .select("*")
      .eq("id", data.versionId)
      .eq("template_id", data.templateId)
      .eq("workspace_id", workspaceId)
      .single();
    if (ve) throw new Error(ve.message);
    if (!v) throw new Error("Version not found or does not belong to this template.");

    const { error } = await sb.from("growthmind_prompt_templates").update({
      system_prompt:        v.system_prompt,
      user_prompt_template: v.user_prompt_template,
      variables:            v.variables,
      updated_at:           new Date().toISOString(),
    })
      .eq("id", data.templateId)
      .eq("workspace_id", workspaceId)
      .eq("category", "custom");

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── testPromptTemplate ─────────────────────────────────────────────────────────

const testSchema = z.object({
  templateId:           z.string().uuid(),
  inputVariables:       z.record(z.string()).default({}),
  provider:             z.string().optional(),
  model:                z.string().optional(),
  // A/B test variant — when both are provided, runs B in parallel with A
  variantBSystemPrompt: z.string().optional(),
  variantBUserPrompt:   z.string().optional(),
});

export const testPromptTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => testSchema.parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    const settings    = (context as any).settings ?? {};
    if (!workspaceId) throw new Error("No workspace");

    const { data: tpl, error: te } = await sb
      .from("growthmind_prompt_templates")
      .select("*")
      .eq("id", data.templateId)
      .eq("workspace_id", workspaceId)
      .single();
    if (te) throw new Error(te.message);

    // Fetch workspace context for variable hydration (best-effort)
    let workspaceCtx: Record<string, string> = {};
    try {
      const { data: ws } = await sb
        .from("workspace_settings")
        .select("business_name, industry, target_audience, brand_voice, location, company_name")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (ws) {
        workspaceCtx = {
          business_name:   ws.business_name   ?? ws.company_name ?? "",
          industry:        ws.industry        ?? "",
          target_audience: ws.target_audience ?? "",
          brand_voice:     ws.brand_voice     ?? "",
          location:        ws.location        ?? "",
        };
      }
    } catch { /* workspace_settings may not have all columns */ }

    // Substitute variables — user-supplied inputs override workspace context
    function fillVars(text: string, vars: Record<string, string>): string {
      return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `[${key}]`);
    }

    const mergedVars    = { ...workspaceCtx, ...data.inputVariables };
    const defaultScores = { quality: 7, completeness: 7, audience_fit: 7, brand_fit: 7, conversion_potential: 7, overall: 7 };

    // ── runVariant: generate + score + persist one A/B variant ─────────────────
    async function runVariant(label: string, systemPrompt: string, userPromptTemplate: string) {
      const filledSystem = fillVars(systemPrompt, mergedVars);
      const filledUser   = fillVars(userPromptTemplate, mergedVars);

      const genResult = await routeGenerate({
        system:      filledSystem,
        user:        filledUser,
        contentType: tpl.type,
        maxTokens:   1200,
        mode:        data.provider && data.model ? "manual" : "smart",
        provider:    data.provider as any,
        model:       data.model as any,
        settings,
        workspaceId,
        sb,
      });

      let scores = { ...defaultScores };
      try {
        const scoringResult = await routeGenerate({
          system: `You are a prompt output evaluator. Score the provided AI output on 5 dimensions from 1-10. Return ONLY valid JSON.`,
          user: `Score this AI output. Context: type="${tpl.type}", audience="${data.inputVariables.target_audience ?? "general"}"

OUTPUT TO SCORE:
${genResult.text.slice(0, 2000)}

Return this JSON (integers 1-10 only):
{"quality":0,"completeness":0,"audience_fit":0,"brand_fit":0,"conversion_potential":0,"overall":0}`,
          contentType: "scoring",
          maxTokens:   120,
          mode:        "manual",
          provider:    "openai",
          model:       "gpt-4o-mini",
          settings,
          workspaceId,
          sb,
        });
        const cleaned = scoringResult.text.replace(/```json|```/g, "").trim();
        const parsed  = JSON.parse(cleaned);
        scores = {
          quality:              Math.min(10, Math.max(1, Number(parsed.quality)              || 7)),
          completeness:         Math.min(10, Math.max(1, Number(parsed.completeness)         || 7)),
          audience_fit:         Math.min(10, Math.max(1, Number(parsed.audience_fit)         || 7)),
          brand_fit:            Math.min(10, Math.max(1, Number(parsed.brand_fit)            || 7)),
          conversion_potential: Math.min(10, Math.max(1, Number(parsed.conversion_potential) || 7)),
          overall:              Math.min(10, Math.max(1, Number(parsed.overall)              || 7)),
        };
      } catch { /* use default scores if scoring fails */ }

      const rowNow = new Date().toISOString();
      const { data: outputRow } = await sb.from("growthmind_prompt_test_outputs").insert({
        workspace_id:    workspaceId,
        template_id:     data.templateId,
        variant_label:   label,
        input_variables: data.inputVariables,
        output_text:     genResult.text,
        scores,
        model_used:      genResult.model,
        provider_used:   genResult.provider,
        cost_usd:        genResult.costUsd,
        created_at:      rowNow,
      }).select("id").maybeSingle();

      return {
        outputId:   outputRow?.id ?? null,
        outputText: genResult.text,
        scores,
        model:      genResult.model,
        provider:   genResult.provider,
        costUsd:    genResult.costUsd,
      };
    }

    // Run variant A always; run variant B in parallel when provided
    const hasVariantB = !!(data.variantBSystemPrompt && data.variantBUserPrompt);
    const [variantA, variantB] = await Promise.all([
      runVariant("A", tpl.system_prompt, tpl.user_prompt_template),
      hasVariantB
        ? runVariant("B", data.variantBSystemPrompt!, data.variantBUserPrompt!)
        : Promise.resolve(null),
    ]);

    // Update stats using variant A scores (A is the template's own prompt)
    const now = new Date().toISOString();
    const { data: existingStats } = await sb.from("growthmind_prompt_stats")
      .select("usage_count, avg_score")
      .eq("template_id", data.templateId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const prevCount = existingStats?.usage_count ?? 0;
    const prevAvg   = existingStats?.avg_score   ?? variantA.scores.overall;
    const newCount  = prevCount + 1;
    const newAvg    = Math.round(((prevAvg * prevCount) + variantA.scores.overall) / newCount * 100) / 100;

    await sb.from("growthmind_prompt_stats").upsert({
      template_id:  data.templateId,
      workspace_id: workspaceId,
      usage_count:  newCount,
      avg_score:    newAvg,
      success_rate: Math.round((variantA.scores.overall / 10) * 100 * 100) / 100,
      last_used_at: now,
      updated_at:   now,
    }, { onConflict: "template_id,workspace_id" });

    return {
      outputId:   variantA.outputId,
      outputText: variantA.outputText,
      scores:     variantA.scores,
      model:      variantA.model,
      provider:   variantA.provider,
      costUsd:    variantA.costUsd,
      variantB:   variantB ? {
        outputText: variantB.outputText,
        scores:     variantB.scores,
        model:      variantB.model,
        provider:   variantB.provider,
        costUsd:    variantB.costUsd,
      } : null,
    };
  });

// ── seedLibraryPacks ───────────────────────────────────────────────────────────

export const seedLibraryPacks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: existing } = await sb.from("growthmind_prompt_templates")
      .select("name")
      .eq("workspace_id", workspaceId)
      .eq("category", "library");

    const existingNames = new Set((existing ?? []).map((r: any) => r.name));

    const toInsert = LIBRARY_PACKS
      .filter(p => !existingNames.has(p.name))
      .map(p => ({
        workspace_id:         workspaceId,
        name:                 p.name,
        description:          p.description,
        type:                 p.type,
        category:             "library",
        system_prompt:        p.systemPrompt,
        user_prompt_template: p.userPromptTemplate,
        variables:            p.variables,
        chain_steps:          p.chainSteps,
        tags:                 p.tags,
        is_active:            true,
        is_favorite:          false,
        created_at:           new Date().toISOString(),
        updated_at:           new Date().toISOString(),
      }));

    if (toInsert.length > 0) {
      const { error } = await sb.from("growthmind_prompt_templates").insert(toInsert);
      if (error) throw new Error(error.message);
    }

    return { seeded: toInsert.length, alreadyExisted: existingNames.size };
  });

// ── recordPromptTemplateUsage ─────────────────────────────────────────────────
// Called by Content Studio after generation to log the output and update stats.

export const recordPromptTemplateUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      templateId:     z.string().uuid(),
      inputVariables: z.record(z.string()).default({}),
      outputText:     z.string(),
      model:          z.string().optional(),
      provider:       z.string().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const now          = new Date().toISOString();
    const defaultScore = 7;
    const scores = {
      quality: defaultScore, completeness: defaultScore, audience_fit: defaultScore,
      brand_fit: defaultScore, conversion_potential: defaultScore, overall: defaultScore,
    };

    await sb.from("growthmind_prompt_test_outputs").insert({
      workspace_id:    workspaceId,
      template_id:     data.templateId,
      variant_label:   "ContentStudio",
      input_variables: data.inputVariables,
      output_text:     data.outputText.slice(0, 10000),
      scores,
      model_used:      data.model    ?? null,
      provider_used:   data.provider ?? null,
      cost_usd:        null,
      created_at:      now,
    });

    const { data: existing } = await sb.from("growthmind_prompt_stats")
      .select("usage_count, avg_score")
      .eq("template_id", data.templateId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const prevCount = existing?.usage_count ?? 0;
    const newCount  = prevCount + 1;
    const prevAvg   = existing?.avg_score   ?? defaultScore;
    const newAvg    = Math.round(((prevAvg * prevCount) + defaultScore) / newCount * 100) / 100;

    await sb.from("growthmind_prompt_stats").upsert({
      template_id:  data.templateId,
      workspace_id: workspaceId,
      usage_count:  newCount,
      avg_score:    newAvg,
      success_rate: Math.round((defaultScore / 10) * 100 * 100) / 100,
      last_used_at: now,
      updated_at:   now,
    }, { onConflict: "template_id,workspace_id" });

    return { ok: true };
  });

// ── getPromptPerformanceSummary ───────────────────────────────────────────────
// Used by HiveMind to show prompt performance insights.

export async function getPromptPerformanceSummary(sb: any, workspaceId: string) {
  try {
    const statsSelect = "template_id, usage_count, avg_score, success_rate, last_used_at, template:growthmind_prompt_templates(name, type, category)";
    const base = () =>
      sb.from("growthmind_prompt_stats")
        .select(statsSelect)
        .eq("workspace_id", workspaceId)
        .gt("usage_count", 0);

    const [bestRes, worstRes, allRes] = await Promise.all([
      base().order("avg_score", { ascending: false }).limit(3),
      base().order("avg_score", { ascending: true  }).limit(3),
      base().order("avg_score", { ascending: false }).limit(200),
    ]);

    if (bestRes.error) return null;

    const mapRow = (r: any) => ({
      name:       r.template?.name ?? "Unknown",
      type:       r.template?.type ?? "content",
      avgScore:   r.avg_score,
      usageCount: r.usage_count,
    });

    const best  = (bestRes.data  ?? []).map(mapRow);
    const worst = (worstRes.data ?? []).map(mapRow);
    const all   = (allRes.data   ?? []) as any[];

    const totalUsage   = all.reduce((s, r) => s + (r.usage_count ?? 0), 0);
    const overallAvg   = all.length > 0
      ? Math.round(all.reduce((s, r) => s + (r.avg_score ?? 0), 0) / all.length * 10) / 10
      : null;
    const lowPerfCount = all.filter(r => (r.avg_score ?? 10) < 3).length;

    return { best, worst, totalUsage, overallAvg, totalTemplates: all.length, lowPerfCount };
  } catch {
    return null;
  }
}
