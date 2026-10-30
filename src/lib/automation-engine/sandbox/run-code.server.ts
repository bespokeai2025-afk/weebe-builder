/**
 * Code node sandbox — runs workflow JavaScript in QuickJS compiled to WebAssembly.
 *
 * Code nodes used `new Function` inside the server process, with access to its globals and
 * `process.env` (every secret, the database service key among them). Here the code runs in a
 * separate interpreter with its own heap: no `process`, `require`, network, file system or timers,
 * and it only sees the data passed in. Each run gets a fresh runtime with a memory cap and a
 * deadline, so a loop or a huge allocation fails that node instead of stalling the server.
 *
 * The code sees `items`, `$input` (`all()`, `first()`, `item`, `json`, `trigger`), `$json` and
 * `$vars`, and returns `{ json }`, `[{ json }]`, a plain object, or a value. Synchronous only.
 */
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";

export const CODE_NODE_TIMEOUT_MS = 1_000;
export const CODE_NODE_MEMORY_BYTES = 32 * 1024 * 1024;
const MAX_STACK_BYTES = 512 * 1024;
const MAX_OUTPUT_CHARS = 1_000_000;

let modulePromise: Promise<QuickJSWASMModule> | null = null;

function quickjs(): Promise<QuickJSWASMModule> {
  modulePromise ??= newQuickJSWASMModuleFromVariant(import("@jitl/quickjs-wasmfile-release-sync"));
  return modulePromise;
}

export type SandboxInput = {
  json: Record<string, unknown>;
  trigger?: Record<string, unknown>;
  variables?: Record<string, unknown>;
};

export type SandboxResult = { ok: true; value: unknown } | { ok: false; error: string };

export async function runSandboxedCode(
  code: string,
  input: SandboxInput,
  opts: { timeoutMs?: number; memoryBytes?: number } = {},
): Promise<SandboxResult> {
  const mod = await quickjs();
  const runtime = mod.newRuntime();
  runtime.setMemoryLimit(opts.memoryBytes ?? CODE_NODE_MEMORY_BYTES);
  runtime.setMaxStackSize(MAX_STACK_BYTES);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + (opts.timeoutMs ?? CODE_NODE_TIMEOUT_MS)));
  const vm = runtime.newContext();
  try {
    const payload = vm.newString(
      JSON.stringify({ json: input.json, trigger: input.trigger ?? {}, vars: input.variables ?? {} }),
    );
    vm.setProp(vm.global, "__payload", payload);
    payload.dispose();

    const program = `
      (() => {
        const __in = JSON.parse(__payload);
        const items = [{ json: __in.json }];
        const $json = __in.json;
        const $vars = __in.vars;
        const $input = {
          json: __in.json,
          trigger: __in.trigger,
          item: items[0],
          all: () => items,
          first: () => items[0],
        };
        const console = { log() {}, warn() {}, error() {}, info() {} };
        const __result = (function (items, $input, $json, $vars, console) {
          "use strict";
          ${code}
        })(items, $input, $json, $vars, console);
        return JSON.stringify(__result === undefined ? null : __result);
      })()
    `;
    const res = vm.evalCode(program, "code-node.js");
    if (res.error) {
      const err = vm.dump(res.error) as { name?: string; message?: string } | string;
      res.error.dispose();
      const message = typeof err === "string" ? err : `${err?.name ?? "Error"}: ${err?.message ?? "failed"}`;
      return { ok: false, error: /interrupted/i.test(message) ? "Code took too long and was stopped" : message };
    }
    const text = vm.getString(res.value);
    res.value.dispose();
    if (text.length > MAX_OUTPUT_CHARS) return { ok: false, error: "Code returned more data than a step may hold" };
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: /out of memory|memory/i.test(message) ? "Code used more memory than allowed" : message,
    };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
