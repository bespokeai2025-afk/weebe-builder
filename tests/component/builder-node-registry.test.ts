import { describe, expect, it } from "vitest";
import { defaultNodeData, paletteFor, getNodeDef, allNodeKinds } from "@/lib/builder/node-registry";

describe("builder node registry", () => {
  it("covers every NodeKind exactly once", () => {
    const kinds = allNodeKinds();
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toContain("conversation");
    expect(kinds).toContain("http_request");
    expect(kinds).toContain("wa_start");
  });

  it("keeps voice and WhatsApp palettes separate", () => {
    const voice = paletteFor("voice").map((d) => d.kind);
    const wa = paletteFor("whatsapp").map((d) => d.kind);
    expect(voice).toContain("conversation");
    expect(voice).not.toContain("wa_start");
    expect(wa).toContain("wa_start");
    expect(wa).not.toContain("conversation");
    expect(voice[0]).toBe("begin");
    expect(voice).toContain("mcp");
    expect(voice).toContain("wait");
    expect(voice).toContain("subagent");
    expect(wa[0]).toBe("wa_start");
  });

  it("applies per-kind default data without dropping shared fields", () => {
    const fn = defaultNodeData("function");
    expect(fn.kind).toBe("function");
    expect(fn.waitForResult).toBe(true);
    expect(fn.transitions).toEqual([]);
    expect(getNodeDef("ending").label).toBe("End Call");
    expect(defaultNodeData("conversation").instructionType).toBe("prompt");
    expect(defaultNodeData("begin").isStart).toBe(true);
    expect(defaultNodeData("wait").waitTimeoutMs).toBe(8000);
    expect(defaultNodeData("mcp").mcpServerUrl).toBe("");
  });
});
