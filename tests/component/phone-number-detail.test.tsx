import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PhoneNumberDetail } from "@/components/telephony/PhoneNumberDetail";

afterEach(cleanup);
const number = {
  id: "number-1",
  phone_number: "+14155550100",
  friendly_name: "Reception",
  provider: "twilio",
  agent_id: "agent-1",
};
function setup(onRename = vi.fn(async () => {})) {
  render(
    <PhoneNumberDetail
      number={number}
      agents={[{ id: "agent-1", name: "Receptionist" }]}
      onBack={vi.fn()}
      onRename={onRename}
      onAssign={vi.fn(async () => "Saved")}
    />,
  );
  return { onRename };
}
describe("Phone number detail", () => {
  it("keeps unavailable capabilities disabled instead of pretending to configure them", () => {
    setup();
    expect(
      (screen.getByRole("button", { name: "Make an outbound call" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText("Fallback number") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByRole("switch").every((control) => control.hasAttribute("disabled"))).toBe(
      true,
    );
    expect(
      screen.getAllByRole("combobox").filter((control) => control.hasAttribute("disabled")),
    ).toHaveLength(3);
    expect(screen.queryByText(/disable inbound/i)).toBeNull();
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
    setup(
      vi.fn(async () => {
        throw new Error("Permission denied");
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit display name" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Permission denied");
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
