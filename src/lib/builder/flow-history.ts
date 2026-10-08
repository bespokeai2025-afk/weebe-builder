import type {
  BuilderSettings,
  BuilderVariable,
  FlowNode,
  FlowVersionSnapshot,
  PublishedSnapshot,
} from "./types";
import type { Edge } from "@xyflow/react";

const HISTORY_CAP = 15;

export function graphFingerprint(
  nodes: FlowNode[],
  edges: Edge[],
  variables: BuilderVariable[],
): string {
  return JSON.stringify({
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, data: n.data, position: n.position })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle })),
    variables,
  });
}

export function nextVersionNumber(history: FlowVersionSnapshot[] | undefined): number {
  const max = (history ?? []).reduce((m, v) => Math.max(m, v.version), 0);
  return max + 1;
}

/** Most compressed history kept on an agent. Every save sends it, so it must stay small. */
export const HISTORY_MAX_BYTES = 400_000;

/** FNV-1a hash of a string, as 8 hex chars — enough to tell two graphs apart. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function flowFingerprint(nodes: FlowNode[], edges: Edge[], variables: BuilderVariable[]): string {
  return shortHash(graphFingerprint(nodes, edges, variables));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

export async function gzipJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return toBase64(await pipeThrough(bytes, new CompressionStream("gzip")));
}

export async function gunzipJson<T>(b64: string): Promise<T> {
  const bytes = await pipeThrough(fromBase64(b64), new DecompressionStream("gzip"));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function entryFingerprint(entry: FlowVersionSnapshot): string | undefined {
  if (entry.fingerprint) return entry.fingerprint;
  if (entry.flowData) {
    return flowFingerprint(entry.flowData.nodes, entry.flowData.edges, entry.variables ?? []);
  }
  return undefined;
}

/** One history entry in its compressed, saved form. */
async function compactEntry(entry: FlowVersionSnapshot): Promise<FlowVersionSnapshot> {
  if (entry.gz && !entry.flowData) return entry;
  const fingerprint = entryFingerprint(entry);
  const gz = await gzipJson({ flowData: entry.flowData, variables: entry.variables ?? [] });
  return { version: entry.version, label: entry.label, createdAt: entry.createdAt, fingerprint, gz };
}

/**
 * History as it should be saved: every entry compressed, newest kept, total under the byte cap
 * (the newest entry is always kept, however large).
 */
export async function compactFlowHistory(
  history: FlowVersionSnapshot[] | undefined,
  maxBytes: number = HISTORY_MAX_BYTES,
): Promise<FlowVersionSnapshot[]> {
  const compacted = await Promise.all((history ?? []).map(compactEntry));
  const kept: FlowVersionSnapshot[] = [];
  let used = 0;
  for (let i = compacted.length - 1; i >= 0; i--) {
    const entry = compacted[i]!;
    const size = (entry.gz?.length ?? 0) + 200;
    if (kept.length > 0 && used + size > maxBytes) break;
    kept.unshift(entry);
    used += size;
  }
  return kept.slice(-HISTORY_CAP);
}

/** True when history still holds an uncompressed entry (e.g. saved before compaction existed). */
export function historyNeedsCompaction(history: FlowVersionSnapshot[] | undefined): boolean {
  return (history ?? []).some((e) => Boolean(e.flowData) || !e.gz);
}

/** The graph stored in a history entry, whichever form it is in. */
export async function expandFlowVersion(
  entry: FlowVersionSnapshot,
): Promise<{ flowData: { nodes: FlowNode[]; edges: Edge[] }; variables: BuilderVariable[] }> {
  if (entry.flowData) return { flowData: entry.flowData, variables: entry.variables ?? [] };
  if (!entry.gz) throw new Error(`Version ${entry.version} has no stored graph`);
  return gunzipJson(entry.gz);
}

/** Add a version (compressed), unless it matches the newest one. Returns null when unchanged. */
export async function appendFlowVersion(
  settings: BuilderSettings,
  snapshot: {
    label: string;
    flowData: { nodes: FlowNode[]; edges: Edge[] };
    variables: BuilderVariable[];
    version?: number;
  },
): Promise<FlowVersionSnapshot[] | null> {
  const prev = settings.flowHistory ?? [];
  const fingerprint = flowFingerprint(snapshot.flowData.nodes, snapshot.flowData.edges, snapshot.variables);
  const last = prev[prev.length - 1];
  if (last && entryFingerprint(last) === fingerprint) return null;
  const entry: FlowVersionSnapshot = {
    version: snapshot.version ?? nextVersionNumber(prev),
    label: snapshot.label,
    createdAt: new Date().toISOString(),
    fingerprint,
    flowData: snapshot.flowData,
    variables: snapshot.variables,
  };
  return compactFlowHistory([...prev, entry]);
}

export function makePublishedSnapshot(
  version: number,
  nodes: FlowNode[],
  edges: Edge[],
  variables: BuilderVariable[],
): PublishedSnapshot {
  return {
    version,
    publishedAt: new Date().toISOString(),
    flowData: structuredClone({ nodes, edges }),
    variables: structuredClone(variables),
  };
}
