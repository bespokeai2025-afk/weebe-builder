import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PhoneNumberWorkspace } from "@/components/telephony/PhoneNumberWorkspace";

afterEach(cleanup);
it("keeps the detail visible while searching and selecting a different number", () => {
  const onSelect = vi.fn();
  render(
    <PhoneNumberWorkspace
      numbers={[
        { id: "one", phone_number: "+14155550100", friendly_name: "Support", provider: "twilio" },
        { id: "two", phone_number: "+14155550101", friendly_name: "Sales", provider: "twilio" },
      ]}
      selectedId="one"
      onSelect={onSelect}
      actions={<button>Add number</button>}
    >
      <h2>Selected number settings</h2>
    </PhoneNumberWorkspace>,
  );
  expect(screen.getByRole("button", { name: /Support/ }).getAttribute("aria-current")).toBe("true");
  fireEvent.change(screen.getByLabelText("Search phone numbers"), { target: { value: "sales" } });
  expect(screen.queryByRole("button", { name: /Support/ })).toBeNull();
  expect(screen.getByRole("heading", { name: "Selected number settings" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Sales/ }));
  expect(onSelect).toHaveBeenCalledWith("two");
});
