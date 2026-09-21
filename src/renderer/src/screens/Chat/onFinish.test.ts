import { beforeEach, describe, expect, it } from "vitest";
import {
  ON_FINISH_SELECTION_KEY,
  moveOnFinishSelection,
  readOnFinishArmed,
  readOnFinishSelection,
  resolveOnFinishCommands,
  toggleOnFinishSelection,
  writeOnFinishArmed,
  writeOnFinishSelection,
} from "./onFinish";

beforeEach(() => {
  localStorage.clear();
});

describe("toggleOnFinishSelection — order IS the selection sequence", () => {
  it("appends newly selected commands, so the newest pick runs last", () => {
    let sel: string[] = [];
    sel = toggleOnFinishSelection(sel, "c");
    sel = toggleOnFinishSelection(sel, "a");
    sel = toggleOnFinishSelection(sel, "b");
    expect(sel).toEqual(["c", "a", "b"]);
  });

  it("deselects when an already-selected command is clicked again", () => {
    // Checkbox semantics. Changing an item's position is a separate action
    // (move up/down) so a stray click can never silently reorder the run.
    const sel = toggleOnFinishSelection(["a", "b", "c"], "a");
    expect(sel).toEqual(["b", "c"]);
  });

  it("removes on deselect and closes the gap, preserving relative order", () => {
    const sel = toggleOnFinishSelection(["a", "b", "c"], "b");
    expect(sel).toEqual(["a", "c"]);
  });

  it("supports selecting many, then deselecting one", () => {
    let sel: string[] = [];
    for (const id of ["one", "two", "three", "four"]) {
      sel = toggleOnFinishSelection(sel, id);
    }
    expect(sel).toEqual(["one", "two", "three", "four"]);
    sel = toggleOnFinishSelection(sel, "three");
    expect(sel).toEqual(["one", "two", "four"]);
  });
});

describe("moveOnFinishSelection", () => {
  it("moves an item earlier and later by one slot", () => {
    expect(moveOnFinishSelection(["a", "b", "c"], "c", -1)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(moveOnFinishSelection(["a", "b", "c"], "a", 1)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("clamps at the ends instead of wrapping", () => {
    expect(moveOnFinishSelection(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(moveOnFinishSelection(["a", "b"], "b", 1)).toEqual(["a", "b"]);
  });

  it("returns a copy, never mutating the input", () => {
    const input = ["a", "b"];
    moveOnFinishSelection(input, "a", 1);
    expect(input).toEqual(["a", "b"]);
  });
});

describe("persistence round-trip preserves order", () => {
  it("writes explicit indices and reads back the same sequence", () => {
    writeOnFinishSelection(["zebra", "alpha", "mango"]);
    // Stored order must be selection order, NOT alphabetical or insertion-id
    // order — that is the entire point of the feature.
    expect(readOnFinishSelection()).toEqual(["zebra", "alpha", "mango"]);
  });

  it("stores an ordered record array, not a plain set-like list", () => {
    writeOnFinishSelection(["b", "a"]);
    const raw = JSON.parse(localStorage.getItem(ON_FINISH_SELECTION_KEY)!);
    expect(raw).toEqual([
      { id: "b", order: 0 },
      { id: "a", order: 1 },
    ]);
  });

  it("honours an explicit order field over array position", () => {
    localStorage.setItem(
      ON_FINISH_SELECTION_KEY,
      JSON.stringify([
        { id: "second", order: 1 },
        { id: "first", order: 0 },
      ]),
    );
    expect(readOnFinishSelection()).toEqual(["first", "second"]);
  });

  it("accepts bare ids (position = order) for forward compatibility", () => {
    localStorage.setItem(ON_FINISH_SELECTION_KEY, JSON.stringify(["one", "two"]));
    expect(readOnFinishSelection()).toEqual(["one", "two"]);
  });

  it("de-duplicates while keeping the first occurrence's position", () => {
    localStorage.setItem(
      ON_FINISH_SELECTION_KEY,
      JSON.stringify(["a", "b", "a"]),
    );
    expect(readOnFinishSelection()).toEqual(["a", "b"]);
  });

  it("returns empty for corrupt or absent values rather than throwing", () => {
    expect(readOnFinishSelection()).toEqual([]);
    localStorage.setItem(ON_FINISH_SELECTION_KEY, "{not json");
    expect(readOnFinishSelection()).toEqual([]);
    localStorage.setItem(ON_FINISH_SELECTION_KEY, JSON.stringify({ a: 1 }));
    expect(readOnFinishSelection()).toEqual([]);
    localStorage.setItem(ON_FINISH_SELECTION_KEY, JSON.stringify([null, 7, ""]));
    expect(readOnFinishSelection()).toEqual([]);
  });
});

describe("resolveOnFinishCommands", () => {
  const commands = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ];

  it("returns commands in SELECTION order, not list order", () => {
    const out = resolveOnFinishCommands(["c", "a", "b"], commands);
    expect(out.map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("drops ids whose command was deleted", () => {
    const out = resolveOnFinishCommands(["c", "gone", "a"], commands);
    expect(out.map((c) => c.id)).toEqual(["c", "a"]);
  });
});

describe("arm flag is per-session", () => {
  it("does not leak arming between sessions", () => {
    writeOnFinishArmed("session-1", true);
    expect(readOnFinishArmed("session-1")).toBe(true);
    expect(readOnFinishArmed("session-2")).toBe(false);
  });

  it("defaults to disarmed", () => {
    expect(readOnFinishArmed("never-set")).toBe(false);
  });
});
