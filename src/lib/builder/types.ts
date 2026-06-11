export type NodeKind =
  | "conversation"
  | "function"
  | "call_transfer"
  | "press_digit"
  | "logic_split"
  | "agent_transfer"
  | "sms"
  | "extract_variable"
  | "code"
  | "ending"
  | "note";

export interface Transition {
  id: string;
  condition: string;
  target: string | null;
}

export interface FlowNodeData {
  kind: NodeKind;
  label: string;
  /** Prompt / instruction text for the node */
  dialogue: string;
  /** Mark this node as the start_node_id in the exported flow */
  isStart?: boolean;
  /** For conversation start nodes — who speaks first */
  startSpeaker?: "agent" | "user";
  /** For conversation nodes — static vs prompt instruction */
  instructionType?: "prompt" | "static_text";
  /** For function nodes */
  toolId?: string;
  speakDuringExecution?: boolean;
  waitForResult?: boolean;
  /** Display name for the tool (Retell-style) */
  toolName?: string;
  /** Description of what the tool does */
  toolDescription?: string;
  /** Cal.com per-tool API key override (defaults to workspace) */
  toolApiKey?: string;
  /** Cal.com per-tool Event Type ID override (defaults to workspace) */
  toolEventTypeId?: string;
  /** IANA timezone for this tool (defaults to workspace) */
  toolTimezone?: string;
  /** For call_transfer */
  transferNumber?: string;
  /** Static phone/SIP URI vs dynamic variable reference */
  transferMode?: "static" | "dynamic";
  /** Dynamic variable name (without braces) when transferMode === "dynamic" */
  transferDynamicVariable?: string;
  /** Cold = immediate, warm = one-way brief, agentic = two-way handoff */
  transferType?: "cold_transfer" | "warm_transfer" | "agentic_warm_transfer" | "warm_handoff";
  /** SIP signaling method for cold transfer */
  sipTransferMethod?: "sip_invite" | "sip_refer";
  /** Displayed caller ID; exported as transfer_option.show_transferee_as_caller */
  callerIdMode?: "agent" | "user";
  /** Transfer ring duration in seconds (1-120) */
  transferRingDurationSec?: number;
  /** Extension number to dial after connect */
  transferExtensionNumber?: string;
  /** Skip E.164 validation (SIP URIs etc.) */
  ignoreE164Validation?: boolean;
  /** Show transferee as caller (caller ID passthrough) */
  showTransfereeAsCaller?: boolean;
  /** Custom SIP headers (key/value) */
  customSipHeaders?: Record<string, string>;
  /** Warm/agentic handoff prompt to brief the human agent */
  warmHandoffPrompt?: string;
  /** Warm transfer private whisper prompt to the destination agent */
  privateHandoffPrompt?: string;
  /** Warm transfer IVR navigation prompt */
  ivrPrompt?: string;
  /** Disable warm-transfer human detection */
  optOutHumanDetection?: boolean;
  /** Agentic warm transfer destination agent */
  transferAgentId?: string;
  /** Agentic warm transfer destination agent version */
  transferAgentVersion?: string;
  /** Agentic warm transfer decision timeout in seconds */
  transferTimeoutSec?: number;
  /** Agentic timeout behavior */
  transferTimeoutAction?: "bridge_transfer" | "cancel_transfer";
  /** Agent-swap: keep source agent's voice on the new agent */
  agentSwapKeepCurrentVoice?: boolean;
  /** Agent-swap: keep source agent's language on the new agent */
  agentSwapKeepCurrentLanguage?: boolean;
  /** Agent-swap: which agent's post-call analysis fields to include */
  agentSwapPostCallAnalysisSetting?: "only_destination_agent" | "all";
  /** Agent-swap: which agent's webhook receives call updates */
  agentSwapWebhookSetting?: "only_source_agent" | "only_destination_agent" | "all";
  /** For press_digit */
  pauseDetectionMs?: number;
  /** For logic_split — array of branches lives in transitions */
  /** For sms */
  smsMessage?: string;
  /** For extract_variable */
  variableName?: string;
  variableDescription?: string;
  /** For code */
  codeSource?: string;
  /** For ending */
  endingPrompt?: string;
  /** Outgoing transitions */
  transitions: Transition[];
  /** Dashboard `is_global` — allow other nodes to jump here without an explicit edge. */
  isGlobalNode?: boolean;
  /** Per-node global_node_setting overrides (voice speed, eagerness, interruption, LLM, etc.) */
  globalNodeSetting?: Record<string, unknown>;
  /** Raw node object from imported JSON — round-tripped on export so dashboard-only fields survive. */
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BuilderSettings {
  agentName: string;
  companyName?: string;
  globalPrompt: string;
  beginMessage: string;
  model: string;
  voiceId: string;
  language: string;
  /** BCP-47 codes selected in the language picker. "multi" = Flex Mode.
   *  Single item → sent as string; multiple items → sent as array (multilingual). */
  speechLanguages?: string[];
  temperature: number;
  /** webhook + misc agent options to round-trip into the exported agent JSON */
  webhookUrl?: string;
  /** Transition flexibility: 'flex' or 'strict' */
  transitionFlexibility?: "flex" | "strict";
  /** start speaker for the whole flow */
  startSpeaker?: "agent" | "user";
  beginAfterUserSilenceMs?: number;
  /** Stable IDs so re-imports update the same agent/flow */
  conversationFlowId?: string;
  agentId?: string;
  /** The agent name at the time it was last deployed. A name change triggers a new agent creation. */
  deployedAgentName?: string;
  /** Agent Handbook config toggles */
  handbookEchoVerification?: boolean;
  handbookSpeechNormalization?: boolean;
  handbookDefaultPersonality?: boolean;
  handbookScopeBoundaries?: boolean;
  handbookNaturalFillerWords?: boolean;
  handbookNatoPhoneticAlphabet?: boolean;
  handbookHighEmpathy?: boolean;
  handbookAiDisclosure?: boolean;
  handbookSmartMatching?: boolean;
  /** Voice / call tuning */
  voiceSpeed?: number;
  voiceTemperature?: number;
  volume?: number;
  responsiveness?: number;
  voiceEmotion?:
    | "calm"
    | "sympathetic"
    | "happy"
    | "sad"
    | "angry"
    | "fearful"
    | "surprised"
    | "none";
  interruptionSensitivity?: number;
  enableBackchannel?: boolean;
  backchannelFrequency?: number;
  backchannelWords?: string[];
  reminderTriggerMs?: number;
  reminderMaxCount?: number;
  ambientSound?:
    | "none"
    | "coffee-shop"
    | "convention-hall"
    | "summer-outdoor"
    | "mountain-outdoor"
    | "static-noise"
    | "call-center";
  ambientSoundVolume?: number;
  boostedKeywords?: string[];
  pronunciationDictionary?: { word: string; alphabet: "ipa" | "cmu"; phoneme: string }[];
  endCallAfterSilenceMs?: number;
  beginMessageDelayMs?: number;
  sttMode?: "fast" | "accurate" | "custom";
  vocabSpecialization?: "general" | "medical";
  allowUserDtmf?: boolean;
  allowDtmfInterruption?: boolean;
  denoisingMode?: "no-denoise" | "noise-cancellation" | "noise-and-background-speech-cancellation";
  maxCallDurationMs?: number;
  ringDurationMs?: number;
  enableDynamicVoiceSpeed?: boolean;
  enableDynamicResponsiveness?: boolean;
  normalizeForSpeech?: boolean;
  /**
   * Per-agent booking / calendar override. When `enabled` is false, booking
   * tools are NOT auto-attached on deploy even if Cal.com is connected at the
   * workspace level. `eventTypeId` overrides the workspace default for this
   * specific agent. `instructions` is appended to the agent's global prompt
   * on deploy so the LLM knows your booking rules.
   */
  booking?: {
    enabled?: boolean;
    instructions?: string;
    eventTypeId?: string;
    /**
     * Per-agent working hours override (IANA-tz-naive HH:MM ranges per weekday).
     * When set, these are appended to booking instructions so the LLM only
     * offers slots within them. Falls back to workspace working_hours when unset.
     */
    workingHours?: {
      mon?: Array<[string, string]>;
      tue?: Array<[string, string]>;
      wed?: Array<[string, string]>;
      thu?: Array<[string, string]>;
      fri?: Array<[string, string]>;
      sat?: Array<[string, string]>;
      sun?: Array<[string, string]>;
    };
  };
  /** Raw agent JSON (without conversationFlow) round-tripped from import. */
  rawAgent?: Record<string, unknown>;
  /** Raw conversationFlow object (without nodes) round-tripped from import. */
  rawConversationFlow?: Record<string, unknown>;
  /**
   * Intended deployment type — controls which builder sections are visible.
   * Set here in the builder and mirrored as dashboardAgentType on Go Live.
   */
  agentType?: "lead_generation" | "receptionist" | "client_qualification";
  /**
   * Voice infrastructure provider. Defaults to "RETELL" for all new agents.
   * "OPENAI_REALTIME" routes through the in-house OpenAI Realtime microservice.
   *
   * @deprecated Prefer deploymentMode. This field is preserved for backward
   * compatibility with existing agents and is read by resolveDeploymentMode()
   * as a legacy fallback. Never remove or rename it.
   */
  voiceProvider?: "RETELL" | "OPENAI_REALTIME";
  /**
   * New unified deployment mode. When set, takes precedence over voiceProvider.
   * All existing agents will have this resolved to "RETELL" by the adapter even
   * if the field is absent (adapter fallback logic handles this).
   * Set by the Builder when the user explicitly chooses a runtime.
   */
  deploymentMode?: "RETELL" | "OPENAI_NATIVE" | "CLAUDE_NATIVE" | "GEMINI_NATIVE";
  /** OpenAI Realtime voice profile (only used when deploymentMode === "OPENAI_NATIVE") */
  openaiVoice?: "alloy" | "ash" | "ballad" | "coral" | "echo" | "shimmer" | "sage" | "verse" | "marine";
  /** OpenAI Realtime reasoning effort level (only used when deploymentMode === "OPENAI_NATIVE") */
  openaiReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  /**
   * OpenAI Realtime model ID (only used when deploymentMode === "OPENAI_NATIVE").
   * Defaults to "gpt-4o-realtime-preview" when unset.
   * Valid values: "gpt-4o-realtime-preview" | "gpt-4o-mini-realtime-preview"
   */
  openaiRealtimeModel?: string;
  /**
   * Maximum number of call attempts per data record per calendar day.
   * Only enforced when the agent is live (has deployedRetellAgentId).
   */
  maxDailyAttempts?: number;
  /**
   * Lead Generation module config. Only used when agentType === "lead_generation".
   * Variable mappings, campaign name, and intelligence toggles live here.
   */
  leadGen?: {
    campaignName?: string;
    campaignId?: string;
    /** Maps {{placeholder}} → data_records column name (pre-call injection) */
    variableMappings?: Record<string, string>;
    /**
     * Post-call variable mapping: custom variable name → lead field to write.
     * e.g. { "company_name": "meta.company_name", "budget": "meta.budget" }
     */
    postCallMappings?: Record<string, string>;
    /**
     * Custom scoring rules — each adds points to lead_score when the
     * post-call variable has a truthy value.
     */
    customScoringRules?: Array<{ variable: string; points: number }>;
    autoUpdateLead?: boolean;
    writeCampaignMetrics?: boolean;
    trackInterestLevel?: boolean;
    trackBuyingIntent?: boolean;
    trackLeadScore?: boolean;
    trackObjections?: boolean;
    trackNextAction?: boolean;
    trackMeetingRequested?: boolean;
    trackCallbackRequested?: boolean;
    trackDecisionMaker?: boolean;
    [key: string]: unknown;
  };
  /**
   * Client Qualification module config. Only used when agentType === "client_qualification".
   */
  qualify?: {
    leadSource?: "data_section" | "leads_section";
    /**
     * Pre-call mapping: {{placeholder}} → leads table field (when leadSource = leads_section).
     * e.g. { "full_name": "full_name", "company": "company_name" }
     */
    preCallMappings?: Record<string, string>;
    /**
     * Post-call variable mapping: custom variable name → lead field to write.
     */
    postCallMappings?: Record<string, string>;
    /**
     * Custom scoring rules — adds to qualification_score when variable is truthy.
     */
    customScoringRules?: Array<{ variable: string; points: number }>;
    trackBudget?: boolean;
    trackDecisionMaker?: boolean;
    trackUrgency?: boolean;
    trackInterestLevel?: boolean;
    trackFollowUp?: boolean;
    trackBusinessSize?: boolean;
    trackLocation?: boolean;
    trackCurrentProvider?: boolean;
    route_positive?: string;
    route_neutral?: string;
    route_negative?: string;
    autoRoute?: boolean;
    [key: string]: unknown;
  };
}

export interface BuilderVariable {
  name: string;
  description: string;
  /** post_call_analysis_data type. Defaults to string. */
  type?: "string" | "number" | "boolean" | "enum" | "system-presets";
  /** UI legacy field; exported as a single example when present. */
  defaultValue: string;
  examples?: string[];
}
