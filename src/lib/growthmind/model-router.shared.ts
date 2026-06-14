export type Provider = "openai" | "gemini" | "claude";

export type ModelId =
  | "gpt-4.1"
  | "gpt-4.1-mini"
  | "gemini-2.5-flash"
  | "gemini-2.5-pro"
  | "claude-sonnet-4-5";

export type QualityTier = "premium" | "good";

export type ModelMeta = {
  id:       ModelId;
  label:    string;
  provider: Provider;
  bestFor:  string;
  speed:    string;
  cost:     string;
  tier:     QualityTier;
};

export const MODEL_META: Record<ModelId, ModelMeta> = {
  "gpt-4.1": {
    id:       "gpt-4.1",
    label:    "GPT-4.1",
    provider: "openai",
    bestFor:  "AI call scripts, complex reasoning",
    speed:    "Moderate",
    cost:     "$$$",
    tier:     "premium",
  },
  "gpt-4.1-mini": {
    id:       "gpt-4.1-mini",
    label:    "GPT-4.1 Mini",
    provider: "openai",
    bestFor:  "WhatsApp, review & referral campaigns",
    speed:    "Fast",
    cost:     "$",
    tier:     "good",
  },
  "gemini-2.5-flash": {
    id:       "gemini-2.5-flash",
    label:    "Gemini 2.5 Flash",
    provider: "gemini",
    bestFor:  "Google Ads, social posts, quick content",
    speed:    "Very Fast",
    cost:     "¢",
    tier:     "good",
  },
  "gemini-2.5-pro": {
    id:       "gemini-2.5-pro",
    label:    "Gemini 2.5 Pro",
    provider: "gemini",
    bestFor:  "Blog articles, strategies, reports, analysis",
    speed:    "Moderate",
    cost:     "$$",
    tier:     "premium",
  },
  "claude-sonnet-4-5": {
    id:       "claude-sonnet-4-5",
    label:    "Claude Sonnet 4",
    provider: "claude",
    bestFor:  "Emails, landing pages, video scripts, sales copy",
    speed:    "Fast",
    cost:     "$$$",
    tier:     "premium",
  },
};

export const PROVIDERS: { id: Provider; label: string; models: ModelId[] }[] = [
  { id: "openai", label: "OpenAI",  models: ["gpt-4.1", "gpt-4.1-mini"]              },
  { id: "gemini", label: "Gemini",  models: ["gemini-2.5-pro", "gemini-2.5-flash"]   },
  { id: "claude", label: "Claude",  models: ["claude-sonnet-4-5"]                     },
];

// Smart routing: content type → optimal provider + model
export const SMART_ROUTING: Record<string, { provider: Provider; model: ModelId }> = {
  // Video types — strategy step uses Gemini 2.5 Pro; script step always uses Claude Sonnet 4
  meta_video_ad:           { provider: "gemini",  model: "gemini-2.5-pro"    },
  linkedin_video:          { provider: "gemini",  model: "gemini-2.5-pro"    },
  tiktok_video:            { provider: "gemini",  model: "gemini-2.5-pro"    },
  explainer_video:         { provider: "gemini",  model: "gemini-2.5-pro"    },
  ugc_ad:                  { provider: "gemini",  model: "gemini-2.5-pro"    },
  product_demo:            { provider: "gemini",  model: "gemini-2.5-pro"    },
  youtube_short:           { provider: "gemini",  model: "gemini-2.5-pro"    },
  youtube_ad:              { provider: "gemini",  model: "gemini-2.5-pro"    },
  case_study_video:        { provider: "gemini",  model: "gemini-2.5-pro"    },
  testimonial_video:       { provider: "gemini",  model: "gemini-2.5-pro"    },
  webinar_clip:            { provider: "gemini",  model: "gemini-2.5-pro"    },
  podcast_clip:            { provider: "gemini",  model: "gemini-2.5-pro"    },
  receptionist_demo:       { provider: "gemini",  model: "gemini-2.5-pro"    },
  // Text content types
  blog_article:            { provider: "gemini",  model: "gemini-2.5-pro"    },
  landing_page:            { provider: "claude",  model: "claude-sonnet-4-5" },
  google_ad:               { provider: "gemini",  model: "gemini-2.5-flash"  },
  meta_ad:                 { provider: "claude",  model: "claude-sonnet-4-5" },
  linkedin_post:           { provider: "gemini",  model: "gemini-2.5-flash"  },
  facebook_post:           { provider: "gemini",  model: "gemini-2.5-flash"  },
  instagram_caption:       { provider: "gemini",  model: "gemini-2.5-flash"  },
  x_post:                  { provider: "gemini",  model: "gemini-2.5-flash"  },
  email_campaign:          { provider: "claude",  model: "claude-sonnet-4-5" },
  whatsapp_campaign:       { provider: "openai",  model: "gpt-4.1-mini"      },
  lead_magnet:             { provider: "gemini",  model: "gemini-2.5-pro"    },
  case_study:              { provider: "gemini",  model: "gemini-2.5-pro"    },
  video_script:            { provider: "claude",  model: "claude-sonnet-4-5" },
  vsl_script:              { provider: "claude",  model: "claude-sonnet-4-5" },
  podcast_script:          { provider: "gemini",  model: "gemini-2.5-pro"    },
  ai_call_script:          { provider: "openai",  model: "gpt-4.1"           },
  follow_up_sequence:      { provider: "claude",  model: "claude-sonnet-4-5" },
  review_request_campaign: { provider: "openai",  model: "gpt-4.1-mini"      },
  referral_campaign:       { provider: "openai",  model: "gpt-4.1-mini"      },
  sales_letter:            { provider: "claude",  model: "claude-sonnet-4-5" },
};

// Fallback: if primary model fails, use this
export const FALLBACK: Record<ModelId, { provider: Provider; model: ModelId }> = {
  "gemini-2.5-pro":    { provider: "openai",  model: "gpt-4.1"           },
  "claude-sonnet-4-5": { provider: "openai",  model: "gpt-4.1"           },
  "gemini-2.5-flash":  { provider: "openai",  model: "gpt-4.1-mini"      },
  "gpt-4.1":           { provider: "gemini",  model: "gemini-2.5-pro"    },
  "gpt-4.1-mini":      { provider: "gemini",  model: "gemini-2.5-flash"  },
};

// Cost per 1 million tokens (USD)
export const TOKEN_COSTS: Record<ModelId, { input: number; output: number }> = {
  "gpt-4.1":           { input: 2.00,  output: 8.00  },
  "gpt-4.1-mini":      { input: 0.40,  output: 1.60  },
  "gemini-2.5-flash":  { input: 0.075, output: 0.30  },
  "gemini-2.5-pro":    { input: 1.25,  output: 10.00 },
  "claude-sonnet-4-5": { input: 3.00,  output: 15.00 },
};

export function calcCostUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const costs = TOKEN_COSTS[model];
  if (!costs) return 0;
  return (inputTokens / 1_000_000) * costs.input + (outputTokens / 1_000_000) * costs.output;
}

export function getSmartRoute(contentType: string): { provider: Provider; model: ModelId } {
  return SMART_ROUTING[contentType] ?? { provider: "gemini", model: "gemini-2.5-pro" };
}
