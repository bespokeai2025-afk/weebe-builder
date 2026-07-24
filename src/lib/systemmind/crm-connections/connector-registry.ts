// ── CRM connector registry (Task #457) ────────────────────────────────────────
// One entry per supported CRM: guided credential field metadata (drives the
// connection UI) + the connector builder. Adding a CRM = one connector file +
// one entry here. Field metadata is NON-SECRET (labels/help text only).
//
// NOTE: this module is imported by server code AND by the UI for field
// metadata — it must not import server-only modules at top level. Builders
// that need server access (webee) are loaded lazily inside buildConnector.

import type { CrmConnector } from "./contract";

export type CredFieldType = "secret" | "text" | "url" | "select";

export interface CredFieldSpec {
  key: string;
  label: string;
  type: CredFieldType;
  required: boolean;
  help: string;
  placeholder?: string;
  options?: string[];
}

export interface ConnectorRegistryEntry {
  provider: string;
  label: string;
  /** Matching crm-definitions registry name (descriptive docs), when one exists. */
  definitionName: string | null;
  description: string;
  supportsDiscovery: boolean;
  supportsOAuthRefresh: boolean;
  fields: CredFieldSpec[];
}

export const CRM_CONNECTOR_REGISTRY: ConnectorRegistryEntry[] = [
  {
    provider: "hubspot", label: "HubSpot", definitionName: "hubspot",
    description: "Connect with a Private App access token.",
    supportsDiscovery: true, supportsOAuthRefresh: false,
    fields: [
      { key: "apiKey", label: "Private App Token", type: "secret", required: true,
        help: "HubSpot → Settings → Integrations → Private Apps → create an app with crm.objects.contacts read/write scopes, then copy its access token." },
    ],
  },
  {
    provider: "salesforce", label: "Salesforce", definitionName: "salesforce",
    description: "Connect with an instance URL and OAuth access token; add a refresh token for automatic renewal.",
    supportsDiscovery: true, supportsOAuthRefresh: true,
    fields: [
      { key: "instanceUrl", label: "Instance URL", type: "url", required: true,
        help: "Your org's My Domain URL, e.g. https://yourcompany.my.salesforce.com.", placeholder: "https://yourcompany.my.salesforce.com" },
      { key: "accessToken", label: "Access Token", type: "secret", required: true,
        help: "OAuth access token from a Connected App (or a session token for testing)." },
      { key: "refreshToken", label: "Refresh Token", type: "secret", required: false,
        help: "Optional — with Client ID + Secret, WEBEE renews expired access tokens automatically." },
      { key: "clientId", label: "Client ID (Consumer Key)", type: "text", required: false,
        help: "Connected App Consumer Key — required only for automatic token refresh." },
      { key: "clientSecret", label: "Client Secret (Consumer Secret)", type: "secret", required: false,
        help: "Connected App Consumer Secret — required only for automatic token refresh." },
      { key: "loginUrl", label: "Login URL", type: "url", required: false,
        help: "Defaults to https://login.salesforce.com; use https://test.salesforce.com for sandboxes." },
    ],
  },
  {
    provider: "pipedrive", label: "Pipedrive", definitionName: "pipedrive",
    description: "Connect with a personal API token.",
    supportsDiscovery: true, supportsOAuthRefresh: false,
    fields: [
      { key: "apiToken", label: "API Token", type: "secret", required: true,
        help: "Pipedrive → Personal preferences → API → copy your personal API token." },
    ],
  },
  {
    provider: "gohighlevel", label: "GoHighLevel", definitionName: "gohighlevel",
    description: "Connect with an agency/location API key and the Location ID.",
    supportsDiscovery: true, supportsOAuthRefresh: false,
    fields: [
      { key: "apiKey", label: "API Key", type: "secret", required: true,
        help: "GoHighLevel → Settings → Business Profile / API Keys → Location-level API key (Private Integration token)." },
      { key: "locationId", label: "Location ID", type: "text", required: true,
        help: "The sub-account (location) ID found in Settings → Business Profile." },
    ],
  },
  {
    provider: "dynamics", label: "Microsoft Dynamics 365", definitionName: "dynamics",
    description: "Connect via an Azure AD app registration (client credentials — tokens are minted automatically on every request, no manual refresh needed).",
    supportsDiscovery: true, supportsOAuthRefresh: false,
    fields: [
      { key: "tenantId", label: "Tenant ID", type: "text", required: true,
        help: "Azure Active Directory tenant (directory) ID." },
      { key: "clientId", label: "Client ID", type: "text", required: true,
        help: "Application (client) ID of your Azure app registration with Dynamics permissions." },
      { key: "clientSecret", label: "Client Secret", type: "secret", required: true,
        help: "Client secret created under the app registration → Certificates & secrets." },
      { key: "orgUrl", label: "Organization URL", type: "url", required: true,
        help: "Your Dynamics environment URL, e.g. https://yourorg.crm.dynamics.com.", placeholder: "https://yourorg.crm.dynamics.com" },
    ],
  },
  {
    provider: "zoho", label: "Zoho CRM", definitionName: "zoho",
    description: "Connect via Zoho OAuth2 — access tokens expire hourly, so a refresh token is strongly recommended.",
    supportsDiscovery: true, supportsOAuthRefresh: true,
    fields: [
      { key: "accessToken", label: "Access Token", type: "secret", required: false,
        help: "Current OAuth2 access token (expires after ~1 hour). Optional if a refresh token is provided." },
      { key: "refreshToken", label: "Refresh Token", type: "secret", required: false,
        help: "Long-lived token from the OAuth grant — lets WEBEE mint fresh access tokens automatically." },
      { key: "clientId", label: "Client ID", type: "text", required: false,
        help: "From api-console.zoho.com — required for automatic token refresh." },
      { key: "clientSecret", label: "Client Secret", type: "secret", required: false,
        help: "From api-console.zoho.com — required for automatic token refresh." },
      { key: "apiDomain", label: "API Domain", type: "url", required: true,
        help: "Region-specific API base returned at grant time, e.g. https://www.zohoapis.com (US), .eu, .in.", placeholder: "https://www.zohoapis.com" },
      { key: "accountsUrl", label: "Accounts URL", type: "url", required: false,
        help: "Defaults to https://accounts.zoho.com; use your region's accounts host (e.g. accounts.zoho.eu)." },
    ],
  },
  {
    provider: "webee", label: "WEBEE CRM (built-in)", definitionName: null,
    description: "Your workspace's built-in WEBEE CRM — no external credentials needed.",
    supportsDiscovery: true, supportsOAuthRefresh: false,
    fields: [],
  },
  {
    provider: "generic_rest", label: "Generic REST CRM", definitionName: "generic-rest",
    description: "Connect any REST-style CRM by describing its base URL, auth style and key endpoints.",
    supportsDiscovery: true, supportsOAuthRefresh: false,
    fields: [
      { key: "baseUrl", label: "Base URL", type: "url", required: true,
        help: "Root of the CRM's API, e.g. https://api.yourcrm.com.", placeholder: "https://api.yourcrm.com" },
      { key: "authStyle", label: "Auth Style", type: "select", required: true,
        help: "How credentials are sent: Bearer token, custom API-key header, or HTTP Basic.",
        options: ["bearer", "api_key_header", "basic", "none"] },
      { key: "apiKey", label: "API Key / Token", type: "secret", required: false,
        help: "The secret sent as the Bearer token or API-key header value." },
      { key: "apiKeyHeader", label: "API Key Header Name", type: "text", required: false,
        help: "Header name when Auth Style is api_key_header (default X-API-Key)." },
      { key: "username", label: "Username", type: "text", required: false, help: "For HTTP Basic auth only." },
      { key: "password", label: "Password", type: "secret", required: false, help: "For HTTP Basic auth only." },
      { key: "testPath", label: "Test Endpoint Path", type: "text", required: false,
        help: "GET path used to verify authentication (default /).", placeholder: "/me" },
      { key: "listPath", label: "List Records Path", type: "text", required: false,
        help: "GET path returning records (e.g. /contacts?limit=1) — used to verify read access and infer fields.", placeholder: "/contacts" },
      { key: "createPath", label: "Create Record Path", type: "text", required: false,
        help: "POST path used to verify write access with a clearly-flagged test record.", placeholder: "/contacts" },
      { key: "arrayPath", label: "Records Array Path", type: "text", required: false,
        help: "Dot-path to the records array in the list response (e.g. data.items) if not auto-detected." },
      { key: "customHeaders", label: "Custom Headers (JSON)", type: "secret", required: false,
        help: 'Optional JSON object of extra headers, e.g. {"X-Org": "123"}.' },
    ],
  },
  {
    provider: "webhook", label: "Webhook (outbound)", definitionName: "webhook",
    description: "Send CRM events to any endpoint you control — outbound-only.",
    supportsDiscovery: false, supportsOAuthRefresh: false,
    fields: [
      { key: "webhookUrl", label: "Webhook URL", type: "url", required: true,
        help: "The https endpoint that will receive POSTed event payloads.", placeholder: "https://example.com/webhooks/webee" },
      { key: "signingSecret", label: "Signing Secret", type: "secret", required: false,
        help: "Optional HMAC-SHA256 secret so your endpoint can verify payload authenticity." },
      { key: "signatureHeader", label: "Signature Header", type: "text", required: false,
        help: "Header the signature is sent in (default X-Webee-Signature)." },
    ],
  },
];

