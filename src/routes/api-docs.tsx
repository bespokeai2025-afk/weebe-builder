import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check, Key, Zap, Phone, Users, BookOpen, Webhook, BarChart3, Star } from "lucide-react";

export const Route = createFileRoute("/api-docs")({
  component: ApiDocsPage,
});

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface Endpoint {
  method: Method;
  path: string;
  permission: string;
  summary: string;
  description: string;
  params?: { name: string; in: "query" | "body" | "path"; type: string; required: boolean; description: string }[];
  response: string;
}

interface Section {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  endpoints: Endpoint[];
}

const METHOD_COLOUR: Record<Method, string> = {
  GET:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  POST:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  PUT:    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  PATCH:  "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  DELETE: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const SECTIONS: Section[] = [
  {
    id: "agents",
    icon: <Zap className="w-5 h-5" />,
    title: "Agents",
    description: "Manage and deploy AI agents from your workspace.",
    endpoints: [
      {
        method: "GET", path: "/api/v1/agents", permission: "agents:read",
        summary: "List agents",
        description: "Returns all AI agents in your workspace.",
        response: `{ "object": "list", "data": [{ "id": "...", "name": "Receptionist", "status": "active", "provider": "retell" }] }`,
      },
      {
        method: "POST", path: "/api/v1/agents/deploy", permission: "agents:deploy",
        summary: "Deploy an agent",
        description: "Deploy an existing agent to a voice provider. The agent must already be built in the WEBEE Builder.",
        params: [
          { name: "agent_id", in: "body", type: "string", required: true, description: "ID of the agent to deploy" },
          { name: "provider", in: "body", type: "string", required: false, description: "Voice provider: retell | hyperstream | voxstream (defaults to workspace default)" },
        ],
        response: `{ "ok": true, "agent_id": "...", "provider": "retell" }`,
      },
    ],
  },
  {
    id: "calls",
    icon: <Phone className="w-5 h-5" />,
    title: "Calls",
    description: "Trigger outbound calls and retrieve call logs with transcripts.",
    endpoints: [
      {
        method: "GET", path: "/api/v1/calls", permission: "calls:read",
        summary: "List call logs",
        description: "Returns call logs for your workspace, newest first.",
        params: [
          { name: "limit", in: "query", type: "integer", required: false, description: "Max results (default 50, max 200)" },
          { name: "offset", in: "query", type: "integer", required: false, description: "Pagination offset" },
          { name: "since", in: "query", type: "ISO 8601", required: false, description: "Filter calls after this timestamp" },
        ],
        response: `{ "object": "list", "data": [{ "id": "...", "agent_name": "...", "call_status": "completed", "duration_seconds": 142, "sentiment": "positive" }] }`,
      },
      {
        method: "GET", path: "/api/v1/calls/:id", permission: "calls:read",
        summary: "Get call detail",
        description: "Returns full detail for a single call including transcript and extracted data.",
        params: [
          { name: "id", in: "path", type: "string", required: true, description: "Call ID" },
        ],
        response: `{ "id": "...", "transcript": [...], "recording_url": "...", "extracted_data": { ... } }`,
      },
      {
        method: "POST", path: "/api/v1/calls", permission: "calls:trigger",
        summary: "Trigger outbound call",
        description: "Initiates an outbound AI call from one of your deployed agents.",
        params: [
          { name: "agent_id", in: "body", type: "string", required: true, description: "Agent to make the call" },
          { name: "to_number", in: "body", type: "string", required: true, description: "E.164 format phone number e.g. +447911123456" },
          { name: "lead_id", in: "body", type: "string", required: false, description: "Associate call with an existing lead" },
          { name: "metadata", in: "body", type: "object", required: false, description: "Custom key/value data injected as call variables" },
        ],
        response: `{ "ok": true, "call_id": "...", "status": "initiating" }`,
      },
    ],
  },
  {
    id: "leads",
    icon: <Users className="w-5 h-5" />,
    title: "Leads",
    description: "Create and retrieve leads in Smart Dash CRM.",
    endpoints: [
      {
        method: "GET", path: "/api/v1/leads", permission: "leads:read",
        summary: "List leads",
        description: "Returns leads in your workspace, newest first.",
        params: [
          { name: "limit", in: "query", type: "integer", required: false, description: "Max results (default 50, max 200)" },
          { name: "offset", in: "query", type: "integer", required: false, description: "Pagination offset" },
          { name: "status", in: "query", type: "string", required: false, description: "Filter: new | contacted | qualified | sale | lost" },
        ],
        response: `{ "object": "list", "data": [{ "id": "...", "full_name": "Jane Smith", "email": "...", "status": "qualified" }] }`,
      },
      {
        method: "POST", path: "/api/v1/leads", permission: "leads:write",
        summary: "Create a lead",
        description: "Creates a new lead in Smart Dash. Phone must be in E.164 format.",
        params: [
          { name: "full_name", in: "body", type: "string", required: true, description: "Lead's full name" },
          { name: "phone", in: "body", type: "string", required: false, description: "E.164 phone number" },
          { name: "email", in: "body", type: "string", required: false, description: "Email address" },
          { name: "source", in: "body", type: "string", required: false, description: "Lead source label" },
          { name: "notes", in: "body", type: "string", required: false, description: "Initial notes" },
        ],
        response: `{ "ok": true, "lead_id": "..." }`,
      },
    ],
  },
  {
    id: "contacts",
    icon: <Users className="w-5 h-5" />,
    title: "Contacts",
    description: "Manage contacts in your workspace.",
    endpoints: [
      {
        method: "GET", path: "/api/v1/contacts", permission: "contacts:read",
        summary: "List contacts",
        description: "Returns contacts in your workspace.",
        params: [
          { name: "limit", in: "query", type: "integer", required: false, description: "Max results (default 50, max 200)" },
          { name: "offset", in: "query", type: "integer", required: false, description: "Pagination offset" },
        ],
        response: `{ "object": "list", "data": [{ "id": "...", "full_name": "...", "email": "...", "phone": "..." }] }`,
      },
      {
        method: "POST", path: "/api/v1/contacts", permission: "contacts:write",
        summary: "Create a contact",
        description: "Creates a new contact record.",
        params: [
          { name: "full_name", in: "body", type: "string", required: true, description: "Contact's full name" },
          { name: "phone", in: "body", type: "string", required: false, description: "E.164 phone number" },
          { name: "email", in: "body", type: "string", required: false, description: "Email address" },
          { name: "company", in: "body", type: "string", required: false, description: "Company name" },
        ],
        response: `{ "ok": true, "contact_id": "..." }`,
      },
    ],
  },
  {
    id: "knowledge",
    icon: <BookOpen className="w-5 h-5" />,
    title: "Knowledge",
    description: "Upload knowledge to your AI agents' knowledge bases.",
    endpoints: [
      {
        method: "POST", path: "/api/v1/knowledge", permission: "knowledge:write",
        summary: "Upload knowledge",
        description: "Adds a text document or URL to an agent's knowledge base. The content is chunked and embedded automatically.",
        params: [
          { name: "agent_id", in: "body", type: "string", required: true, description: "Target agent ID" },
          { name: "title", in: "body", type: "string", required: true, description: "Document title" },
          { name: "content", in: "body", type: "string", required: false, description: "Plain text content (use this OR url)" },
          { name: "url", in: "body", type: "string", required: false, description: "URL to scrape and ingest (use this OR content)" },
        ],
        response: `{ "ok": true, "document_id": "..." }`,
      },
    ],
  },
  {
    id: "bookings",
    icon: <BarChart3 className="w-5 h-5" />,
    title: "Bookings",
    description: "Retrieve and create calendar bookings.",
    endpoints: [
      {
        method: "GET", path: "/api/v1/bookings", permission: "bookings:read",
        summary: "List bookings",
        description: "Returns calendar bookings in your workspace.",
        params: [
          { name: "limit", in: "query", type: "integer", required: false, description: "Max results (default 50, max 200)" },
          { name: "offset", in: "query", type: "integer", required: false, description: "Pagination offset" },
        ],
        response: `{ "object": "list", "data": [{ "id": "...", "contact_name": "...", "scheduled_at": "...", "status": "confirmed" }] }`,
      },
      {
        method: "POST", path: "/api/v1/bookings", permission: "bookings:write",
        summary: "Create a booking",
        description: "Creates a new booking record.",
        params: [
          { name: "contact_name", in: "body", type: "string", required: true, description: "Name of the person being booked" },
          { name: "contact_email", in: "body", type: "string", required: false, description: "Contact email" },
          { name: "scheduled_at", in: "body", type: "ISO 8601", required: true, description: "Date/time of the booking" },
          { name: "notes", in: "body", type: "string", required: false, description: "Booking notes" },
        ],
        response: `{ "ok": true, "booking_id": "..." }`,
      },
    ],
  },
  {
    id: "webhooks",
    icon: <Webhook className="w-5 h-5" />,
    title: "Webhooks",
    description: "Register endpoints to receive real-time event notifications from WEBEE.",
    endpoints: [
      {
        method: "GET", path: "/api/v1/webhooks", permission: "webhooks:manage",
        summary: "List webhook subscriptions",
        description: "Returns all registered webhook endpoints for your workspace.",
        response: `{ "object": "list", "data": [{ "id": "...", "name": "...", "event_type": "lead.created", "target_url": "..." }] }`,
      },
      {
        method: "POST", path: "/api/v1/webhooks", permission: "webhooks:manage",
        summary: "Create webhook subscription",
        description: "Registers a new endpoint to receive event payloads. WEBEE will POST a signed JSON payload to your URL on each event.",
        params: [
          { name: "name", in: "body", type: "string", required: true, description: "Friendly name for this subscription" },
          { name: "event_type", in: "body", type: "string", required: true, description: "Event to subscribe to (see event catalog below)" },
          { name: "target_url", in: "body", type: "string", required: true, description: "HTTPS URL to receive events" },
        ],
        response: `{ "ok": true, "webhook_id": "..." }`,
      },
    ],
  },
];

