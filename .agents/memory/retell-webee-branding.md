---
name: Retell / WEBEE brand mapping
description: Rules for hiding "Retell" from customer-facing UI and how builder http_request nodes relate to Retell's function/webhook type.
---

## Customer-facing brand rule

Customers see **WEBEE Voice**, not "Retell". The mapping utility is at `src/lib/provider-display.ts` — `getProviderLabel(id, isAdmin)`.

### Locations changed to WEBEE branding
- `AccountsMindRecharges.tsx` — PROVIDERS list: `"Retell"` → `"WEBEE Voice"`
- `settings.integrations.tsx` — webhook endpoint docs: `x-retell-signature` → `x-webee-signature`
- `settings.calendar.tsx` — booking webhook docs: `x-retell-signature` → `x-webee-signature`, `retell_call_id?` → `call_id?`

### Admin-only (leave as-is)
- `admin.cost-engine.tsx` — Retell cost calculator (admin-only)
- `admin.users.tsx` — Retell API key approval (admin-only)
- Internal DB columns (`retell_agent_id`, `deployedRetellAgentId`) — never shown to customers

## HTTP Request builder node

`http_request` NodeKind in the builder **exports to Retell as** `type: "function"` + `tool_type: "webhook"`. This is intentional — Retell's webhook function type is what makes external HTTP calls at runtime. The customer sees "HTTP Request" as the node label; Retell sees its native webhook tool internally.

**Why:** Retell doesn't have a separate "http_request" node type; the closest native equivalent is `function` with `tool_type: "webhook"` which calls a URL. The builder node abstracts this with friendly URL/method/headers/body/mapping fields.
