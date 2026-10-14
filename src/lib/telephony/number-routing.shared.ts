/**
 * Per-number call routing, the way Retell configures a phone number:
 *
 *   - inbound / outbound agents, each a weighted list (Retell's A/B testing),
 *   - an inbound webhook that can reject the call, swap the agent and pass dynamic variables,
 *   - allowed inbound / outbound countries,
 *   - a fallback number for when no agent can take the call.
 *
 * Pure functions only — the inbound route, the outbound dialer and the settings UI all share them.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

export interface AgentWeight {
  agent_id: string;
  weight: number;
}

/** The routing fields of a `phone_numbers` row. */
export interface NumberRoutingRow {
  agent_id?: string | null;
  inbound_agents?: unknown;
  outbound_agents?: unknown;
  inbound_webhook_url?: string | null;
  fallback_number?: string | null;
  allowed_inbound_countries?: string[] | null;
  allowed_outbound_countries?: string[] | null;
}

// ── Weighted agents ──────────────────────────────────────────────────────────

/** Valid entries only, weights scaled to sum to 1. Empty when there is nothing usable. */
export function normaliseAgentWeights(value: unknown): AgentWeight[] {
  if (!Array.isArray(value)) return [];
  const clean: AgentWeight[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const agentId = String((item as { agent_id?: unknown }).agent_id ?? "").trim();
    const weight = Number((item as { weight?: unknown }).weight);
    if (!agentId || seen.has(agentId) || !Number.isFinite(weight) || weight <= 0) continue;
    seen.add(agentId);
    clean.push({ agent_id: agentId, weight });
  }
  const total = clean.reduce((sum, a) => sum + a.weight, 0);
  if (total <= 0) return [];
  return clean.map((a) => ({ agent_id: a.agent_id, weight: a.weight / total }));
}

/** Pick one agent by weight. `rand` is injectable so tests are deterministic. */
export function pickWeightedAgent(
  weights: AgentWeight[],
  rand: () => number = Math.random,
): string | null {
  if (weights.length === 0) return null;
  let roll = rand();
  for (const a of weights) {
    if (roll < a.weight) return a.agent_id;
    roll -= a.weight;
  }
  return weights[weights.length - 1]!.agent_id;
}

/** The agent that answers this call: the weighted inbound list, else the number's assigned agent. */
export function chooseInboundAgent(row: NumberRoutingRow, rand?: () => number): string | null {
  return pickWeightedAgent(normaliseAgentWeights(row.inbound_agents), rand) ?? (row.agent_id || null);
}

/** The agent that places calls from this number: the outbound list, else the assigned agent. */
export function chooseOutboundAgent(row: NumberRoutingRow, rand?: () => number): string | null {
  return pickWeightedAgent(normaliseAgentWeights(row.outbound_agents), rand) ?? (row.agent_id || null);
}

/** Every agent a number can route to in a direction (for "is this agent on this number?"). */
export function agentsOnNumber(row: NumberRoutingRow, direction: "inbound" | "outbound"): string[] {
  const list = normaliseAgentWeights(direction === "inbound" ? row.inbound_agents : row.outbound_agents);
  if (list.length) return list.map((a) => a.agent_id);
  return row.agent_id ? [row.agent_id] : [];
}

// ── Countries ────────────────────────────────────────────────────────────────

const NANP = [
  "US", "CA", "AG", "AI", "AS", "BB", "BM", "BS", "DM", "DO", "GD", "GU", "JM", "KN", "KY", "LC",
  "MP", "MS", "PR", "SX", "TC", "TT", "VC", "VG", "VI",
];

