// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildRecoveryPrompt,
  detectWedgedSubagent,
  initialRecoveryState,
  initialSubagentWatch,
  MAX_TOTAL_ATTEMPTS,
  nextRecoveryAction,
  RECOVERY_PROMPT_MAX,
  recoveryNoticeMessage,
  SUBAGENT_MIN_RUN_MS,
  SUBAGENT_NO_PROGRESS_MS,
  TRIES_PER_MODEL,
  type RecoveryState,
} from "./recoveryEngine";
import type { FallbackModel } from "./fallbackModels";

// Top-level await is fine at MODULE scope (chatWiring.test.ts does the same):
// the web tsconfig excludes node types, so importing node:module directly would
// fail typecheck.
// @ts-expect-error -- node types are intentionally outside the web tsconfig
const nodeModule = (await import("node:module")) as unknown as {
  createRequire: (url: string) => (id: string) => {
    readFileSync: (path: string, encoding: string) => string;
  };
};
const fs = nodeModule.createRequire(import.meta.url)("node:fs");
const readSource = (path: string): string => fs.readFileSync(path, "utf8");

/**
 * The recovery rules. These are the guard rails that stop auto-recovery from
 * becoming a runaway loop or, worse, the app typing on your behalf after you
 * pressed stop — so they are tested directly rather than through the UI.
 */

const m = (model: string): FallbackModel => ({
  key: `p::::${model}`,
  provider: "p",
  model,
  baseUrl: "",
  label: model,
});

const chain = [m("a"), m("b"), m("c")];

const state = (over: Partial<RecoveryState> = {}): RecoveryState => ({
  ...initialRecoveryState(),
  ...over,
});

describe("nextRecoveryAction — tries per model", () => {
  it("retries the same model first", () => {
    const action = nextRecoveryAction({ state: state(), chain });
    expect(action).toEqual({ kind: "retry-same-model", attempt: 1 });
  });

  it(`uses ${TRIES_PER_MODEL} tries per model before switching`, () => {
    expect(TRIES_PER_MODEL).toBe(2);
    // attempt 1 on the primary: retry same model.
    expect(nextRecoveryAction({ state: state({ attempts: 0 }), chain }).kind).toBe(
      "retry-same-model",
    );
    // 2 tries used on the primary -> switch to the first fallback.
    const switched = nextRecoveryAction({ state: state({ attempts: 2 }), chain });
    expect(switched.kind).toBe("switch-model");
    expect(switched.kind === "switch-model" && switched.model.model).toBe("a");
  });

  it("walks the chain one model at a time, 2 tries each", () => {
    // attempts 2..3 -> model a, 4..5 -> model b.
    const second = nextRecoveryAction({ state: state({ attempts: 3, chainIndex: 1 }), chain });
    expect(second.kind).toBe("retry-same-model");
    const third = nextRecoveryAction({ state: state({ attempts: 4, chainIndex: 1 }), chain });
    expect(third.kind === "switch-model" && third.model.model).toBe("b");
  });
});

describe("nextRecoveryAction — terminal cases", () => {
  it("stops at the total attempt cap", () => {
    const action = nextRecoveryAction({
      state: state({ attempts: MAX_TOTAL_ATTEMPTS }),
      chain,
    });
    expect(action).toEqual({ kind: "give-up", reason: "exhausted" });
  });

  it("never exceeds the cap even with a long chain", () => {
    const longChain = [m("a"), m("b"), m("c"), m("d"), m("e")];
    let s = initialRecoveryState();
    let sends = 0;
    for (let i = 0; i < 50; i++) {
      const action = nextRecoveryAction({ state: s, chain: longChain });
      if (action.kind === "give-up") break;
      sends++;
      s = {
        ...s,
        attempts: action.attempt,
        chainIndex:
          action.kind === "switch-model" ? s.chainIndex + 1 : s.chainIndex,
      };
    }
    expect(sends).toBeLessThanOrEqual(MAX_TOTAL_ATTEMPTS);
    expect(nextRecoveryAction({ state: s, chain: longChain }).kind).toBe("give-up");
  });

  it("gives up when the chain is empty", () => {
    const action = nextRecoveryAction({ state: state({ attempts: 2 }), chain: [] });
    expect(action).toEqual({ kind: "give-up", reason: "no-fallbacks" });
  });

  it("gives up when the chain is exhausted mid-walk", () => {
    const action = nextRecoveryAction({
      state: state({ attempts: 4, chainIndex: 2 }),
      chain: [m("a")],
    });
    expect(action).toEqual({ kind: "give-up", reason: "no-fallbacks" });
  });
});

