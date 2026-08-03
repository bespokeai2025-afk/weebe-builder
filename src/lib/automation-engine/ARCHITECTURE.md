# Automation Engine — Architecture

Production-grade workflow execution engine with n8n-equivalent **concepts** (not code). Workflows are JSON documents; nodes are pluggable; execution is node-by-node with full observability.

---

## Design principles

1. **Workflow JSON is source of truth** — nodes + connections, versioned, validated with Zod.
2. **Registry, not inheritance** — every node type registers via `NodeDefinition`; core and domain plugins coexist.
3. **Single runner, many modes** — one `ExecutionRunner` handles manual, test, production, partial, and resume.
4. **Observable by default** — every node emits events; input/output/logs/duration persisted incrementally.
5. **Pause/resume first-class** — wait/delay/webhook nodes save snapshots; scheduler + webhook resume continue runs.
6. **Queue for long runs** — production/async executions enqueue; worker drains with retry.

---

## Folder structure

```
src/lib/automation-engine/
├── ARCHITECTURE.md                 ← this document
├── index.ts                        ← public API
├── bootstrap.ts                    ← register core + plugin nodes
│
├── types/
│   ├── workflow.schema.ts          ← WorkflowDocument, RuntimeWorkflow
│   ├── execution.schema.ts         ← ExecutionStatus, WaitState, ExecutionSnapshot
│   ├── node.types.ts               ← NodeDefinition, NodeContext, NodeResult
│   └── expression.types.ts         ← ExpressionContext
│
├── parser/                         ← JSON → validated runtime graph
├── registry/                       ← pluggable node registry
├── executors/                      ← core node implementations
├── expressions/                    ← {{ $json.field }} resolver
│
├── runtime/
│   ├── execution-context.ts        ← mutable run state (queue, outputs, vars)
│   ├── execution-events.ts         ← in-process event bus → SSE subscribers
│   ├── execution-modes.ts          ← manual | test | production semantics
│   ├── execution-runner.ts         ← main node-by-node loop
│   ├── subgraph.ts                 ← execute-from-node, branch-only subgraph
│   └── resume.ts                   ← snapshot restore + continue
│
├── executor/
│   ├── workflow-executor.ts        ← thin backward-compat wrapper
│   ├── execution.types.ts          ← WorkflowExecutionResult, NodeExecutionRecord
│   └── execute-with-persistence.ts
│
├── persistence/
│   ├── execution-persistence.server.ts   ← CRUD executions + steps
│   ├── execution-snapshot.server.ts      ← save/load/resume snapshots
│   └── step-writer.server.ts             ← incremental step writes during run
│
├── queue/
│   └── execution-queue.server.ts   ← enqueue, claim, process long runs
│
├── adapters/                       ← WBAH canvas → WorkflowDocument
└── plugins/                        ← domain node packs (WBAH, etc.)
```

---

## Core interfaces

### WorkflowDocument (stored JSON)

```typescript
{
  id: uuid,
  version: 1,
  name: string,
  settings: { errorPolicy, timeoutMs, maxRetries },
  nodes: [{ id, type, name, config, retry, onError, disabled }],
  connections: [{ from: { node, port }, to: { node, port } }],
  variables: { defaults: {} }
}
```

### NodeDefinition (registry)

```typescript
interface NodeDefinition {
  type: string;                    // e.g. "core.http.request"
  execute(ctx: NodeContext): Promise<NodeResult>;
  inputs / outputs / properties / validate
}
```

### NodeResult

```typescript
interface NodeResult {
  status: "success" | "error" | "waiting";
  output?: { json: Record<string, unknown> };
  branch?: string;                 // condition/switch port
  resume?: WaitState;              // delay | webhook | event
  error?: { message, code, retryable };
}
```

### RunExecutionRequest

```typescript
interface RunExecutionRequest {
  workflow: unknown;
  mode: "manual" | "test" | "production";
  trigger?: Record<string, unknown>;
  executionId?: string;
  workspaceId?: string;
  startNodeId?: string;            // execute from selected node
  startInput?: Record<string, unknown>;
  branchOnly?: { nodeId: string; port: string };  // follow one branch
  resumeSnapshot?: ExecutionSnapshot;
  maxNodes?: number;
  env / secrets / variables
  onEvent?: (event: ExecutionEvent) => void;
}
```

---

## Execution lifecycle

```
┌─────────┐    ┌──────────┐    ┌─────────┐    ┌──────────┐    ┌──────────┐
│ PARSE   │───▶│ INIT     │───▶│ RUN     │───▶│ WAIT?    │───▶│ COMPLETE │
│ validate│    │ context  │    │ nodes   │    │ snapshot │    │ / FAILED │
└─────────┘    │ persist  │    │ events  │    │ queue    │    └──────────┘
               └──────────┘    └─────────┘    └────┬─────┘
                                                    │
                    ┌───────────────────────────────┘
                    ▼
              ┌──────────┐    ┌─────────┐
              │ RESUME   │───▶│ RUN     │  (webhook / scheduler / manual)
              │ restore  │    │ continue│
              └──────────┘    └─────────┘
```

