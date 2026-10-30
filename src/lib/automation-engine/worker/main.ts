/**
 * Automation worker — runs queued automation work in its own process, off the web server.
 *
 * Polls two queues and processes what is due:
 *   - WBAH post-call jobs (wbah_post_call_jobs): webhooks enqueue, this runs the workflow;
 *   - async engine executions (automation_execution_queue).
 * Every job is claimed atomically, so several workers (or the web server's own fallback paths)
 * can run at once without a job running twice.
 *
 * With AUTOMATION_WORKER=on on the web server, webhooks only enqueue; without it the web server
 * keeps processing inline as before, so the worker can be rolled out and back with one setting.
 *
 * Built to dist/automation-worker.mjs (scripts/build-automation-worker.mjs).
 * Run: node dist/automation-worker.mjs   (env as the web server)
 */

const IDLE_POLL_MS = Number(process.env.AUTOMATION_WORKER_POLL_MS ?? 2_000);
const BATCH = Number(process.env.AUTOMATION_WORKER_BATCH ?? 10);
const HEARTBEAT_MS = 60_000;

let stopping = false;
let inFlight: Promise<unknown> | null = null;

function log(msg: string, extra?: Record<string, unknown>) {
  console.log(`[automation-worker] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`);
}

async function tick(): Promise<number> {
  const { runWbahPostCallQueuePoller } = await import("@/lib/wbah/post-call/wbah-post-call-queue.server");
  const { drainExecutionQueue } = await import("@/lib/automation-engine/queue/execution-queue.server");
  const wbah = await runWbahPostCallQueuePoller(BATCH);
  const engine = await drainExecutionQueue(BATCH);
  const done = wbah.checked + engine;
  if (done > 0 || wbah.expired > 0) {
    log("processed", { wbah: wbah.checked, wbahFailed: wbah.failed, expired: wbah.expired, engine });
  }
  return done;
}

async function loop() {
  let processed = 0;
  let lastBeat = Date.now();
  log("started", { pollMs: IDLE_POLL_MS, batch: BATCH, pid: process.pid });
  while (!stopping) {
    let done = 0;
    try {
      inFlight = tick();
      done = (await inFlight) as number;
    } catch (e) {
      log("tick failed", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      inFlight = null;
    }
    processed += done;
    if (Date.now() - lastBeat >= HEARTBEAT_MS) {
      log("alive", { processedSinceLast: processed });
      processed = 0;
      lastBeat = Date.now();
    }
    // A full batch means more may be waiting: go again straight away.
    if (done < BATCH && !stopping) await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal} — finishing in-flight work`);
  const timer = setTimeout(() => {
    log("in-flight work did not finish in 60s; exiting (claims expire and are retried)");
    process.exit(1);
  }, 60_000);
  try {
    await inFlight;
  } catch {
    /* already logged */
  }
  clearTimeout(timer);
  log("stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (e) => log("unhandled rejection", { error: String(e) }));

/** `--check`: load everything the worker runs, then exit without touching a queue. For deploys. */
async function check() {
  await import("@/lib/wbah/post-call/wbah-post-call-queue.server");
  await import("@/lib/wbah/post-call/wbah-post-call.server");
  await import("@/lib/automation-engine/plugins/wbah/wbah-automation-pipeline.server");
  await import("@/lib/automation-engine/queue/execution-queue.server");
  const { bootstrapAutomationEngine } = await import("@/lib/automation-engine/bootstrap");
  const { count } = bootstrapAutomationEngine();
  log("check ok", { nodeTypes: count });
  process.exit(0);
}

if (process.argv.includes("--check")) void check().catch((e) => {
  log("check failed", { error: e instanceof Error ? e.stack : String(e) });
  process.exit(1);
});
else void loop();