describe("nextRecoveryAction — manual interrupt is absolute", () => {
  it("never recovers once the user cancelled", () => {
    const action = nextRecoveryAction({ state: state({ userCancelled: true }), chain });
    expect(action).toEqual({ kind: "give-up", reason: "cancelled" });
  });

  it("cancel beats even a fresh, capable state", () => {
    // Nothing else about the state should matter — cancel is checked first.
    const action = nextRecoveryAction({
      state: state({ userCancelled: true, attempts: 0, chainIndex: 0 }),
      chain,
    });
    expect(action.kind).toBe("give-up");
    expect(action.kind === "give-up" && action.reason).toBe("cancelled");
  });

  it("recovers normally once cancelled is false (control case)", () => {
    // Guards against the cancel check being so broad it blocks everything.
    const action = nextRecoveryAction({ state: state({ userCancelled: false }), chain });
    expect(action.kind).toBe("retry-same-model");
  });
});

describe("nextRecoveryAction — a wedge skips the remaining retries", () => {
  it("switches model immediately instead of retrying a stuck model", () => {
    // 0 attempts used, but the model is wedged: retrying it would just buy
    // another full timeout, so go straight to the first fallback.
    const action = nextRecoveryAction({ state: state(), chain, fromWedge: true });
    expect(action.kind).toBe("switch-model");
    expect(action.kind === "switch-model" && action.model.model).toBe("a");
  });

  it("still honours cancel on a wedge", () => {
    const action = nextRecoveryAction({
      state: state({ userCancelled: true }),
      chain,
      fromWedge: true,
    });
    expect(action.kind).toBe("give-up");
  });
});

describe("buildRecoveryPrompt", () => {
  it("carries both the instruction and the original prompt", () => {
    const text = buildRecoveryPrompt("add a login page");
    expect(text).toContain("Continue.");
    expect(text).toContain("add a login page");
    expect(text).toContain("Original prompt");
  });

  it("trims surrounding whitespace", () => {
    expect(buildRecoveryPrompt("  spaced  ")).toBe(
      "Continue. Original prompt: spaced",
    );
  });

  it("falls back to a bare Continue for an empty prompt", () => {
    expect(buildRecoveryPrompt("")).toBe("Continue.");
    expect(buildRecoveryPrompt("   ")).toBe("Continue.");
  });

  it("caps a very long prompt so replays do not balloon", () => {
    const long = "x".repeat(5000);
    const text = buildRecoveryPrompt(long);
    expect(text.length).toBeLessThan(RECOVERY_PROMPT_MAX + 200);
    expect(text).toContain("truncated");
  });
});

describe("recoveryNoticeMessage", () => {
  it("names the fallback model on a switch", () => {
    const text = recoveryNoticeMessage({ kind: "switched", model: "owl-beta" });
    expect(text).toContain("owl-beta");
    expect(text).toContain("fallback");
  });

  it("shows the attempt count on a retry", () => {
    const text = recoveryNoticeMessage({ kind: "retried", attempt: 2 });
    expect(text).toContain("2");
    expect(text).toMatch(/attempt/i);
  });

  it("never returns an empty string (the notice must always say something)", () => {
    expect(recoveryNoticeMessage({ kind: "switched" }).length).toBeGreaterThan(0);
    expect(recoveryNoticeMessage({ kind: "retried" }).length).toBeGreaterThan(0);
  });
});

