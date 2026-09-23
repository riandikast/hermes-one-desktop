import { describe, expect, it, beforeEach } from "vitest";
import {
  ON_FINISH_SELECTION_KEY,
  readAllOnFinishSelections,
  readOnFinishSelection,
  removeOnFinishSelectionEverywhere,
  writeOnFinishSelection,
} from "./onFinish";

/**
 * The Commands page unions the queue across ALL scopes, so a command is visible
 * if any scope selected it. Removal must therefore sweep every scope — clearing
 * one would leave the row on screen.
 */
describe("removeOnFinishSelectionEverywhere", () => {
  beforeEach(() => localStorage.clear());

  it("removes the command from the default scope", () => {
    writeOnFinishSelection(["a", "b"]);
    expect(removeOnFinishSelectionEverywhere("a")).toBe(1);
    expect(readOnFinishSelection("default")).toEqual(["b"]);
  });

  it("removes it from EVERY session scope, not just one", () => {
    writeOnFinishSelection(["a"], "default");
    writeOnFinishSelection(["a", "b"], "session-1");
    writeOnFinishSelection(["a"], "session-2");

    // This is the regression: removing from only the first scope found would
    // leave the union still reporting "a".
    expect(readAllOnFinishSelections()).toContain("a");
    expect(removeOnFinishSelectionEverywhere("a")).toBe(3);
    expect(readAllOnFinishSelections()).not.toContain("a");
    // Untouched ids survive in their scope.
    expect(readOnFinishSelection("session-1")).toEqual(["b"]);
  });

  it("preserves the order of the remaining commands", () => {
    writeOnFinishSelection(["first", "remove-me", "last"]);
    removeOnFinishSelectionEverywhere("remove-me");
    expect(readOnFinishSelection("default")).toEqual(["first", "last"]);
  });

  it("reports 0 when the command was not queued anywhere", () => {
    writeOnFinishSelection(["a"]);
    expect(removeOnFinishSelectionEverywhere("nope")).toBe(0);
    expect(readOnFinishSelection("default")).toEqual(["a"]);
  });

  it("handles the unscoped legacy key too", () => {
    localStorage.setItem(
      ON_FINISH_SELECTION_KEY,
      JSON.stringify([{ id: "legacy", order: 0 }]),
    );
    expect(removeOnFinishSelectionEverywhere("legacy")).toBe(1);
    expect(readAllOnFinishSelections()).not.toContain("legacy");
  });

  it("is a no-op when the queue is empty", () => {
    expect(removeOnFinishSelectionEverywhere("a")).toBe(0);
  });

  it("notifies listeners so the Commands page refreshes", () => {
    let fired = 0;
    const on = (): void => {
      fired += 1;
    };
    window.addEventListener("hermes:onFinishChanged", on);
    writeOnFinishSelection(["a"]);
    removeOnFinishSelectionEverywhere("a");
    window.removeEventListener("hermes:onFinishChanged", on);
    expect(fired).toBeGreaterThanOrEqual(2); // write + remove
  });
});
