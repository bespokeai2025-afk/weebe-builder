// @vitest-environment jsdom
/**
 * Splitting the generated brief into the parts a rep uses separately.
 *
 * The demo checklist is ticked off while setting a demo up, and the hook is the line actually said
 * first — both are used away from the rest of the prose, so both are lifted out of it. If a split
 * ever fails it must fall back to showing the whole brief, never silently drop a section.
 */
import { describe, expect, it } from "vitest";
import {
  isAssistantTargetId,
  splitChecklist,
  splitHook,
} from "@/components/leads/LeadAiAssistantPanel";

const DEMO = `## Demo checklist
- [ ] Load two Arabian Ranches listings into the sandbox
- [ ] Confirm the CRM sync sandbox is reachable
- [x] Rehearse the handover to a human agent

## What to demonstrate
1. Inbound receptionist
2. CRM write-back

## Suggested scenario
A seller calls about a villa.`;

const PITCH = `## Hook
"Twelve missed calls a week is a villa you did not sell."

## Opening line
Hi Jane — I noticed Acme lists twenty properties.

## Selling points
- Answers every call`;

describe("splitChecklist", () => {
  it("lifts the checklist items out of the brief", () => {
    const { items } = splitChecklist(DEMO);
    expect(items).toEqual([
      "Load two Arabian Ranches listings into the sandbox",
      "Confirm the CRM sync sandbox is reachable",
      "Rehearse the handover to a human agent",
    ]);
  });

  it("removes the checklist section from the remaining brief, without losing the rest", () => {
    const { rest } = splitChecklist(DEMO);
    expect(rest).not.toContain("Demo checklist");
    expect(rest).not.toContain("Load two Arabian Ranches");
    expect(rest).toContain("## What to demonstrate");
    expect(rest).toContain("## Suggested scenario");
    expect(rest).toContain("A seller calls about a villa.");
  });

  it("accepts a plain bullet list when the model omits the boxes", () => {
    const { items } = splitChecklist(
      "## Demo checklist\n- First thing\n- Second thing\n\n## Next\nx",
    );
    expect(items).toEqual(["First thing", "Second thing"]);
  });

  it("leaves a brief with no checklist completely intact", () => {
    // Sales Pitch and Meeting Planner have no checklist — they must not be altered.
    const { items, rest } = splitChecklist(PITCH);
    expect(items).toEqual([]);
    expect(rest).toBe(PITCH);
  });

  it("falls back to the whole brief if the heading is there but empty", () => {
    const md = "## Demo checklist\n\n## What to demonstrate\nShow it";
    expect(splitChecklist(md).items).toEqual([]);
    expect(splitChecklist(md).rest).toBe(md);
  });
});

describe("splitHook", () => {
  it("lifts the hook out and strips the surrounding quotes", () => {
    expect(splitHook(PITCH).hook).toBe("Twelve missed calls a week is a villa you did not sell.");
  });

  it("keeps the rest of the pitch", () => {
    const { rest } = splitHook(PITCH);
    expect(rest).not.toContain("## Hook");
    expect(rest).toContain("## Opening line");
    expect(rest).toContain("## Selling points");
  });

  it("leaves a brief with no hook intact", () => {
    const { hook, rest } = splitHook(DEMO);
    expect(hook).toBeNull();
    expect(rest).toBe(DEMO);
  });

  it("composes with the checklist split without either eating the other", () => {
    const both = `## Hook\nOne good line\n\n${DEMO}`;
    const afterChecklist = splitChecklist(both);
    const afterHook = splitHook(afterChecklist.rest);
    expect(afterChecklist.items).toHaveLength(3);
    expect(afterHook.hook).toBe("One good line");
    expect(afterHook.rest).toContain("## What to demonstrate");
  });
});

/**
 * Which rows the assistant can be opened on.
 *
 * The Leads page renders two different datasets through the same table. The WBAH tab is derived
 * from wbah_calls, whose ids are Retell call ids like "call_d4504de7010e997dd8cb0a729d7" — passing
 * one to the assistant produced a raw zod dump in the toast.
 */
describe("isAssistantTargetId", () => {
  it("accepts a real lead or data-record id", () => {
    expect(isAssistantTargetId("0000282d-1b78-44a3-a168-879585e82ff0")).toBe(true);
    expect(isAssistantTargetId("82c2356c-87ce-4d6a-959c-5ccb4540ea07")).toBe(true);
  });

  it("rejects a Retell call id, which is what the WBAH tab rows carry", () => {
    expect(isAssistantTargetId("call_d4504de7010e997dd8cb0a729d7")).toBe(false);
  });

  it("rejects missing or malformed ids rather than letting them reach the server", () => {
    expect(isAssistantTargetId(null)).toBe(false);
    expect(isAssistantTargetId(undefined)).toBe(false);
    expect(isAssistantTargetId("")).toBe(false);
    expect(isAssistantTargetId("not-a-uuid")).toBe(false);
    expect(isAssistantTargetId("0000282d1b7844a3a168879585e82ff0")).toBe(false);
  });
});