describe("detectWedgedSubagent", () => {
  const child = (
    over: Partial<Parameters<typeof detectWedgedSubagent>[1][number]> = {},
  ): Parameters<typeof detectWedgedSubagent>[1][number] => ({
    id: "c1",
    startedAt: 1_000_000_000_000,
    toolCount: 0,
    lastTool: "read",
    ...over,
  });

  it("does not flag a child that just started", () => {
    const watch = initialSubagentWatch();
    const now = 1_000_000_000_000;
    expect(detectWedgedSubagent(watch, [child({ startedAt: now - 1000 })], now)).toBe(
      false,
    );
  });

  it("does not flag a child that is still making progress", () => {
    const watch = initialSubagentWatch();
    const start = 1_000_000_000_000;
    let now = start;
    // Run past the minimum, but keep bumping the tool counter.
    for (let i = 0; i < 20; i++) {
      now += SUBAGENT_NO_PROGRESS_MS;
      detectWedgedSubagent(
        watch,
        [child({ startedAt: start, toolCount: i, lastTool: `tool${i}` })],
        now,
      );
    }
    // A fresh change at `now` -> not wedged.
    expect(
      detectWedgedSubagent(
        watch,
        [child({ startedAt: start, toolCount: 999, lastTool: "tool999" })],
        now,
      ),
    ).toBe(false);
  });

  it("flags a long-running child with no progress change", () => {
    const watch = initialSubagentWatch();
    const start = 1_000_000_000_000;
    // First sample establishes the baseline and the change time.
    detectWedgedSubagent(watch, [child({ startedAt: start })], start);
    // Long enough running AND quiet -> wedged.
    const now = start + Math.max(SUBAGENT_MIN_RUN_MS, SUBAGENT_NO_PROGRESS_MS) + 1000;
    expect(detectWedgedSubagent(watch, [child({ startedAt: start })], now)).toBe(true);
  });

  it("clears a finished child so its stale quiet-time cannot fire later", () => {
    const watch = initialSubagentWatch();
    const start = 1_000_000_000_000;
    detectWedgedSubagent(watch, [child({ startedAt: start })], start);
    // Child disappears from the roster...
    detectWedgedSubagent(watch, [], start + 10);
    expect(watch.tracked.size).toBe(0);
    // ...and a NEW child inherits no stale timer.
    const now = start + SUBAGENT_MIN_RUN_MS + SUBAGENT_NO_PROGRESS_MS + 1;
    expect(
      detectWedgedSubagent(watch, [child({ startedAt: now })], now),
    ).toBe(false);
  });

  it("flags a wedge when ANY child is stuck", () => {
    const watch = initialSubagentWatch();
    const start = 1_000_000_000_000;
    detectWedgedSubagent(
      watch,
      [child({ id: "ok", startedAt: start }), child({ id: "stuck", startedAt: start })],
      start,
    );
    const now = start + Math.max(SUBAGENT_MIN_RUN_MS, SUBAGENT_NO_PROGRESS_MS) + 1000;
    // "ok" progresses, "stuck" does not.
    expect(
      detectWedgedSubagent(
        watch,
        [
          child({ id: "ok", startedAt: start, toolCount: 5, lastTool: "build" }),
          child({ id: "stuck", startedAt: start }),
        ],
        now,
      ),
    ).toBe(true);
  });

  it("treats a startedAt of 0 as a real timestamp", () => {
    // Epoch 0 is falsy — a `child.startedAt ?` check would silently read it as
    // "no start time" and never flag the wedge.
    const watch = initialSubagentWatch();
    detectWedgedSubagent(watch, [child({ startedAt: 0 })], 0);
    const now = Math.max(SUBAGENT_MIN_RUN_MS, SUBAGENT_NO_PROGRESS_MS) + 1000;
    expect(detectWedgedSubagent(watch, [child({ startedAt: 0 })], now)).toBe(true);
  });

  it("advances the progress clock only when the signal actually changes", () => {
    const watch = initialSubagentWatch();
    const start = 1_000_000_000_000;
    detectWedgedSubagent(watch, [child({ startedAt: start, toolCount: 1 })], start);
    // Same toolCount later: lastChangedAt must stay at `start`.
    detectWedgedSubagent(watch, [child({ startedAt: start, toolCount: 1 })], start + 1000);
    expect(watch.tracked.get("c1")?.lastChangedAt).toBe(start);
    // A real change moves it.
    detectWedgedSubagent(watch, [child({ startedAt: start, toolCount: 2 })], start + 2000);
    expect(watch.tracked.get("c1")?.lastChangedAt).toBe(start + 2000);
  });
});

