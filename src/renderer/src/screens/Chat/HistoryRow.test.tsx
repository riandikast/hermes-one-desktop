// @vitest-environment jsdom
//
// End-to-end check that a tool result is rendered from its ENVELOPE payload,
// not dumped as raw JSON. The bug this guards: `{"output": "a\nb"}` used to
// render as pretty-printed JSON with the payload still escaped as one string.

import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// HistoryRow renders payloads through CodeBlock, which pulls translations via
// useI18n (requires the i18next provider). Stub it so the block renders in
// isolation; the keys are irrelevant to how a result body is displayed.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

import { ToolActivityGroup } from "./HistoryRow";
import type { ToolCallMessage, ToolResultMessage } from "./types";

function group(content: string): React.JSX.Element {
  const call: ToolCallMessage = {
    id: "tc-1",
    kind: "tool_call",
    role: "agent",
    callId: "c1",
    name: "terminal",
    args: JSON.stringify({ command: "rg needle src" }),
    status: "completed",
  };
  const result: ToolResultMessage = {
    id: "tr-1",
    kind: "tool_result",
    role: "agent",
    callId: "c1",
    name: "terminal",
    content,
  };
  return <ToolActivityGroup items={[call, result]} />;
}

describe("tool result rendering", () => {
  it("shows the unescaped output and exit code, not the JSON envelope", () => {
    const { container } = render(
      group(
        JSON.stringify({
          output: "src/a.ts:12: needle here\nsrc/b.ts:4: needle too",
          exit_code: 0,
          error: null,
        }),
      ),
    );

    const text = container.textContent ?? "";
    // The payload lines are real lines of the rendered output.
    expect(text).toContain("src/a.ts:12: needle here");
    // The envelope must be gone: no JSON key quoting, no escaped newlines.
    expect(text).not.toContain('"output"');
    expect(text).not.toContain("\\n");
    // Metadata is surfaced as its own chip.
    expect(text).toContain("exit 0");
  });

  it("labels a failed result as Error and keeps the message readable", () => {
    const { container } = render(
      group(
        JSON.stringify({
          output: "",
          exit_code: 127,
          error: "command not found: rg",
        }),
      ),
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Error");
    expect(text).toContain("command not found: rg");
    expect(text).toContain("exit 127");
    expect(text).not.toContain('"error"');
  });

  it("keeps plain-text output unchanged", () => {
    const { container } = render(group("just some output\nsecond line"));
    const text = container.textContent ?? "";
    expect(text).toContain("just some output");
    expect(text).toContain("second line");
  });
});

describe("auto-expand tool calls", () => {
  // BOTH levels matter: the group summary is the PARENT and the item header is
  // the child. Asserting only the child is what let a half-working
  // implementation ship — the setting appeared to do nothing because the
  // visible parent stayed collapsed.
  const groupExpanded = (container: HTMLElement): boolean =>
    container
      .querySelector(".chat-tool-group-summary")
      ?.getAttribute("aria-expanded") === "true";

  const itemExpanded = (container: HTMLElement): boolean =>
    container
      .querySelector(".chat-tool-item-header")
      ?.getAttribute("aria-expanded") === "true";

  it("keeps the group and item collapsed by default", () => {
    localStorage.removeItem("hermes.autoExpandToolCalls");
    const { container } = render(group("output"));
    expect(groupExpanded(container)).toBe(false);
    expect(itemExpanded(container)).toBe(false);
  });

  it("expands the PARENT group on mount when the preference is on", () => {
    // The reported bug: only the inner item expanded, so the tool calls were
    // still hidden behind a collapsed parent that needed a manual click.
    localStorage.setItem("hermes.autoExpandToolCalls", "true");
    const { container } = render(group("output"));
    expect(groupExpanded(container)).toBe(true);
    expect(itemExpanded(container)).toBe(true);
    localStorage.removeItem("hermes.autoExpandToolCalls");
  });

  it("expands an ALREADY-MOUNTED group when the setting is switched on", () => {
    localStorage.removeItem("hermes.autoExpandToolCalls");
    const { container } = render(group("output"));
    expect(groupExpanded(container)).toBe(false);

    // The Appearance pane writes the key then broadcasts this exact event.
    localStorage.setItem("hermes.autoExpandToolCalls", "true");
    act(() => {
      window.dispatchEvent(new Event("hermes-auto-expand-tool-calls-changed"));
    });

    expect(groupExpanded(container)).toBe(true);
    expect(itemExpanded(container)).toBe(true);
    localStorage.removeItem("hermes.autoExpandToolCalls");
  });

  it("does not expand when only the REASONING preference is on", () => {
    // Guards against the two settings sharing a key or an event name.
    localStorage.setItem("hermes.autoExpandReasoning", "true");
    localStorage.removeItem("hermes.autoExpandToolCalls");
    const { container } = render(group("output"));
    expect(groupExpanded(container)).toBe(false);
    expect(itemExpanded(container)).toBe(false);
    localStorage.removeItem("hermes.autoExpandReasoning");
  });

  it("still collapses the group on click after auto-expanding", () => {
    localStorage.setItem("hermes.autoExpandToolCalls", "true");
    const { container } = render(group("output"));
    const summary = container.querySelector<HTMLElement>(
      ".chat-tool-group-summary",
    )!;
    expect(groupExpanded(container)).toBe(true);
    fireEvent.click(summary);
    expect(groupExpanded(container)).toBe(false);
    localStorage.removeItem("hermes.autoExpandToolCalls");
  });

  it("still collapses the inner item on click after auto-expanding", () => {
    localStorage.setItem("hermes.autoExpandToolCalls", "true");
    const { container } = render(group("output"));
    const header = container.querySelector<HTMLElement>(
      ".chat-tool-item-header",
    )!;
    expect(itemExpanded(container)).toBe(true);
    fireEvent.click(header);
    expect(itemExpanded(container)).toBe(false);
    localStorage.removeItem("hermes.autoExpandToolCalls");
  });
});
