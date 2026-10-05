// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  addFallbackModel,
  fallbackChainFor,
  fallbackFromRow,
  loadFallbackModels,
  moveFallbackModel,
  primaryKeyOf,
  removeFallbackModel,
  saveFallbackModels,
  type FallbackModel,
} from "./fallbackModels";

/**
 * The fallback chain is frontend-only state (localStorage) that decides which
 * model a FAILED turn is retried against, and in what order. Two things matter:
 * ordering is stable and user-controlled, and identity survives renames (so a
 * chain entry is never silently lost or duplicated).
 */

const entry = (model: string, provider = "openai"): FallbackModel =>
  fallbackFromRow({
    provider,
    model,
    baseUrl: "",
    label: `${provider}/${model}`,
  });

beforeEach(() => {
  localStorage.clear();
});

describe("fallbackFromRow / primaryKeyOf", () => {
  it("builds a stable key from provider, baseUrl and model", () => {
    const e = entry("gpt-5");
    expect(e.key).toBe("openai::::gpt-5");
    expect(e.model).toBe("gpt-5");
    expect(e.label).toBe("openai/gpt-5");
  });

  it("normalizes an absent baseUrl to an empty string", () => {
    const e = fallbackFromRow({
      provider: "custom",
      model: "m",
      baseUrl: undefined as unknown as string,
      label: "m",
    });
    expect(e.baseUrl).toBe("");
  });

  it("derives the same key for the primary model", () => {
    expect(primaryKeyOf("openai", "", "gpt-5")).toBe(entry("gpt-5").key);
  });

  it("returns null when the primary model is unknown", () => {
    expect(primaryKeyOf("", "", "")).toBeNull();
    expect(primaryKeyOf("openai", "", "")).toBeNull();
  });
});

describe("addFallbackModel", () => {
  it("appends in order", () => {
    let list = addFallbackModel([], entry("a"));
    list = addFallbackModel(list, entry("b"));
    expect(list.map((m) => m.model)).toEqual(["a", "b"]);
  });

  it("is idempotent — re-adding keeps the ORIGINAL position", () => {
    let list = addFallbackModel([], entry("a"));
    list = addFallbackModel(list, entry("b"));
    list = addFallbackModel(list, entry("a"));
    // "a" must not jump to the end or duplicate.
    expect(list.map((m) => m.model)).toEqual(["a", "b"]);
  });

  it("distinguishes the same model on a different base URL", () => {
    const local = fallbackFromRow({
      provider: "custom",
      model: "llama",
      baseUrl: "http://localhost:11434/v1",
      label: "Local llama",
    });
    const remote = fallbackFromRow({
      provider: "custom",
      model: "llama",
      baseUrl: "https://api.example.com/v1",
      label: "Remote llama",
    });
    let list = addFallbackModel([], local);
    list = addFallbackModel(list, remote);
    expect(list).toHaveLength(2);
  });
});

describe("removeFallbackModel", () => {
  it("removes by key and leaves the rest in order", () => {
    let list = addFallbackModel([], entry("a"));
    list = addFallbackModel(list, entry("b"));
    list = addFallbackModel(list, entry("c"));
    const next = removeFallbackModel(list, entry("b").key);
    expect(next.map((m) => m.model)).toEqual(["a", "c"]);
  });

  it("is a no-op for an unknown key", () => {
    const list = [entry("a")];
    expect(removeFallbackModel(list, "nope")).toHaveLength(1);
  });
});

describe("moveFallbackModel", () => {
  const list = [entry("a"), entry("b"), entry("c")];

  it("moves an entry up one slot", () => {
    const next = moveFallbackModel(list, entry("b").key, -1);
    expect(next.map((m) => m.model)).toEqual(["b", "a", "c"]);
  });

  it("moves an entry down one slot", () => {
    const next = moveFallbackModel(list, entry("b").key, 1);
    expect(next.map((m) => m.model)).toEqual(["a", "c", "b"]);
  });

  it("returns the SAME array when the move is a no-op", () => {
    // At the edges, and for an unknown key — callers use identity to skip a
    // needless save.
    expect(moveFallbackModel(list, entry("a").key, -1)).toBe(list);
    expect(moveFallbackModel(list, entry("c").key, 1)).toBe(list);
    expect(moveFallbackModel(list, "nope", 1)).toBe(list);
  });
});

describe("fallbackChainFor", () => {
  it("drops the primary model — retrying the thing that just failed is pointless", () => {
    const list = [entry("a"), entry("b"), entry("c")];
    const chain = fallbackChainFor(list, entry("b").key);
    expect(chain.map((m) => m.model)).toEqual(["a", "c"]);
  });

  it("returns the whole list when the primary is unknown", () => {
    const list = [entry("a"), entry("b")];
    expect(fallbackChainFor(list, null)).toBe(list);
  });

  it("preserves order", () => {
    const list = [entry("c"), entry("a"), entry("b")];
    expect(fallbackChainFor(list, null).map((m) => m.model)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("persistence", () => {
  it("round-trips the chain through localStorage", () => {
    const list = [entry("a"), entry("b")];
    saveFallbackModels(list);
    expect(loadFallbackModels().map((m) => m.model)).toEqual(["a", "b"]);
  });

  it("clears the key when the chain is emptied", () => {
    saveFallbackModels([entry("a")]);
    saveFallbackModels([]);
    expect(loadFallbackModels()).toEqual([]);
    expect(localStorage.getItem("hermes.chat.fallbackModels.v1")).toBeNull();
  });

  it("drops malformed entries rather than crashing", () => {
    localStorage.setItem(
      "hermes.chat.fallbackModels.v1",
      JSON.stringify({
        models: [
          { key: "k", provider: "p", model: "m", baseUrl: "" },
          { key: "bad" },
          null,
        ],
      }),
    );
    const loaded = loadFallbackModels();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.model).toBe("m");
  });

  it("returns [] for corrupt JSON", () => {
    localStorage.setItem("hermes.chat.fallbackModels.v1", "{not json");
    expect(loadFallbackModels()).toEqual([]);
  });
});