/** ITU calling code → ISO 3166-1 alpha-2 countries that share it. */
const CALLING_CODES: Record<string, string[]> = {
  "1": NANP, "7": ["RU", "KZ"], "20": ["EG"], "27": ["ZA"], "30": ["GR"], "31": ["NL"], "32": ["BE"],
  "33": ["FR"], "34": ["ES"], "36": ["HU"], "39": ["IT", "VA"], "40": ["RO"], "41": ["CH"], "43": ["AT"],
  "44": ["GB", "GG", "JE", "IM"], "45": ["DK"], "46": ["SE"], "47": ["NO", "SJ"], "48": ["PL"], "49": ["DE"],
  "51": ["PE"], "52": ["MX"], "53": ["CU"], "54": ["AR"], "55": ["BR"], "56": ["CL"], "57": ["CO"],
  "58": ["VE"], "60": ["MY"], "61": ["AU", "CX", "CC"], "62": ["ID"], "63": ["PH"], "64": ["NZ"],
  "65": ["SG"], "66": ["TH"], "81": ["JP"], "82": ["KR"], "84": ["VN"], "86": ["CN"], "90": ["TR"],
  "91": ["IN"], "92": ["PK"], "93": ["AF"], "94": ["LK"], "95": ["MM"], "98": ["IR"],
  "211": ["SS"], "212": ["MA", "EH"], "213": ["DZ"], "216": ["TN"], "218": ["LY"], "220": ["GM"],
  "221": ["SN"], "222": ["MR"], "223": ["ML"], "224": ["GN"], "225": ["CI"], "226": ["BF"], "227": ["NE"],
  "228": ["TG"], "229": ["BJ"], "230": ["MU"], "231": ["LR"], "232": ["SL"], "233": ["GH"], "234": ["NG"],
  "235": ["TD"], "236": ["CF"], "237": ["CM"], "238": ["CV"], "239": ["ST"], "240": ["GQ"], "241": ["GA"],
  "242": ["CG"], "243": ["CD"], "244": ["AO"], "245": ["GW"], "246": ["IO"], "248": ["SC"], "249": ["SD"],
  "250": ["RW"], "251": ["ET"], "252": ["SO"], "253": ["DJ"], "254": ["KE"], "255": ["TZ"], "256": ["UG"],
  "257": ["BI"], "258": ["MZ"], "260": ["ZM"], "261": ["MG"], "262": ["RE", "YT"], "263": ["ZW"],
  "264": ["NA"], "265": ["MW"], "266": ["LS"], "267": ["BW"], "268": ["SZ"], "269": ["KM"], "290": ["SH"],
  "291": ["ER"], "297": ["AW"], "298": ["FO"], "299": ["GL"], "350": ["GI"], "351": ["PT"], "352": ["LU"],
  "353": ["IE"], "354": ["IS"], "355": ["AL"], "356": ["MT"], "357": ["CY"], "358": ["FI", "AX"],
  "359": ["BG"], "370": ["LT"], "371": ["LV"], "372": ["EE"], "373": ["MD"], "374": ["AM"], "375": ["BY"],
  "376": ["AD"], "377": ["MC"], "378": ["SM"], "380": ["UA"], "381": ["RS"], "382": ["ME"], "383": ["XK"],
  "385": ["HR"], "386": ["SI"], "387": ["BA"], "389": ["MK"], "420": ["CZ"], "421": ["SK"], "423": ["LI"],
  "500": ["FK"], "501": ["BZ"], "502": ["GT"], "503": ["SV"], "504": ["HN"], "505": ["NI"], "506": ["CR"],
  "507": ["PA"], "508": ["PM"], "509": ["HT"], "590": ["GP", "BL", "MF"], "591": ["BO"], "592": ["GY"],
  "593": ["EC"], "594": ["GF"], "595": ["PY"], "596": ["MQ"], "597": ["SR"], "598": ["UY"],
  "599": ["CW", "BQ"], "670": ["TL"], "672": ["NF"], "673": ["BN"], "674": ["NR"], "675": ["PG"],
  "676": ["TO"], "677": ["SB"], "678": ["VU"], "679": ["FJ"], "680": ["PW"], "681": ["WF"], "682": ["CK"],
  "683": ["NU"], "685": ["WS"], "686": ["KI"], "687": ["NC"], "688": ["TV"], "689": ["PF"], "690": ["TK"],
  "691": ["FM"], "692": ["MH"], "850": ["KP"], "852": ["HK"], "853": ["MO"], "855": ["KH"], "856": ["LA"],
  "880": ["BD"], "886": ["TW"], "960": ["MV"], "961": ["LB"], "962": ["JO"], "963": ["SY"], "964": ["IQ"],
  "965": ["KW"], "966": ["SA"], "967": ["YE"], "968": ["OM"], "970": ["PS"], "971": ["AE"], "972": ["IL"],
  "973": ["BH"], "974": ["QA"], "975": ["BT"], "976": ["MN"], "977": ["NP"], "992": ["TJ"], "993": ["TM"],
  "994": ["AZ"], "995": ["GE"], "996": ["KG"], "998": ["UZ"],
};

