import { describe, expect, it } from "vitest";
import {
  knowledgeChange,
  knowledgeChangeNotice,
  knowledgeKey,
} from "./knowledgeChange";

describe("knowledgeKey", () => {
  it("is order-independent", () => {
    expect(knowledgeKey(["a", "b"])).toBe(knowledgeKey(["b", "a"]));
  });

  it("ignores blanks, whitespace and duplicates", () => {
    expect(knowledgeKey([" a ", "", "a", "  "])).toBe(knowledgeKey(["a"]));
  });

  it("treats undefined and empty the same", () => {
    expect(knowledgeKey(undefined)).toBe(knowledgeKey([]));
  });

  it("distinguishes different sets", () => {
    expect(knowledgeKey(["a"])).not.toBe(knowledgeKey(["a", "b"]));
  });
});

describe("knowledgeChange", () => {
  it("returns null when the selection is unchanged", () => {
    expect(knowledgeChange(["a", "b"], ["b", "a"])).toBeNull();
  });

  it("returns null when nothing was seeded and nothing is selected", () => {
    expect(knowledgeChange([], [])).toBeNull();
  });

  it("detects an enable", () => {
    const change = knowledgeChange(["a"], ["a", "b"]);
    expect(change).not.toBeNull();
    expect(change!.summary).toBe("enabled “b”");
  });

  it("detects a disable", () => {
    const change = knowledgeChange(["a", "b"], ["a"]);
    expect(change!.summary).toBe("disabled “b”");
  });

  it("describes both directions at once", () => {
    const change = knowledgeChange(["a"], ["b"]);
    expect(change!.summary).toBe("enabled “b” and disabled “a”");
  });

  it("detects turning everything off", () => {
    const change = knowledgeChange(["a", "b"], []);
    expect(change!.summary).toBe("disabled “a”, “b”");
  });

  it("detects enabling from nothing", () => {
    const change = knowledgeChange([], ["a"]);
    expect(change!.summary).toBe("enabled “a”");
  });
});

describe("knowledgeChangeNotice", () => {
  it("names the bundle and sets the next-message expectation", () => {
    const notice = knowledgeChangeNotice("enabled “SS2”");
    expect(notice).toContain("enabled “SS2”");
    expect(notice).toContain("applies from your next message");
  });
});
