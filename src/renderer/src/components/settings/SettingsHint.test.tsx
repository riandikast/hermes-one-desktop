import { fireEvent } from "@testing-library/react";
import { expect, it } from "vitest";
import { renderWithI18n } from "../../test/renderWithI18n";
import SettingsHint from "./SettingsHint";

it("keeps help in a keyboard-focusable native disclosure with its original id and content", () => {
  const view = renderWithI18n(
    <SettingsHint id="setting-description">
      <code>agent.max_turns</code> — Maximum iterations.
    </SettingsHint>,
  );
  const trigger = view.getByLabelText("More information");
  const details = trigger.parentElement as HTMLDetailsElement;
  const content = view.getByText("agent.max_turns").parentElement!;

  expect(details.tagName).toBe("DETAILS");
  expect(content.id).toBe("setting-description");
  expect(details.open).toBe(false);
  expect(trigger.tagName).toBe("SUMMARY");
  expect(details.firstElementChild).toBe(trigger);
  expect(trigger.closest("label")).toBeNull();
  expect(trigger.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  // Native summary handles Enter/Space in the browser; jsdom only implements
  // click activation, so verify its keyboard focus without faking key defaults.
  trigger.focus();
  expect(document.activeElement).toBe(trigger);

  fireEvent.click(trigger);
  expect(details.open).toBe(true);
  expect(content).toHaveClass("settings-hint-content");
  expect(content).toHaveTextContent("agent.max_turns — Maximum iterations.");
  fireEvent.click(trigger);
  expect(details.open).toBe(false);
  expect(document.getElementById("setting-description")).toBe(content);
  expect(details).toContainElement(content);
});