describe("transport wiring (source guard)", () => {
  // The interrupt guarantee cannot be reached by a unit test (it needs the live
  // gateway), so it is asserted against the SOURCE. If someone reorders abort()
  // and drops the latch, this fails loudly instead of shipping a build where
  // pressing stop can trigger an automatic resend.
  const source = readSource(
    "src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts",
  );

  it("latches recovery OFF inside abort(), before any other work", () => {
    const abortIdx = source.indexOf("const abort = useCallback(");
    expect(abortIdx).toBeGreaterThan(-1);
    const body = source.slice(abortIdx, abortIdx + 900);
    // The latch is set, and it is set EARLY — before the streaming client is
    // closed (the next statement in abort).
    expect(body).toContain("recoveryCancelledRef.current = true");
    const latchIdx = body.indexOf("recoveryCancelledRef.current = true");
    const closeIdx = body.indexOf("streaming.close()");
    expect(closeIdx).toBeGreaterThan(-1);
    expect(latchIdx).toBeLessThan(closeIdx);
  });

  it("re-checks the cancel latch at the moment of acting, not only on trigger", () => {
    // The user can press stop during the async gap between deciding and sending.
    const runIdx = source.indexOf("const runRecovery = useCallback(");
    const body = source.slice(runIdx, runIdx + 3000);
    const checks = body.match(/recoveryCancelledRef\.current/g) ?? [];
    // One at the top, one right before sendMessage.
    expect(checks.length).toBeGreaterThanOrEqual(2);
    const sendIdx = body.indexOf("await sendMessage(buildRecoveryPrompt(original))");
    expect(sendIdx).toBeGreaterThan(-1);
    // A re-check exists between the model switch and the send.
    const beforeSend = body.slice(0, sendIdx);
    expect(beforeSend.lastIndexOf("recoveryCancelledRef.current")).toBeGreaterThan(
      beforeSend.indexOf("onRecoveryNotice"),
    );
  });

  it("fires recovery from both the failure path and the stall watchdog", () => {
    expect(source).toContain("runRecoveryRef.current(false)");
    // The stall watchdog triggers through the ref (ordering-safe). Anchor on the
    // stall message text, which is unique to that block.
    const stallIdx = source.indexOf("No response from the model for 2 minutes");
    expect(stallIdx).toBeGreaterThan(-1);
    const after = source.slice(stallIdx, stallIdx + 900);
    expect(after).toContain("runRecoveryRef.current(false)");
  });

  it("drives recovery through a ref so ordering cannot break it", () => {
    // sendMessage is declared AFTER the stall watchdog; a direct reference
    // would be a TDZ error at runtime.
    expect(source).toContain("const runRecoveryRef = useRef<(fromWedge: boolean) => void>");
    expect(source).toContain("runRecoveryRef.current = (fromWedge: boolean)");
    const sendIdx = source.indexOf("const sendMessage = useCallback(");
    const stallIdx = source.indexOf("const resetStallTimer = useCallback(");
    expect(sendIdx).toBeGreaterThan(stallIdx);
  });

  it("resets the cancel latch on a NEW user turn only", () => {
    // Otherwise one stop would disable recovery for the rest of the session.
    expect(source).toContain("recoveryCancelledRef.current = false");
    const resetIdx = source.indexOf("recoveryCancelledRef.current = false");
    const sendIdx = source.indexOf("const sendMessage = useCallback(");
    // The reset lives inside sendMessage (a fresh user turn).
    expect(resetIdx).toBeGreaterThan(sendIdx);
  });

  it("passes a switch callback and a notice callback from Chat", () => {
    const chat = readSource("src/renderer/src/screens/Chat/Chat.tsx");
    expect(chat).toContain("onSwitchModel:");
    expect(chat).toContain("persist: false");
    expect(chat).toContain("onRecoveryNotice:");
    expect(chat).toContain("recoveryNoticeMessage");
  });
});
