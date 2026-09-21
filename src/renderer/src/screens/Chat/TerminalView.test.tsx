// @vitest-environment jsdom
//
// Terminal-style tool rendering. Two regressions this guards:
//  1. the command block must not wrap itself in the bordered code-block
//     container ("a box in a box");
//  2. the result body must not carry the code-block background, which reads as
//     selected text in lighter themes.

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", setLocale: vi.fn() }),
}));

import { TerminalCommand, TerminalOutput } from "./TerminalView";

describe("TerminalCommand", () => {
  it("renders a shell prompt and the command without code-block chrome", () => {
    const { container } = render(<TerminalCommand command="rg -n needle src" />);
    const text = container.textContent ?? "";

    expect(text).toContain("$");
    expect(text).toContain("rg -n needle src");
    // No nested code-block container (that was the "box in a box").
    expect(container.querySelector(".chat-code-block")).toBeNull();
    expect(container.querySelector(".chat-code-header")).toBeNull();
    // Still marked as a command line for styling.
    expect(container.querySelector(".chat-terminal-command")).not.toBeNull();
  });
});

describe("TerminalOutput", () => {
  const toneOf = (container: HTMLElement, text: string): string | null => {
    // Each span carries its own trailing newline, so compare trimmed text.
    const span = [...container.querySelectorAll("span")].find(
      (el) => (el.textContent ?? "").replace(/\n$/, "") === text,
    );
    return span?.className || null;
  };

  it("colours lines by terminal semantics, not code syntax", () => {
    const { container } = render(
      <TerminalOutput
        body={[
          "error TS2322: bad type",
          "warning: unused variable",
          "+const added = 1;",
          "-const removed = 1;",
          "✓ built in 2.4s",
          "13 passed | 2 failed",
          "$ npm test",
          "plain info line",
        ].join("\n")}
      />,
    );

    expect(toneOf(container, "error TS2322: bad type")).toContain(
      "chat-terminal-line--error",
    );
    expect(toneOf(container, "warning: unused variable")).toContain(
      "chat-terminal-line--warn",
    );
    expect(toneOf(container, "+const added = 1;")).toContain(
      "chat-terminal-line--add",
    );
    expect(toneOf(container, "-const removed = 1;")).toContain(
      "chat-terminal-line--remove",
    );
    expect(toneOf(container, "✓ built in 2.4s")).toContain(
      "chat-terminal-line--ok",
    );
    expect(toneOf(container, "13 passed | 2 failed")).toContain(
      "chat-terminal-line--summary",
    );
    expect(toneOf(container, "$ npm test")).toContain(
      "chat-terminal-line--prompt",
    );
    // Ordinary text stays uncoloured rather than being misread as syntax.
    expect(toneOf(container, "plain info line")).toBeNull();
  });

  it("does not treat diff headers as added/removed lines", () => {
    const { container } = render(
      <TerminalOutput body={"+++ b/file.ts\n--- a/file.ts"} />,
    );
    expect(toneOf(container, "+++ b/file.ts")).toBeNull();
    expect(toneOf(container, "--- a/file.ts")).toBeNull();
  });

  it("renders the output without the code-block container", () => {
    const { container } = render(<TerminalOutput body="just output" />);
    expect(container.querySelector(".chat-code-block")).toBeNull();
    expect(container.querySelector(".chat-terminal-output")).not.toBeNull();
  });

  it("preserves every line including trailing blank ones", () => {
    const { container } = render(<TerminalOutput body={"a\n\nb\n"} />);
    expect(container.textContent).toBe("a\n\nb");
  });
});