export function getConnectorEntry(provider: string): ConnectorRegistryEntry | null {
  return CRM_CONNECTOR_REGISTRY.find((e) => e.provider === provider) ?? null;
}

export function secretFieldKeys(provider: string): Set<string> {
  const entry = getConnectorEntry(provider);
  return new Set((entry?.fields ?? []).filter((f) => f.type === "secret").map((f) => f.key));
}

/**
 * Build an executable connector. SERVER-ONLY — lazily imports connector
 * modules (webee touches the DB via the admin client).
 */
export async function buildConnector(
  provider: string,
  creds: Record<string, string>,
  ctx: { workspaceId: string },
): Promise<CrmConnector> {
  switch (provider) {
    case "hubspot":
      return (await import("./connectors/hubspot.connector")).buildHubSpotConnector(creds);
    case "salesforce":
      return (await import("./connectors/salesforce.connector")).buildSalesforceConnector(creds);
    case "pipedrive":
      return (await import("./connectors/pipedrive.connector")).buildPipedriveConnector(creds);
    case "gohighlevel":
      return (await import("./connectors/gohighlevel.connector")).buildGoHighLevelConnector(creds);
    case "dynamics":
      return (await import("./connectors/dynamics.connector")).buildDynamicsConnector(creds);
    case "zoho":
      return (await import("./connectors/zoho.connector")).buildZohoConnector(creds);
    case "webee":
      return (await import("./connectors/webee.connector")).buildWebeeConnector(creds, ctx);
    case "generic_rest":
      return (await import("./connectors/generic-rest.connector")).buildGenericRestConnector(creds);
    case "webhook":
      return (await import("./connectors/webhook.connector")).buildWebhookConnector(creds);
    default:
      throw new Error(`Unsupported CRM provider: ${provider}`);
  }
}
