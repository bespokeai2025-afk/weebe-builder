import { describe, expect, it } from "vitest";
import {
  autoLayoutNodes,
  builderNodeSize,
  resolveNodeOverlaps,
} from "@/lib/builder/auto-layout";

type N = Parameters<typeof resolveNodeOverlaps>[0][number];

function node(
  id: string,
  x: number,
  y: number,
  size?: { width: number; height: number },
  kind = "conversation",
): N {
  return {
    id,
    position: { x, y },
    data: { kind, transitions: [] },
    ...(size ? { measured: size } : {}),
  } as unknown as N;
}

function boxes(nodes: N[]) {
  return nodes
    .filter((n) => (n.data as { kind?: string })?.kind !== "note")
    .map((n) => {
      const { width, height } = builderNodeSize(n as never);
      return { id: n.id, x: n.position.x, y: n.position.y, w: width, h: height };
    });
}

function overlappingPairs(nodes: N[]): string[] {
  const bs = boxes(nodes);
  const out: string[] = [];
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i]!;
      const b = bs[j]!;
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        out.push(`${a.id}~${b.id}`);
      }
    }
  }
  return out;
}

describe("builderNodeSize", () => {
  it("prefers what React Flow measured over any assumption", () => {
    expect(builderNodeSize(node("a", 0, 0, { width: 480, height: 812 }) as never)).toEqual({
      width: 480,
      height: 812,
    });
  });

  it("falls back generously for an unmeasured card, and small for notes", () => {
    expect(builderNodeSize(node("a", 0, 0) as never).height).toBeGreaterThanOrEqual(300);
    expect(builderNodeSize(node("n", 0, 0, undefined, "note") as never)).toEqual({
      width: 224,
      height: 110,
    });
  });

  it("ignores zero or negative measurements", () => {
    expect(builderNodeSize(node("a", 0, 0, { width: 0, height: 0 }) as never).width).toBe(480);
  });
});

describe("autoLayoutNodes sizes rows to their tallest card", () => {
  // Two branches off one parent. The branch cards are far taller than the old
  // fixed 280px ROW_GAP, which is exactly when cards used to overlap.
  const nodes = [
    node("start", 0, 0, { width: 480, height: 300 }),
    node("tall", 0, 0, { width: 480, height: 900 }),
    node("short", 0, 0, { width: 480, height: 200 }),
  ];
  (nodes[0]!.data as { transitions: unknown[] }).transitions = [
    { id: "t1", target: "tall" },
    { id: "t2", target: "short" },
  ];
  const edges = [
    { id: "e1", source: "start", target: "tall", sourceHandle: "t1" },
    { id: "e2", source: "start", target: "short", sourceHandle: "t2" },
  ] as never;

  const out = autoLayoutNodes(nodes as never, edges);

  it("produces no overlapping cards", () => {
    expect(overlappingPairs(out as never)).toEqual([]);
  });

  it("clears the 900px card before starting the next row", () => {
    const tall = out.find((n) => n.id === "tall")!;
    const short = out.find((n) => n.id === "short")!;
    // Whichever sits lower must begin below the other's full height.
    const [upper, lower] = tall.position.y <= short.position.y ? [tall, short] : [short, tall];
    const upperH = builderNodeSize(upper as never).height;
    expect(lower.position.y).toBeGreaterThanOrEqual(upper.position.y + upperH);
  });

  it("puts children to the right of the parent", () => {
    const start = out.find((n) => n.id === "start")!;
    for (const id of ["tall", "short"]) {
      expect(out.find((n) => n.id === id)!.position.x).toBeGreaterThan(start.position.x);
    }
  });
});

describe("resolveNodeOverlaps", () => {
  const big = { width: 480, height: 400 };

  it("slides a dropped card clear of the one underneath it", () => {
    const nodes = [node("a", 100, 100, big), node("b", 120, 140, big)];
    const out = resolveNodeOverlaps(nodes, { moveIds: ["b"] });
    expect(overlappingPairs(out)).toEqual([]);
    // The anchor never moves; only the card being settled does.
    expect(out.find((n) => n.id === "a")!.position).toEqual({ x: 100, y: 100 });
    expect(out.find((n) => n.id === "b")!.position.y).toBeGreaterThan(140);
  });

  it("keeps the dropped card in the column it was dropped in", () => {
    const nodes = [node("a", 100, 100, big), node("b", 120, 140, big)];
    const out = resolveNodeOverlaps(nodes, { moveIds: ["b"] });
    expect(out.find((n) => n.id === "b")!.position.x).toBe(120);
  });

  it("leaves a graph that already has clear space completely untouched", () => {
    const nodes = [node("a", 100, 100, big), node("b", 100, 900, big)];
    expect(resolveNodeOverlaps(nodes, { moveIds: ["b"] })).toBe(nodes);
  });

  it("never moves an anchor, even when the overlap is the anchor's fault", () => {
    const nodes = [node("a", 100, 100, big), node("b", 100, 120, big)];
    const out = resolveNodeOverlaps(nodes, { moveIds: ["a"] });
    expect(out.find((n) => n.id === "b")!.position).toEqual({ x: 100, y: 120 });
    expect(overlappingPairs(out)).toEqual([]);
  });

  it("settles several inserted cards against each other, not just the anchors", () => {
    const nodes = [
      node("anchor", 100, 100, big),
      node("new1", 100, 110, big),
      node("new2", 100, 120, big),
    ];
    const out = resolveNodeOverlaps(nodes, { moveIds: ["new1", "new2"] });
    expect(overlappingPairs(out)).toEqual([]);
  });

  it("ignores notes, which are meant to sit over the flow", () => {
    const nodes = [node("a", 100, 100, big), node("note1", 110, 110, undefined, "note")];
    expect(resolveNodeOverlaps(nodes, { moveIds: ["note1"] })).toBe(nodes);
  });

  it("is a no-op with nothing to move", () => {
    const nodes = [node("a", 0, 0, big), node("b", 0, 0, big)];
    expect(resolveNodeOverlaps(nodes, { moveIds: [] })).toBe(nodes);
  });

  it("terminates on a pile of identically placed cards", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => node(`n${i}`, 0, 0, big));
    const out = resolveNodeOverlaps(nodes, { moveIds: nodes.slice(1).map((n) => n.id) });
    expect(overlappingPairs(out)).toEqual([]);
  });
});
