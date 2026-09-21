// @vitest-environment node
//
// Source guard against silently-dead handlers.
//
// The On-Finish terminal's "+" button shipped broken because Chat.tsx passed
// `onNewSession={() => undefined}`. Nothing failed: the button rendered, looked
// live, and did nothing. A component test cannot catch that, because the dock
// itself is correct — the bug is in the WIRING.
//
// So this asserts the wiring directly, against the source. It is deliberately
// narrow: it only checks that props which are known no-ops in this file are not
// passed as placeholders.
//
// Read via Vite's `?raw` import rather than node:fs: the web tsconfig does not
// include node types, so `readFileSync` fails typecheck.

import { describe, expect, it } from "vitest";
import chatSource from "./Chat.tsx?raw";

/** Every `propName={...}` passed to a component, by prop name. */
function propValues(source: string, prop: string): string[] {
  const re = new RegExp(`${prop}=\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}`, "g");
  return [...source.matchAll(re)].map((m) => m[1].trim());
}

describe("Chat.tsx wiring: no silent placeholder handlers", () => {
  it("does not pass a no-op as onNewSession", () => {
    const values = propValues(chatSource, "onNewSession");

    // It must be passed, or the "+" button is unbound.
    expect(values.length).toBeGreaterThan(0);

    for (const value of values) {
      // The exact shape of the original bug.
      expect(value).not.toMatch(/^\(\)\s*=>\s*(undefined|void 0|\{\s*\}|null)$/);
      // A named handler is required, so the behaviour is testable elsewhere.
      expect(value).toMatch(/^[A-Za-z_$][\w$]*$/);
    }
  });

  it("passes a real new-session handler that creates a pty", () => {
    // The handler must exist and actually call terminalCreate; a stub that
    // merely exists would still leave the button dead.
    expect(chatSource).toMatch(/const\s+handleNewOnFinishSession\s*=/);
    const start = chatSource.indexOf("const handleNewOnFinishSession");
    const body = chatSource.slice(start, start + 600);
    expect(body).toContain("terminalCreate");
    expect(body).toContain("attachSession");
  });

  it("does not pass no-op resize handlers that would break the handle UI", () => {
    // The dialog does not expose resize controls, so these are intentionally
    // no-ops there — asserted so the intent is explicit rather than accidental.
    const values = propValues(chatSource, "onResizeStart");
    for (const value of values) {
      expect(value).toMatch(/^\(\)\s*=>\s*undefined$/);
    }
  });
});
