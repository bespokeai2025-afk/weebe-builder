/**
 * AI Sales Assistant — the rules that decide what the model is told.
 *
 * The feature's whole value is being lead-specific, so the tests that matter are: does a recorded
 * objection actually reach the prompt, and is the URL we fetch server-side safe to fetch. The
 * research URL comes from imported spreadsheet data, which makes it untrusted input for a
 * server-side request.
 */
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_MODES,
  buildAssistantPrompt,
  htmlToText,
  isSafeResearchUrl,
  resolveResearchUrl,
  type AssistantSubject,
} from "@/lib/leads/sales-assistant.shared";

const SUBJECT: AssistantSubject = {
  id: "lead-1",
  kind: "lead",
  name: "Jane Smith",
  company: "Acme Dental",
  email: "jane@acmedental.co.uk",
  phone: "+447700900000",
  facts: [
    {
      label: "Objections raised",
      value: "Interested in AI receptionist but worried about CRM integration",
    },
    { label: "Pipeline stage", value: "Demo booked" },
  ],
  history: [
    { at: "2026-09-10T10:00:00Z", kind: "call, positive", text: "Liked the receptionist demo" },
    { at: "2026-09-11T09:00:00Z", kind: "note", text: "Asked whether it syncs with Dentally" },
  ],
};

describe("resolveResearchUrl", () => {
  it("prefers an explicit website column whatever the import called it", () => {
    for (const key of ["website", "Website", "company_website", "Company URL", "domain"]) {
      expect(resolveResearchUrl({ [key]: "acme.com" }, null)).toBe("https://acme.com");
    }
  });

  it("accepts a column that already includes the scheme", () => {
    expect(resolveResearchUrl({ website: "https://acme.com/about" }, null)).toBe(
      "https://acme.com/about",
    );
  });

  it("falls back to the email domain for a company address", () => {
    expect(resolveResearchUrl(null, "jane@acmedental.co.uk")).toBe("https://acmedental.co.uk");
  });

  it("never researches a free-mail domain, which says nothing about the company", () => {
    for (const addr of ["a@gmail.com", "b@hotmail.co.uk", "c@outlook.com", "d@icloud.com"]) {
      expect(resolveResearchUrl(null, addr)).toBeNull();
    }
  });

  it("returns null when there is nothing to research", () => {
    expect(resolveResearchUrl(null, null)).toBeNull();
    expect(resolveResearchUrl({ unrelated: "x" }, "")).toBeNull();
  });

  it("does not return an unsafe URL even when a column supplies one", () => {
    expect(resolveResearchUrl({ website: "http://10.0.0.5" }, null)).toBeNull();
    expect(resolveResearchUrl({ website: "localhost" }, null)).toBeNull();
  });
});

describe("isSafeResearchUrl", () => {
  it("allows an ordinary company site", () => {
    expect(isSafeResearchUrl("https://acme.com")).toBe(true);
    expect(isSafeResearchUrl("https://www.acme.co.uk/about")).toBe(true);
  });

  it("refuses anything but https", () => {
    expect(isSafeResearchUrl("http://acme.com")).toBe(false);
    expect(isSafeResearchUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeResearchUrl("gopher://acme.com")).toBe(false);
  });

  it("refuses the internal network and cloud metadata", () => {
    // The reason this guard exists: without it the feature is an SSRF hole.
    for (const host of [
      "https://localhost",
      "https://127.0.0.1",
      "https://10.0.0.5",
      "https://192.168.1.1",
      "https://172.16.0.1",
      "https://169.254.169.254",
      "https://db.internal",
      "https://printer.local",
    ]) {
      expect(isSafeResearchUrl(host)).toBe(false);
    }
  });

  it("refuses a bare hostname with no dot", () => {
    expect(isSafeResearchUrl("https://intranet")).toBe(false);
  });

  it("refuses malformed input rather than throwing", () => {
    expect(isSafeResearchUrl("not a url")).toBe(false);
    expect(isSafeResearchUrl("")).toBe(false);
  });
});

