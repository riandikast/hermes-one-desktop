import { describe, expect, it } from "vitest";
import source from "./MessageList.tsx?raw";

describe("transcript render hot path", () => {
  it("does not serialize all message identities as a redundant memo dependency", () => {
    expect(source.length).toBeGreaterThan(1000);
    // visibleMessages already invalidates turnRows on every message update.
    expect(source).not.toContain("structuralSig");
  });
});
