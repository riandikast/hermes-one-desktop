import { describe, expect, it } from "vitest";
import { dashboardModelMatches, resolveDashboardProviderForModel } from "./useDashboardChatTransport";

const model = "oc/mimo-v2.6-flash-free";

describe("named provider runtime identity safety", () => {
  it("preserves the exact named provider and slash-bearing model", () => {
    expect(resolveDashboardProviderForModel("9r", model, undefined, {
      provider: "custom", model,
    })).toBe("9r");
    expect(dashboardModelMatches("9r", model, { provider: "9r", model })).toBe(true);
  });

  it("cannot prove named endpoint ownership from a bare custom status", () => {
    // Correct and wrong endpoints produce this identical session.status identity.
    // Installed-definition replay: scripts/probe-named-provider-identity.py.
    expect(dashboardModelMatches("9r", model, { provider: "custom", model })).toBe(false);
    expect(dashboardModelMatches("9r", model, { provider: "custom:other", model })).toBe(false);
  });

  it("rejects a different model even on the requested provider", () => {
    expect(dashboardModelMatches("9r", model, { provider: "9r", model: "different-model" })).toBe(false);
    expect(dashboardModelMatches("9r", model, { provider: "custom", model: "different-model" })).toBe(false);
  });
});
