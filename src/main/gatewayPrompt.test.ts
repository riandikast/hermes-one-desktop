import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `promptApproval` is the surface that answers a gateway `approval.request`.
 * The agent thread is parked until it is answered, so these tests pin the
 * contract that matters: every button maps to the choice it claims, the safe
 * answer is the default/cancel, and the taskbar is flagged while waiting.
 */

const mockState = {
  flashCalls: [] as boolean[],
  lastArgs: null as unknown[] | null,
  lastOptions: null as Record<string, unknown> | null,
  response: 0,
};

vi.mock("electron", () => ({
  BrowserWindow: class {},
  ipcMain: { on: () => undefined, removeListener: () => undefined },
  dialog: {
    showMessageBox: (...args: unknown[]) => {
      mockState.lastArgs = args;
      mockState.lastOptions = (args.length > 1 ? args[1] : args[0]) as Record<
        string,
        unknown
      >;
      return Promise.resolve({ response: mockState.response });
    },
  },
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
  mockState.lastArgs = null;
  mockState.lastOptions = null;
  mockState.response = 0;
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

    expect(mockState.lastOptions?.buttons).toEqual([
      "Run once",
      "Allow for this session",
      "Always allow",
      "Deny",
    ]);
    expect(mockState.lastOptions?.detail).toBe("rm -rf /tmp/x");
    expect(mockState.lastOptions?.message).toBe("recursive delete");
  });

  it("hides choices the backend did not offer", async () => {
    const mod = await loadModule();
    mod.setGatewayPromptParent(() => fakeParent() as never);

    // A smart-denied approval only offers once/deny — no session grant.
    await mod.promptApproval({ choices: ["once", "deny"] });

    expect(mockState.lastOptions?.buttons).toEqual(["Run once", "Deny"]);
  });

  it("returns the choice for the clicked button", async () => {
    const mod = await loadModule();
    mod.setGatewayPromptParent(() => fakeParent() as never);

    mockState.response = 2;
    await expect(
      mod.promptApproval({ choices: ["once", "session", "always", "deny"] }),
    ).resolves.toBe("always");
  });

  it("defaults Enter and Escape/close to deny, never to run", async () => {
    const mod = await loadModule();
    mod.setGatewayPromptParent(() => fakeParent() as never);

    await mod.promptApproval({ choices: ["once", "session", "deny"] });

    // deny is last of the three, and is both the default and the cancel id.
    expect(mockState.lastOptions?.defaultId).toBe(2);
    expect(mockState.lastOptions?.cancelId).toBe(2);
  });

  it("falls back to deny when the dialog reports nothing usable", async () => {
    const mod = await loadModule();
    mod.setGatewayPromptParent(() => fakeParent() as never);

    mockState.response = 99;
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

    mockState.response = 0;
    await expect(mod.promptApproval({ choices: ["once", "deny"] })).resolves.toBe(
      "once",
    );
    // No window to flash — the call must not throw.
    expect(mockState.flashCalls).toEqual([]);
    expect(mockState.lastArgs).toHaveLength(1);
  });
});
