import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OpenLeadLink } from "@/components/whatsapp/OpenLeadLink";

describe("OpenLeadLink", () => {
  it("takes an agent to the linked CRM record", () => {
    render(<OpenLeadLink leadId="7c30d1f3-29f2-4d8a-8a76-2a4a1ca70d66" />);

    expect(screen.getByRole("link", { name: /open lead/i }).getAttribute("href")).toBe(
      "/leads?id=7c30d1f3-29f2-4d8a-8a76-2a4a1ca70d66",
    );
  });

  it("does not render a lead link for unlinked conversations", () => {
    const { container } = render(<OpenLeadLink leadId={null} />);

    expect(container.firstChild).toBeNull();
  });
});
