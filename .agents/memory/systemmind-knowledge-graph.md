---
name: SystemMind Knowledge Graph + CRM Abstraction
description: Descriptive-only admin knowledge graph + static CRM adapter registry; how they stay additive/secret-free and the server-fn return-type inference trap.
---

# SystemMind Knowledge Graph + CRM Abstraction (spec Phases 5/6/8)

Admin-only, workspace-isolated, **descriptive/knowledge-only** layer. NO live CRM
calls, NO execution, NO deployment. Strictly additive.

## Shape
- 3 new tables (manual-apply migration `SYSTEMMIND_KNOWLEDGE_GRAPH_MIGRATION.sql`):
  `systemmind_graph_nodes`, `_edges`, `_builds`. RLS: member SELECT, service_role-only writes.
- Builder does a **full rebuild** from existing DB tables into derived nodes/edges;
  never mutates any source system. Readers: summary / list / view / dependency-BFS.
- CRM adapters are a **frozen in-code seed** (`crm-definitions/registry.ts`) with
  deep-clone-on-read; endpoint/method/auth are string metadata only — never fetched.

## Durable rules
- **Secrets never stored**: node/edge metadata is presence booleans + counts only
  (`has_retell_agent`, `auth_type` + host-only, `connected` bool). Never select
  credential columns into graph metadata.
- **Route path**: use `/systemmind/graph` NOT `/knowledge-graph` — the latter
  collides with `/systemmind/knowledge` via the shell's `startsWith` active-match.
- **No IDOR in dependency reader**: client-supplied `nodeId` is looked up only
  within the workspace-scoped node set → a foreign UUID returns `{root:null}`,
  not another tenant's data. Zod caps `limit≤1000`, `depth≤4`.

## Non-obvious TS trap (cost >1 pass)
Input-validated TanStack server fns (those with `.inputValidator(...)`) **lose
return-type inference through `useServerFn`** — `q.data` resolves to `{}` and every
property access errors. No-input server fns infer fine.
**Fix:** define the reader output interfaces in the *pure* schema module
(`knowledge-graph.schema.ts`), import them into both `.server.ts` and the page, and
cast each `queryFn` result: `queryFn: () => fn({ data }) as Promise<DependencyView>`.
**Why:** keeps types out of `.server.ts` (import-protection / server-only) while
giving the client component real types.
