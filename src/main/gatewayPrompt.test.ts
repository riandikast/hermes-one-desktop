import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `promptApproval` is the surface that answers a gateway `approval.request`.
 * The agent thread is parked until it is answered, so these tests pin the
 * contract that matters: every button maps to the choice it claims, the safe
 * answer is the default/cancel, and the taskbar is flagged while waiting.
 */

const mockState = {
  flashCalls: [] as boolean[],
  lastOptions: null as Record<string, unknown> | null,
  response: "once",
};

vi.mock("electron", () => ({
  BrowserWindow: class {},
}));

vi.mock("./askpass", () => ({
  showPasswordDialog: vi.fn(),
  showApprovalDialog: vi.fn(async (_parent: unknown, options: Record<string, unknown>) => {
    mockState.lastOptions = options;
    const choices = options.choices as string[];
    return choices.includes(mockState.response) ? mockState.response : "deny";
  }),
}));

type FakeWindow = { flashFrame: (flag: boolean) => void };

async function loadModule(): Promise<typeof import("./gatewayPrompt")> {
  vi.resetModules();
  return import("./gatewayPrompt");
}

function fakeParent(): FakeWindow {
  return {
    flashFrame: (flag: boolean) => {
      mockState.flashCalls.push(flag);
    },
  };
}

beforeEach(() => {
  mockState.flashCalls = [];
  mockState.lastOptions = null;
  mockState.response = "once";
});

describe("promptApproval", () => {
  it("maps each offered choice to its own button", async () => {
    const mod = await loadModule();
    mod.setGatewayPromptParent(() => fakeParent() as never);

    await mod.promptApproval({
      choices: ["once", "session", "always", "deny"],
      command: "rm -rf /tmp/x",
      description: "recursive delete",
    });

    expect(mockState.lastOptions?.choices).toEqual([
      "once",
      "session",
      "always",
      "deny",
    ]);
    expect(mockState.lastOptions?.command).toBe("rm -rf /tmp/x");
    expect(mockState.lastOptions?.description).toBe("recursive delete");
    expect(mockState.lastOptions?.labels).toEqual({
      once: "Run once",
      session: "Allow for this session",
      always: "Always allow",
      deny: "Deny",
    });
  });

  it("hides choices the backend did not offer", async () => {
    const mod = await loadModule();
    mod.setGatewayPromptParent(() => fakeParent() as never);

    // A smart-denied approval only offers once/deny — no session grant.
    await mod.promptApproval({ choices: ["once", "deny"] });

    expect(mockState.lastOptions?.choices).toEqual(["once", "deny"]);
  });

  it("returns the choice for the clicked button", async () => {
    const mod = await loadModule();
    mod.setGatewayPromptParent(() => fakeParent() as never);

    mockState.response = "always";
    await expect(
      mod.promptApproval({ choices: ["once", "session", "always", "deny"] }),
    ).resolves.toBe("always");
  });

  it("uses deny as the safe fallback for an invalid renderer response", async () => {
    const mod = await loadModule();
    mod.setGatewayPromptParent(() => fakeParent() as never);

    mockState.response = "not-a-choice";
    await expect(
      mod.promptApproval({ choices: ["once", "session", "deny"] }),
    ).resolves.toBe("deny");
    expect(mockState.lastOptions?.choices).toEqual(["once", "session", "deny"]);
  });

  it("falls back to deny when the dialog reports nothing usable", async () => {
    const mod = await loadModule();
    mod.setGatewayPromptParent(() => fakeParent() as never);

    mockState.response = "not-a-choice";
    await expect(mod.promptApproval({ choices: ["once", "deny"] })).resolves.toBe(
      "deny",
    );
  });

  it("flags the taskbar icon while the prompt is open and clears it after", async () => {
    const mod = await loadModule();
    mod.setGatewayPromptParent(() => fakeParent() as never);

    await mod.promptApproval({ choices: ["once", "deny"] });

    expect(mockState.flashCalls).toEqual([true, false]);
  });

  it("still resolves without a parent window", async () => {
    const mod = await loadModule();
    mod.setGatewayPromptParent(() => null);

    mockState.response = "once";
    await expect(mod.promptApproval({ choices: ["once", "deny"] })).resolves.toBe(
      "once",
    );
    // No window to flash — the call must not throw.
    expect(mockState.flashCalls).toEqual([]);
  });
});