describe("htmlToText", () => {
  it("drops scripts, styles and tags", () => {
    const out = htmlToText(
      "<html><head><style>.a{color:red}</style><script>evil()</script></head><body><h1>Acme</h1><p>We fit&nbsp;kitchens</p></body></html>",
    );
    expect(out).toContain("Acme");
    expect(out).toContain("We fit kitchens");
    expect(out).not.toContain("evil()");
    expect(out).not.toContain("color:red");
    expect(out).not.toContain("<");
  });

  it("caps the length so a huge page cannot fill the prompt", () => {
    expect(htmlToText(`<p>${"x".repeat(50_000)}</p>`, 500).length).toBe(500);
  });
});

describe("buildAssistantPrompt", () => {
  it("puts the lead's recorded objection in the prompt", () => {
    // The example from the brief: this must not be treated as a new prospect.
    const prompt = buildAssistantPrompt(SUBJECT, "meeting", null);
    expect(prompt).toContain("worried about CRM integration");
  });

  it("includes previous activity and tells the model not to start from scratch", () => {
    const prompt = buildAssistantPrompt(SUBJECT, "demo", null);
    expect(prompt).toContain("Liked the receptionist demo");
    expect(prompt).toContain("Asked whether it syncs with Dentally");
    expect(prompt).toContain("Do NOT treat this lead as a new prospect");
  });

  it("says plainly when there is no history, rather than implying there is", () => {
    const prompt = buildAssistantPrompt({ ...SUBJECT, history: [] }, "pitch", null);
    expect(prompt).toContain("None recorded");
  });

  it("includes research and attributes it to the page it came from", () => {
    const prompt = buildAssistantPrompt(SUBJECT, "pitch", {
      url: "https://acmedental.co.uk",
      text: "Acme Dental is a six-surgery private practice in Leeds.",
    });
    expect(prompt).toContain("six-surgery private practice");
    expect(prompt).toContain("https://acmedental.co.uk");
  });

  it("tells the model not to invent facts when research failed", () => {
    const prompt = buildAssistantPrompt(SUBJECT, "pitch", null);
    expect(prompt).toContain("Do not invent details");
  });

  it("asks for the sections each mode promises in the UI", () => {
    const pitch = buildAssistantPrompt(SUBJECT, "pitch", null);
    expect(pitch).toContain("## Hook");
    expect(pitch).toContain("## Say this");
    const meeting = buildAssistantPrompt(SUBJECT, "meeting", null);
    expect(meeting).toContain("## Objective");
    expect(meeting).toContain("## Objections and responses");
    const demo = buildAssistantPrompt(SUBJECT, "demo", null);
    expect(demo).toContain("## Demo checklist");
    expect(demo).toContain("## Suggested scenario");
  });

  it("asks for the checklist in the tickable form the panel parses", () => {
    // The panel lifts "- [ ] item" lines out into its own checklist block.
    expect(buildAssistantPrompt(SUBJECT, "demo", null)).toContain('"- [ ] item"');
  });

  it("caps the hook so it stays a line, not a paragraph", () => {
    expect(buildAssistantPrompt(SUBJECT, "pitch", null)).toMatch(/12 words or fewer/i);
  });

  it("budgets the spoken pitch to about 30 seconds", () => {
    expect(buildAssistantPrompt(SUBJECT, "pitch", null)).toMatch(/70-85\s*words/);
  });

  it("works for a record with no company or email, as CSV imports often are", () => {
    const bare: AssistantSubject = {
      id: "rec-1",
      kind: "record",
      name: "SUNDIP PAREKH",
      company: null,
      email: null,
      phone: "0566991800",
      facts: [{ label: "UNIT NUMBER", value: "ELIE SAAB II" }],
      history: [],
    };
    const prompt = buildAssistantPrompt(bare, "pitch", null);
    expect(prompt).toContain("SUNDIP PAREKH");
    expect(prompt).toContain("ELIE SAAB II");
    expect(prompt).toContain("Company: unknown");
  });
});

describe("ASSISTANT_MODES", () => {
  it("offers exactly the three the brief asks for", () => {
    expect(ASSISTANT_MODES.map((m) => m.id)).toEqual(["pitch", "meeting", "demo"]);
  });
});