const EVENTS = [
  { event: "lead.created", description: "A new lead is added to Smart Dash" },
  { event: "lead.updated", description: "A lead's status or data is updated" },
  { event: "call.started", description: "An AI call begins" },
  { event: "call.completed", description: "An AI call ends successfully" },
  { event: "call.failed", description: "An AI call fails or is unanswered" },
  { event: "booking.created", description: "A calendar booking is created" },
  { event: "campaign.completed", description: "An outbound campaign finishes" },
  { event: "document.uploaded", description: "A knowledge document is processed" },
  { event: "agent.deployed", description: "An agent is deployed to a provider" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1.5 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function EndpointCard({ ep }: { ep: Endpoint }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left"
      >
        <span className={`text-xs font-bold px-2 py-0.5 rounded font-mono ${METHOD_COLOUR[ep.method]}`}>{ep.method}</span>
        <span className="font-mono text-sm text-zinc-700 dark:text-zinc-200 flex-1">{ep.path}</span>
        <span className="text-xs text-zinc-400 hidden sm:block">{ep.permission}</span>
        {open ? <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{ep.description}</p>
          {ep.params && ep.params.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Parameters</p>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-xs text-zinc-400 uppercase text-left">
                    <th className="pb-1 pr-4">Name</th>
                    <th className="pb-1 pr-4">Location</th>
                    <th className="pb-1 pr-4">Type</th>
                    <th className="pb-1 pr-4">Required</th>
                    <th className="pb-1">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {ep.params.map(p => (
                    <tr key={p.name} className="border-t border-zinc-200 dark:border-zinc-700">
                      <td className="py-1.5 pr-4 font-mono text-xs text-zinc-700 dark:text-zinc-200">{p.name}</td>
                      <td className="py-1.5 pr-4 text-xs text-zinc-500">{p.in}</td>
                      <td className="py-1.5 pr-4 text-xs text-zinc-500 font-mono">{p.type}</td>
                      <td className="py-1.5 pr-4 text-xs">
                        {p.required
                          ? <span className="text-rose-500 font-semibold">required</span>
                          : <span className="text-zinc-400">optional</span>}
                      </td>
                      <td className="py-1.5 text-xs text-zinc-600 dark:text-zinc-300">{p.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Example Response</p>
              <CopyButton text={ep.response} />
            </div>
            <pre className="bg-zinc-900 text-emerald-300 rounded p-3 text-xs overflow-x-auto whitespace-pre-wrap">{ep.response}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function ApiDocsPage() {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://your-app.webee.ai";

  const authExample = `curl -X GET "${baseUrl}/api/v1/agents" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json"`;

  const triggerCallExample = `curl -X POST "${baseUrl}/api/v1/calls" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agent_id": "your-agent-id",
    "to_number": "+447911123456",
    "metadata": {
      "lead_name": "Jane Smith",
      "custom_variable": "value"
    }
  }'`;

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-white">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Star className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-zinc-400 uppercase tracking-widest">WEBEE Platform</span>
          </div>
          <h1 className="text-3xl font-bold mb-2">Developer API</h1>
          <p className="text-zinc-400 text-lg">Programmatically trigger calls, manage leads, and build integrations with WEBEE's REST API.</p>
          <div className="flex flex-wrap gap-3 mt-4">
            <span className="text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-800 px-3 py-1 rounded-full">Base URL: /api/v1</span>
            <span className="text-xs bg-zinc-800 text-zinc-400 border border-zinc-700 px-3 py-1 rounded-full">Authentication: Bearer token</span>
            <span className="text-xs bg-zinc-800 text-zinc-400 border border-zinc-700 px-3 py-1 rounded-full">Rate limit: 60 req/min</span>
            <span className="text-xs bg-zinc-800 text-zinc-400 border border-zinc-700 px-3 py-1 rounded-full">Format: JSON</span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10 space-y-12">
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Key className="w-5 h-5 text-violet-500" /> Authentication
          </h2>
          <p className="text-zinc-600 dark:text-zinc-300 mb-4 text-sm">
            All API requests require a Bearer token in the <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-sm font-mono">Authorization</code> header.
            Generate an API key from <strong>Settings → Developer API → API Keys</strong> in your WEBEE dashboard.
          </p>
          <div className="rounded-lg overflow-hidden border border-zinc-800">
            <div className="flex items-center justify-between bg-zinc-900 px-4 py-2">
              <span className="text-xs text-zinc-400 font-mono">Example request</span>
              <CopyButton text={authExample} />
            </div>
            <pre className="bg-zinc-950 text-zinc-300 p-4 text-xs overflow-x-auto">{authExample}</pre>
          </div>
          <div className="mt-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-300">
            <strong>Security:</strong> API keys are workspace-scoped and permission-scoped. Never expose your key in client-side code. Store it in environment variables or a secrets manager.
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-4">Quick Start — Trigger a Call</h2>
          <div className="rounded-lg overflow-hidden border border-zinc-800">
            <div className="flex items-center justify-between bg-zinc-900 px-4 py-2">
              <span className="text-xs text-zinc-400 font-mono">Outbound call in one API call</span>
              <CopyButton text={triggerCallExample} />
            </div>
            <pre className="bg-zinc-950 text-zinc-300 p-4 text-xs overflow-x-auto">{triggerCallExample}</pre>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-2">Errors</h2>
          <p className="text-zinc-600 dark:text-zinc-300 mb-4 text-sm">All errors return a JSON body with a single <code className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono text-sm">error</code> string and an appropriate HTTP status code.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
              <thead className="bg-zinc-100 dark:bg-zinc-800">
                <tr className="text-left text-xs text-zinc-500 uppercase">
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["400", "Bad request — missing or invalid parameters"],
                  ["401", "Unauthorized — no or invalid Bearer token"],
                  ["403", "Forbidden — token lacks required permission"],
                  ["404", "Not found — resource does not exist in your workspace"],
                  ["429", "Too many requests — rate limit exceeded (60 req/min)"],
                  ["500", "Server error — retry with exponential backoff"],
                ].map(([code, desc]) => (
                  <tr key={code} className="border-t border-zinc-200 dark:border-zinc-700">
                    <td className="px-4 py-2 font-mono text-xs font-semibold">{code}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300 text-xs">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {SECTIONS.map(section => (
          <section key={section.id}>
            <button
              onClick={() => setActiveSection(activeSection === section.id ? null : section.id)}
              className="w-full flex items-center justify-between mb-3"
            >
              <h2 className="text-xl font-bold flex items-center gap-2">
                <span className="text-violet-500">{section.icon}</span>
                {section.title}
              </h2>
            </button>
            <p className="text-zinc-500 text-sm mb-4">{section.description}</p>
            <div className="space-y-2">
              {section.endpoints.map(ep => (
                <EndpointCard key={`${ep.method}-${ep.path}`} ep={ep} />
              ))}
            </div>
          </section>
        ))}

        <section>
          <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
            <Webhook className="w-5 h-5 text-violet-500" /> Webhook Event Catalog
          </h2>
          <p className="text-zinc-600 dark:text-zinc-300 mb-4 text-sm">
            WEBEE delivers signed POST payloads to your registered URL. Each payload includes an <code className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono text-sm">X-WEBEE-Signature</code> header (HMAC-SHA256).
          </p>
          <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
            {EVENTS.map((e, i) => (
              <div key={e.event} className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? "border-t border-zinc-200 dark:border-zinc-700" : ""}`}>
                <code className="text-xs font-mono text-violet-500 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 px-2 py-0.5 rounded min-w-fit">{e.event}</code>
                <span className="text-sm text-zinc-600 dark:text-zinc-300">{e.description}</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="border-t border-zinc-200 dark:border-zinc-800 pt-8 text-center text-sm text-zinc-400">
          <p>WEBEE Developer API v1 — Generate your API key in <strong className="text-zinc-600 dark:text-zinc-300">Settings → Developer API</strong></p>
        </footer>
      </div>
    </div>
  );
}
