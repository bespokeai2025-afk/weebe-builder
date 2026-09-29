import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SipNumberForm } from "@/components/telephony/SipNumberForm";

afterEach(cleanup);
function setup(
  onSubmit = vi.fn(async () => ({ warning: null as string | null })),
  agents = [{ id: "agent-1", name: "Reception" }],
) {
  render(
    <SipNumberForm
      agents={agents}
      loading={false}
      loadError={false}
      onRetry={vi.fn()}
      onCancel={vi.fn()}
      onBusyChange={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}
function fill() {
  fireEvent.change(screen.getByLabelText("Phone number *"), { target: { value: "+14155550100" } });
  fireEvent.change(screen.getByLabelText("Carrier termination URI *"), {
    target: { value: "example.pstn.twilio.com" },
  });
  fireEvent.change(screen.getByLabelText("OmniVoice agent *"), { target: { value: "agent-1" } });
  fireEvent.change(screen.getByLabelText("SIP password (optional)"), {
    target: { value: "test-secret" },
  });
}
it("submits SIP fields and clears the password after import", async () => {
  const submit = setup();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Import SIP number" }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: "+14155550100",
        direction: "both",
        sipPassword: "test-secret",
      }),
    ),
  );
  await screen.findByText("Number imported. Live connectivity has not been verified.");
  expect((screen.getByLabelText("SIP password (optional)") as HTMLInputElement).value).toBe("");
});
it("shows errors without claiming success and allows retry", async () => {
  setup(
    vi.fn(async () => {
      throw new Error("Import was not confirmed.");
    }),
  );
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Import SIP number" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Import was not confirmed");
  expect(
    (screen.getByRole("button", { name: "Import SIP number" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
it("prevents reimport on a partial-success warning", async () => {
  setup(
    vi.fn(async () => ({ warning: "Imported but directory save failed. Do not import again." })),
  );
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Import SIP number" }));
  await screen.findByText("Imported but directory save failed. Do not import again.");
  expect(
    (screen.getByRole("button", { name: "Import SIP number" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it("blocks submission when there are no compatible agents", () => {
  setup(undefined, []);
  expect(
    (screen.getByRole("button", { name: "Import SIP number" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