/**
 * Countries an E.164 number may belong to (longest calling-code match). Codes are shared by
 * several countries (+1 is the whole NANP, +44 includes Jersey and Guernsey), so this returns
 * every candidate; empty when the number isn't recognisable.
 */
export function countriesForE164(phone: string | null | undefined): string[] {
  const digits = String(phone ?? "").trim().replace(/^\+/, "").replace(/\D/g, "");
  if (!digits) return [];
  for (let len = 3; len >= 1; len--) {
    const hit = CALLING_CODES[digits.slice(0, len)];
    if (hit) return hit;
  }
  return [];
}

/** The ITU calling code an international number starts with ("971" for +971…), or null. */
export function callingCodeOf(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").trim().replace(/^\+/, "").replace(/\D/g, "");
  if (!digits) return null;
  for (let len = 3; len >= 1; len--) {
    const code = digits.slice(0, len);
    if (CALLING_CODES[code]) return code;
  }
  return null;
}

export function normaliseCountryList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((c) => String(c ?? "").trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c)),
    ),
  ];
}

/**
 * Whether a call to/from a country is allowed. An empty allow-list means "no restriction", as in
 * Retell. With a list, an unrecognisable number is refused rather than let through.
 */
export function isCountryAllowed(allowed: unknown, candidates: string[]): boolean {
  const list = normaliseCountryList(allowed);
  if (list.length === 0) return true;
  return candidates.some((c) => list.includes(c.toUpperCase()));
}

// ── Inbound webhook (Retell format) ──────────────────────────────────────────

export interface InboundWebhookPayload {
  event: "call_inbound";
  call_inbound: {
    call_id: string;
    agent_id: string | null;
    agent_version: null;
    from_number: string;
    to_number: string;
  };
}

export function buildInboundWebhookPayload(args: {
  callId: string;
  agentId: string | null;
  fromNumber: string;
  toNumber: string;
}): InboundWebhookPayload {
  return {
    event: "call_inbound",
    call_inbound: {
      call_id: args.callId,
      agent_id: args.agentId,
      agent_version: null,
      from_number: args.fromNumber,
      to_number: args.toNumber,
    },
  };
}

export interface InboundWebhookDecision {
  reject: boolean;
  overrideAgentId: string | null;
  dynamicVariables: Record<string, string>;
  metadata: Record<string, unknown>;
}

/**
 * Read a webhook reply. Accepts Retell's shape (`{ call_inbound: { … } }`) and the same fields at the
 * top level. Dynamic variables are coerced to strings, as Retell requires; anything malformed is
 * ignored rather than failing the call.
 */
export function parseInboundWebhookResponse(body: unknown): InboundWebhookDecision {
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const inner =
    root.call_inbound && typeof root.call_inbound === "object"
      ? (root.call_inbound as Record<string, unknown>)
      : root;
  const dynamicVariables: Record<string, string> = {};
  const dv = inner.dynamic_variables;
  if (dv && typeof dv === "object" && !Array.isArray(dv)) {
    for (const [k, v] of Object.entries(dv as Record<string, unknown>)) {
      if (!k.trim() || v === null || v === undefined) continue;
      if (typeof v === "object") continue;
      dynamicVariables[k.trim()] = String(v);
    }
  }
  const md = inner.metadata;
  const override = String(inner.override_agent_id ?? "").trim();
  return {
    reject: inner.reject === true,
    overrideAgentId: override || null,
    dynamicVariables,
    metadata: md && typeof md === "object" && !Array.isArray(md) ? (md as Record<string, unknown>) : {},
  };
}

// ── Validation for the settings form ─────────────────────────────────────────

export const E164 = /^\+[1-9]\d{6,14}$/;

/** Problem with a weighted agent list as entered, or null. Weights may be percentages or fractions. */
export function validateAgentWeights(list: Array<{ agent_id: string; weight: number }>): string | null {
  if (list.length === 0) return null;
  const ids = list.map((a) => a.agent_id);
  if (ids.some((id) => !id)) return "Choose an agent for every row.";
  if (new Set(ids).size !== ids.length) return "Each agent can appear only once.";
  if (list.some((a) => !Number.isFinite(a.weight) || a.weight <= 0)) {
    return "Every weight must be more than 0.";
  }
  return null;
}

export function validateWebhookUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Enter a full URL, starting with https://";
  }
  if (parsed.protocol !== "https:") return "The webhook must use https://";
  return null;
}
