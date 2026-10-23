import { describe, expect, it } from "vitest";

import { groupModelsByProvider } from "./useModelConfig";

// The reported phantom provider: picking the active/default model in Settings ->
// Providers wrote a library row whose providerLabel was the picker's DISPLAY
// text ("Custom") instead of the real provider name. groupModelsByProvider then
// treated that as a named provider and the model dialog grew a second entry
// holding exactly one model.
const URL_9R = "http://localhost:20128/v1";

describe("groupModelsByProvider named custom providers", () => {
  it("merges a row whose label is the generic display text into the real provider", () => {
    const groups = groupModelsByProvider([
      { id: "a", name: "glm-5.3", provider: "custom", model: "cbai/glm-5.3", baseUrl: URL_9R, providerLabel: "9R" },
      { id: "b", name: "deepseek-v4-pro", provider: "custom", model: "cbai/deepseek-v4-pro", baseUrl: URL_9R, providerLabel: "Custom" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].providerLabel).toBe("9R");
    expect(groups[0].models.map((m) => m.model)).toEqual(["cbai/glm-5.3", "cbai/deepseek-v4-pro"]);
  });

  it("keeps genuinely distinct named providers apart", () => {
    const groups = groupModelsByProvider([
      { id: "a", name: "m", provider: "custom", model: "a/1", baseUrl: URL_9R, providerLabel: "9R" },
      { id: "b", name: "m", provider: "custom", model: "b/1", baseUrl: "http://other.invalid/v1", providerLabel: "Other" },
    ]);
    expect(groups.map((g) => g.providerLabel).sort()).toEqual(["9R", "Other"]);
  });

  it("does not label an unlabelled row with the generic bucket text", () => {
    const groups = groupModelsByProvider([
      { id: "a", name: "m", provider: "custom", model: "x/1", baseUrl: URL_9R, providerLabel: "9R" },
      { id: "b", name: "m", provider: "custom", model: "y/1", baseUrl: "http://local.invalid/v1" },
    ]);
    const local = groups.find((g) => g.models.some((m) => m.model === "y/1"));
    // The generic bucket must not claim a provider name it does not have.
    expect(local?.providerLabel).not.toBe("Custom");
    expect(local?.models[0].providerLabel).toBeUndefined();
  });
});
