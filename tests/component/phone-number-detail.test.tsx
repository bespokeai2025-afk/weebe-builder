// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PhoneNumberDetail, parseVariableLines } from "@/components/telephony/PhoneNumberDetail";

afterEach(cleanup);
const number = {
  id: "number-1",
  phone_number: "+14155550100",
  friendly_name: "Reception",
  provider: "twilio",
  agent_id: "agent-1",
};
function setup(
  opts: {
    onRename?: () => Promise<void>;
    onSaveRouting?: (patch: unknown) => Promise<string>;
    onPlaceCall?: (input: unknown) => Promise<string>;
    numberOverride?: Record<string, unknown>;
  } = {},
) {
  const onRename = opts.onRename ?? vi.fn(async () => {});
  render(
    <PhoneNumberDetail
      number={{ ...number, ...(opts.numberOverride ?? {}) }}
      agents={[
        { id: "agent-1", name: "Receptionist" },
        { id: "agent-2", name: "Sales" },
      ]}
      onBack={vi.fn()}
      onRename={onRename}
      onAssign={vi.fn(async () => "Saved")}
      onSaveRouting={opts.onSaveRouting as never}
      onPlaceCall={opts.onPlaceCall as never}
    />,
  );
  return { onRename };
}

describe("Phone number detail", () => {
  it("keeps routing controls read-only when the page can't save them", () => {
    setup();
    expect(
      (screen.getByRole("button", { name: "Make an outbound call" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText("Fallback number") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByRole("switch").every((control) => control.hasAttribute("disabled"))).toBe(true);
    expect(screen.queryByText(/disable inbound/i)).toBeNull();
  });

  it("saves inbound settings: agent, webhook, countries and fallback", async () => {
    const onSaveRouting = vi.fn(async () => "Settings saved.");
    setup({ onSaveRouting });
    fireEvent.click(screen.getByLabelText("Add an inbound webhook"));
    fireEvent.change(screen.getByLabelText("Inbound webhook URL"), {
      target: { value: "https://crm.example.com/inbound" },
    });
    fireEvent.change(screen.getByLabelText("Allowed inbound countries"), { target: { value: "gb, ie" } });
    fireEvent.change(screen.getByLabelText("Fallback number"), { target: { value: "+447700900999" } });
    fireEvent.click(screen.getByRole("button", { name: "Save inbound settings" }));
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Settings saved.");
    expect(onSaveRouting).toHaveBeenCalledWith({
      inboundAgents: [{ agent_id: "agent-1", weight: 100 }],
      inboundWebhookUrl: "https://crm.example.com/inbound",
      fallbackNumber: "+447700900999",
      allowedInboundCountries: ["GB", "IE"],
    });
  });

  it("refuses an http webhook and a malformed fallback number without saving", async () => {
    const onSaveRouting = vi.fn(async () => "Settings saved.");
    setup({ onSaveRouting });
    fireEvent.click(screen.getByLabelText("Add an inbound webhook"));
    fireEvent.change(screen.getByLabelText("Inbound webhook URL"), { target: { value: "http://insecure.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save inbound settings" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/https/);
    expect(onSaveRouting).not.toHaveBeenCalled();
  });

  it("shows existing A/B weights as percentages", () => {
    setup({
      onSaveRouting: vi.fn(async () => "ok"),
      numberOverride: {
        inbound_agents: [
          { agent_id: "agent-1", weight: 0.7 },
          { agent_id: "agent-2", weight: 0.3 },
        ],
      },
    });
    expect((screen.getByLabelText("inbound agent 1 share (%)") as HTMLInputElement).value).toBe("70");
    expect((screen.getByLabelText("inbound agent 2 share (%)") as HTMLInputElement).value).toBe("30");
  });

  it("places an outbound call with dynamic variables", async () => {
    const onPlaceCall = vi.fn(async () => "Calling +447700900123.");
    setup({ onPlaceCall });
    fireEvent.click(screen.getByRole("button", { name: "Make an outbound call" }));
    fireEvent.change(screen.getByLabelText("Number to call"), { target: { value: "+447700900123" } });
    fireEvent.change(screen.getByLabelText("Dynamic variables (optional)"), {
      target: { value: "first_name=Jane\naddress=42 Baker Street" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Call now" }));
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Calling +447700900123.");
    expect(onPlaceCall).toHaveBeenCalledWith({
      to: "+447700900123",
      dynamicVariables: { first_name: "Jane", address: "42 Baker Street" },
    });
  });

  it("saves the name through the provided persistence function", async () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit display name" }));
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: " Sales " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Name saved.");
    expect(onRename).toHaveBeenCalledWith("Sales");
  });

  it("retains the name editor and reports persistence errors without a success message", async () => {
    setup({
      onRename: vi.fn(async () => {
        throw new Error("Permission denied");
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit display name" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Permission denied");
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("parseVariableLines", () => {
  it("reads key=value lines and skips the rest", () => {
    expect(parseVariableLines("a=1\n  b = two words \nnot a pair\n=empty key\nc=")).toEqual({
      a: "1",
      b: "two words",
      c: "",
    });
  });
});
