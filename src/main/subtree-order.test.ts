import { describe, expect, it } from "vitest";
import { collectSubtreeOrder } from "./subtree-order";

describe("collectSubtreeOrder", () => {
  it("returns just the root for a leaf", () => {
    expect(collectSubtreeOrder("a", () => [])).toEqual(["a"]);
  });

  it("orders a chain children-before-parents", () => {
    // a -> b -> c
    const childrenOf = (id: string): string[] => {
      if (id === "a") return ["b"];
      if (id === "b") return ["c"];
      return [];
    };
    const order = collectSubtreeOrder("a", childrenOf);
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("orders a branching tree children-before-parents", () => {
    // a -> [b, c]; b -> d
    const childrenOf = (id: string): string[] => {
      if (id === "a") return ["b", "c"];
      if (id === "b") return ["d"];
      return [];
    };
    const order = collectSubtreeOrder("a", childrenOf);
    for (const child of ["d", "b", "c"]) {
      expect(order.indexOf(child)).toBeLessThan(order.indexOf("a"));
    }
    expect(order.indexOf("d")).toBeLessThan(order.indexOf("b"));
    expect(new Set(order)).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("handles a diamond-shaped graph without infinite loops (visited via stack)", () => {
    // a -> [b, c]; b -> d; c -> d
    const childrenOf = (id: string): string[] => {
      if (id === "a") return ["b", "c"];
      if (id === "b" || id === "c") return ["d"];
      return [];
    };
    const order = collectSubtreeOrder("a", childrenOf);
    expect(order.length).toBe(4);
    expect(order.indexOf("d")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("d")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("a"));
  });
});
