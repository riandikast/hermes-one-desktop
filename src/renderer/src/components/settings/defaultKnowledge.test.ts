import { beforeEach, describe, expect, it } from "vitest";
import {
  readDefaultKnowledge,
  sessionStartKnowledge,
  writeDefaultKnowledge,
} from "./defaultKnowledge";

beforeEach(() => {
  localStorage.clear();
});

describe("default knowledge bundles", () => {
  it("starts with none selected", () => {
    expect(readDefaultKnowledge()).toEqual([]);
  });

  it("stores names in selection order without duplicates or blanks", () => {
    expect(writeDefaultKnowledge(["beta", "alpha", "beta", "  "])).toBe(true);
    expect(JSON.parse(localStorage.getItem("hermes.knowledge.defaults")!)).toEqual([
      "beta",
      "alpha",
    ]);
    expect(readDefaultKnowledge()).toEqual(["beta", "alpha"]);
  });

  it("falls back to none for malformed storage", () => {
    localStorage.setItem("hermes.knowledge.defaults", "{not json");
    expect(readDefaultKnowledge()).toEqual([]);
    localStorage.setItem("hermes.knowledge.defaults", JSON.stringify({ a: 1 }));
    expect(readDefaultKnowledge()).toEqual([]);
    localStorage.setItem("hermes.knowledge.defaults", JSON.stringify([1, null, "ok"]));
    expect(readDefaultKnowledge()).toEqual(["ok"]);
  });

  it("gives new sessions the defaults and existing sessions nothing extra", () => {
    writeDefaultKnowledge(["alpha"]);
    // No session id yet = a new chat (including a fresh tab or project chat).
    expect(sessionStartKnowledge(null)).toEqual(["alpha"]);
    expect(sessionStartKnowledge(undefined)).toEqual(["alpha"]);
    // A reopened session keeps its own stored selection (loaded separately).
    expect(sessionStartKnowledge("session-1")).toEqual([]);
  });

  it("lets an explicit handoff win, including an empty one", () => {
    writeDefaultKnowledge(["alpha"]);
    expect(sessionStartKnowledge(null, ["beta"])).toEqual(["beta"]);
    // A handoff that deliberately carries no bundles must not inherit defaults.
    expect(sessionStartKnowledge(null, [])).toEqual([]);
  });
});
