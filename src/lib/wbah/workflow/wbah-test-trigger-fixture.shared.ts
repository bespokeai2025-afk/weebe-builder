import { wbahWebeeRetellWebhookUrl } from "@/lib/wbah/post-call/wbah-retell-agents.shared";

/** Local dev / ngrok base used to simulate Retell → WEBEE webhook ingress (not legacy n8n). */
export function wbahSimulatedWebhookBaseUrl(): string {
  return (
    process.env.WBAH_TEST_WEBHOOK_BASE_URL?.replace(/\/$/, "") ||
    process.env.WEBEE_PUBLIC_URL?.replace(/\/$/, "") ||
    "http://localhost:5003"
  );
}

/** Default n8n webhook item for Execute step / dry-run when no pin data (Sam Martin fixture). */
export const WBAH_DEFAULT_EXECUTE_TRIGGER: Record<string, unknown> = {
  headers: {
    "content-type": "application/json",
    "user-agent": "axios/1.13.2",
  },
  params: {},
  query: {},
  body: {
    event: "call_analyzed",
    call: {
      call_id: "call_77b8389ca390da95fca6ee41af2",
      call_type: "web_call",
      agent_id: "agent_0440750bb59597eef7352901bf",
      call_status: "ended",
      retell_llm_dynamic_variables: {
        lead_id: "5e2c7b3e-e2df-f011-8543-7ced8d4a8921",
        name: "Sam Martin",
        client_name: "Sam Martin",
        email: "arjavvirani123@gmail.com",
        mobile: "+919096760308",
        bedrooms: "2",
      },
      call_analysis: {
        call_summary:
          "Agent collected Sam Martin's contact and property details, confirmed a consultation booking for 2025-12-30 at 09:10.",
        user_sentiment: "Positive",
        call_successful: true,
        custom_analysis_data: {
          email_address: "arjavvirani123@gmail.com",
          calendly_slot: '{"preferred_slot": { "date": "2025-12-30", "time": "09:10" }}',
          structured_json_output: JSON.stringify({
            verified_details: {
              property_type: "100000010",
              vacant_or_tenanted: "181510000",
              tenure: "279640000",
              floor: "100000002",
              on_market: "181510000",
              new_propinfo_numberofbedrooms: "100000003",
              cos_propertyempty: "181510001",
              cos_sellrentback: "181510000",
              cos_parkhome: "181510000",
              cos_commercial: "181510000",
              cos_tenure: "279640000",
              new_propinfo_howquickly: "100000004",
              new_contact_title: "100000000",
              decision_maker: "true",
              new_propinfo_street2: "Len number 1",
              new_propinfo_city: "Mumbai",
              address1_line1: "Len number 1",
              address1_city: "Mumbai",
              address1_postalcode: "422001",
              new_propinfo_postalcode: "422001",
              firstname: "Sam",
              lastname: "Martin",
              emailaddress1: "arjavvirani123@gmail.com",
              mobilephone: "9096760308",
              new_propinfo_typeofproperty: "100000010",
              new_propinfo_whichfloor: "100000001",
            },
          }),
        },
      },
    },
  },
  webhookUrl: wbahWebeeRetellWebhookUrl(wbahSimulatedWebhookBaseUrl()),
  executionMode: "test",
};

function isRetellPayload(o: Record<string, unknown>): boolean {
  return typeof o.event === "string" && o.call != null && typeof o.call === "object";
}

function isN8nWebhookItem(o: Record<string, unknown>): boolean {
  const body = o.body;
  return body != null && typeof body === "object" && isRetellPayload(body as Record<string, unknown>);
}

/**
 * Normalize pinned / pasted webhook input to the n8n item shape workflows expect:
 * `{ headers?, params?, query?, body: { event, call } }` so `$json.body.*` resolves.
 */
export function normalizeN8nWebhookItem(input: unknown): Record<string, unknown> {
  if (input == null) return {};

  let raw: unknown = input;

  if (Array.isArray(raw)) {
    const first = raw[0];
    if (first && typeof first === "object") {
      const item = first as Record<string, unknown>;
      raw = "json" in item && item.json && typeof item.json === "object" ? item.json : item;
    } else {
      return { value: first };
    }
  } else if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.json && typeof o.json === "object") raw = o.json;
  }

  if (!raw || typeof raw !== "object") {
    return typeof raw === "undefined" ? {} : { value: raw };
  }

  const item = raw as Record<string, unknown>;

  if (isN8nWebhookItem(item)) {
    return item;
  }

  if (isRetellPayload(item)) {
    return {
      headers: { "content-type": "application/json" },
      params: {},
      query: {},
      body: { event: item.event, call: item.call },
      executionMode: "test",
    };
  }

  // Legacy mixed shape from automation engine: { event, call, body: { event, call } }
  if (item.body && typeof item.body === "object" && isRetellPayload(item.body as Record<string, unknown>)) {
    const { event: _topEvent, call: _topCall, body, ...rest } = item;
    return {
      headers: (rest.headers as Record<string, unknown>) ?? {},
      params: (rest.params as Record<string, unknown>) ?? {},
      query: (rest.query as Record<string, unknown>) ?? {},
      body,
      ...rest,
    };
  }

  return item;
}

export function unwrapPinDataToJson(pinData: unknown): Record<string, unknown> {
  if (pinData == null) return {};
  if (Array.isArray(pinData)) {
    const first = pinData[0];
    if (first && typeof first === "object" && "json" in (first as object)) {
      return normalizeN8nWebhookItem((first as { json: unknown }).json);
    }
    return normalizeN8nWebhookItem(pinData);
  }
  if (typeof pinData === "object") {
    const o = pinData as Record<string, unknown>;
    if (o.json && typeof o.json === "object") {
      return normalizeN8nWebhookItem(o.json);
    }
    return normalizeN8nWebhookItem(o);
  }
  return { value: pinData };
}

export function pinItemsFromJson(json: Record<string, unknown>): Array<{ json: Record<string, unknown> }> {
  return [{ json }];
}