### Modes

| Mode         | HTTP side effects | Domain writes | Persist source | Typical trigger      |
|--------------|-------------------|---------------|----------------|----------------------|
| `test`       | dry-run           | skipped       | `dry_run`      | Canvas "Execute step" |
| `manual`     | real              | real          | `manual`       | Run workflow button  |
| `production` | real              | real          | `queue`        | Webhook / job queue  |

### Execute from node

When `startNodeId` is set, the runner seeds the queue with that node + `startInput` (or pin data). Upstream nodes are skipped. Used for "Execute step" in the canvas editor.

### Execute branch only

When `branchOnly: { nodeId, port }` is set, after the start node only edges matching `port` are followed. Sibling branches are excluded.

### Wait / resume

1. Wait/delay node returns `status: "waiting"` + `resume: { type, token, until }`.
2. Runner saves `ExecutionSnapshot` (queue, nodeOutputs, waitingOn) and stops.
3. **Delay resume**: scheduler claims due executions and calls `resumeExecution()`.
4. **Webhook resume**: `POST /api/public/automation-resume/:token` with body → merges into node input → continues.

---

## Expression engine

Templates: `{{ $json.body.event }}`, `{{ $node["format-data"].json.email }}`, `{{ $vars.leadId }}`, `{{ $env.API_URL }}`.

Condition operators: `exists`, `not_exists`, `equals`, `contains`, `greater_than`, etc.

Implemented in `expressions/resolve-expression.ts` — no eval of arbitrary JS in expressions (security).

---

## Persistence

### Tables

- `automation_workflow_executions` — run header + snapshot JSONB + mode
- `automation_execution_steps` — per-node input/output/logs/duration (masked)
- `automation_execution_queue` — pending long-running jobs

### Incremental writes

Steps are inserted/updated **during** execution (not only post-run) so the UI can show live progress and crash recovery.

### Masking

Secrets in trigger/input/output masked via `maskRecord()` before DB write.

---

## Live events (SSE)

`GET /api/automation/executions/:id/events` streams:

```json
{ "type": "execution.started", "executionId", "workflowName" }
{ "type": "node.started", "nodeId", "nodeName" }
{ "type": "node.finished", "nodeId", "status", "branch", "durationMs" }
{ "type": "execution.waiting", "waitingOn" }
{ "type": "execution.completed", "status" }
{ "type": "execution.failed", "error" }
```

In-process `ExecutionEventBus` maps executionId → subscriber callbacks.

---

## Queue

Production runs with `async: true` enqueue to `automation_execution_queue`. Worker:

1. Claims row (`FOR UPDATE SKIP LOCKED` pattern)
2. Runs via `ExecutionRunner` in `production` mode
3. On `waiting` → leaves queue row, sets execution status `waiting`
4. On complete/fail → marks queue row done

Cron/route: `POST /api/cron/automation-queue` (CRON_SECRET).

---

## Error handling

| Level    | Policy                          | Behavior                          |
|----------|---------------------------------|-----------------------------------|
| Node     | `onError: stop\|continue\|retry`| Per-node; retry uses backoff      |
| Workflow | `settings.errorPolicy`          | Default when node policy unset    |
| HTTP     | `timeoutMs`, retryable flag     | Network errors may retry          |
| Workflow | `settings.timeoutMs`            | Abort run after deadline          |

---

## Integration points

- **WBAH canvas** → `adapters/wbah-graph.adapter.ts` → WorkflowDocument
- **SystemMind API** → `automation-engine.functions.ts`
- **WBAH queue** → `wbah-post-call-queue.server.ts` → `runWbahPostCallViaAutomationEngine`
- **Canvas execute step** → `wbah-workflow-node-execute.server.ts` → `runExecution({ startNodeId, mode: "test" })`

---

## Module implementation order

1. `runtime/execution-context.ts` — state container
2. `runtime/execution-events.ts` — event bus
3. `runtime/execution-modes.ts` — mode flags
4. `runtime/subgraph.ts` — partial graph helpers
5. `runtime/execution-runner.ts` — main loop
6. `runtime/resume.ts` — snapshot restore
7. `persistence/execution-snapshot.server.ts` + migration
8. `persistence/step-writer.server.ts`
9. `queue/execution-queue.server.ts`
10. API routes (SSE, resume webhook, queue cron)
11. Wire `workflow-executor.ts` → runner (backward compat)
