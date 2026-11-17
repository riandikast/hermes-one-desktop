import { describe, expect, it } from "vitest";
import {
  knowledgeChange,
  knowledgeChangeNotice,
  knowledgeKey,
  knowledgeNeedsDelivery,
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

describe("knowledgeNeedsDelivery", () => {
  const sent = { session: "s", index: "INDEX", compressions: null };
  it("delivers on the first turn, a new session or a changed index", () => {
    expect(knowledgeNeedsDelivery(null, sent)).toBe(true);
    expect(knowledgeNeedsDelivery(sent, { ...sent, session: "other" })).toBe(true);
    expect(knowledgeNeedsDelivery(sent, { ...sent, index: "EDITED" })).toBe(true);
  });
  it("skips an identical index already in the history", () => {
    expect(knowledgeNeedsDelivery(sent, sent)).toBe(false);
    expect(knowledgeNeedsDelivery(sent, { ...sent, compressions: 0 })).toBe(false);
  });
  it("redelivers after the history was compressed", () => {
    expect(knowledgeNeedsDelivery(sent, { ...sent, compressions: 1 })).toBe(true);
    expect(knowledgeNeedsDelivery({ ...sent, compressions: 2 }, { ...sent, compressions: 3 })).toBe(true);
    expect(knowledgeNeedsDelivery({ ...sent, compressions: 2 }, { ...sent, compressions: null })).toBe(false);
  });
});
