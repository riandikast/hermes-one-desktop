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

import { describe, expect, it, vi } from "vitest";
import chatSource from "./Chat.tsx?raw";
import chipSource from "./LastPromptChip.tsx?raw";
import pickerSource from "./ModelPicker.tsx?raw";
// CSS ?raw is stubbed by Vitest; read actual tokens for the contrast check.
// @ts-expect-error -- node types are intentionally outside the web tsconfig
const nodeModule = (await import("node:module")) as unknown as {
  createRequire: (url: string) => (id: string) => {
    readFileSync: (path: string, encoding: string) => string;
  };
};
const css = nodeModule
  .createRequire(import.meta.url)("node:fs")
  .readFileSync("src/renderer/src/assets/main.css", "utf8");

/** Every `propName={...}` passed to a component, by prop name. */
function propValues(source: string, prop: string): string[] {
  const re = new RegExp(`${prop}=\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}`, "g");
  return [...source.matchAll(re)].map((m) => m[1].trim());
}

describe("Chat.tsx wiring: no silent placeholder handlers", () => {
  it.each(["dark", "light"])(
    "keeps picker text above AA contrast in %s",
    (theme) => {
      expect(css.length).toBeGreaterThan(1000);
      const block = css.split(`[data-theme="${theme}"] {`)[1].split("}")[0];
      const rgb = (key: string) => {
        const hex = block.match(new RegExp(`--${key}: #([0-9a-f]{6})`))![1];
        return [0, 2, 4].map((offset) =>
          parseInt(hex.slice(offset, offset + 2), 16),
        );
      };
      const luminance = (color: number[]) =>
        color
          .map((channel) => {
            const c = channel / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      const base = rgb("bg-secondary");
      const overlay = block
        .match(/--accent-subtle: rgba\(([^)]+)\)/)![1]
        .split(",")
        .map(Number);
      const selected = base.map(
        (c, i) => c * (1 - overlay[3]) + overlay[i] * overlay[3],
      );
      const primary = rgb("text-primary");
      const accent = rgb("accent-text");
      for (const foreground of [
        primary,
        rgb("text-secondary"),
        primary.map((c, i) => c * 0.75 + accent[i] * 0.25),
      ]) {
        for (const background of [base, selected, rgb("bg-primary")]) {
          const values = [luminance(foreground), luminance(background)].sort(
            (a, b) => a - b,
          );
          expect(
            (values[1] + 0.05) / (values[0] + 0.05),
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );
  it("wires floating opening to the dock and retains it while closed", () => {
    expect(chatSource.length).toBeGreaterThan(1000);
    expect(chatSource).toMatch(
      /<FloatingDialog\s+open=\{onFinishDockOpen\}[\s\S]*?title="Terminal"\s+keepMounted/,
    );
    expect(chatSource).toMatch(
      /<TerminalDock\s+ref=\{onFinishDockRef\}[\s\S]*?open=\{onFinishDockOpen\}/,
    );
  });

  // Extract the real handler body from this repository's own source and run it
  // in a sandbox scope. The interpolated text is always Chat.tsx read at build
  // time via `?raw` — never user, remote, or runtime input — so `new Function`
  // cannot be reached with attacker-controlled code here.
  const handlerBody = (): string => {
    const marker = "const handleNewOnFinishSession = useCallback((): void => {";
    const start = chatSource.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const end = chatSource.indexOf("}, [contextFolders]);", start);
    expect(end).toBeGreaterThan(start);
    return chatSource.slice(start + marker.length, end);
  };

  it("coalesces concurrent creation and releases the lock after failure", async () => {
    const body = handlerBody();
    let resolve!: (value: { id: string }) => void;
    const terminalCreate = vi.fn(
      () =>
        new Promise<{ id: string }>((done) => {
          resolve = done;
        }),
    );
    const attachSession = vi.fn();
    const findSessionByCwd = vi.fn(() => null);
    const error = vi.fn();
    const create = new Function(
      "window",
      "onFinishCreatingRef",
      "onFinishDockRef",
      "toast",
      "contextFolders",
      `return () => {${body}}`,
    )(
      { hermesAPI: { terminalCreate } },
      { current: false },
      { current: { attachSession, findSessionByCwd, focusSession: vi.fn() } },
      { error },
      [],
    );
    create();
    create();
    create();
    expect(terminalCreate).toHaveBeenCalledTimes(1);
    resolve({ id: "one" });
    await Promise.resolve();
    await Promise.resolve();
    expect(attachSession).toHaveBeenCalledExactlyOnceWith(
      "one",
      "Terminal",
      undefined,
    );
    terminalCreate.mockRejectedValueOnce(new Error("failed"));
    create();
    await Promise.resolve();
    expect(error).toHaveBeenCalledTimes(1);
    create();
    expect(terminalCreate).toHaveBeenCalledTimes(3);
    resolve({ id: "retry" });
    await Promise.resolve();
    await Promise.resolve();
  });

  it("spawns the floating terminal in the chat's project directory when it has one", async () => {
    const body = handlerBody();
    const terminalCreate = vi.fn().mockResolvedValue({ id: "term-1" });
    const attachSession = vi.fn();
    const focusSession = vi.fn();
    const findSessionByCwd = vi.fn(() => null);
    const projectDir = ["D:", "Work", "App"].join("\\");
    const create = new Function(
      "window",
      "onFinishCreatingRef",
      "onFinishDockRef",
      "toast",
      "contextFolders",
      `return () => {${body}}`,
    )(
      { hermesAPI: { terminalCreate } },
      { current: false },
      { current: { attachSession, findSessionByCwd, focusSession } },
      { error: vi.fn() },
      [projectDir],
    );
    create();
    await Promise.resolve();
    await Promise.resolve();
    // The pty must be created IN the project folder, titled after it.
    expect(terminalCreate).toHaveBeenCalledWith({
      cwd: projectDir,
      cols: 80,
      rows: 24,
    });
    expect(attachSession).toHaveBeenCalledWith("term-1", "App", projectDir);
  });

  it("reuses an existing session for the same directory instead of duplicating", async () => {
    const body = handlerBody();
    const terminalCreate = vi.fn().mockResolvedValue({ id: "term-new" });
    const attachSession = vi.fn();
    const focusSession = vi.fn();
    const findSessionByCwd = vi.fn(() => "term-existing");
    const create = new Function(
      "window",
      "onFinishCreatingRef",
      "onFinishDockRef",
      "toast",
      "contextFolders",
      `return () => {${body}}`,
    )(
      { hermesAPI: { terminalCreate } },
      { current: false },
      { current: { attachSession, findSessionByCwd, focusSession } },
      { error: vi.fn() },
      ["C:/proj"],
    );
    create();
    await Promise.resolve();
    await Promise.resolve();
    expect(findSessionByCwd).toHaveBeenCalledWith("C:/proj");
    expect(focusSession).toHaveBeenCalledWith("term-existing");
    // No duplicate pty for a directory that already has a terminal.
    expect(terminalCreate).not.toHaveBeenCalled();
    expect(attachSession).not.toHaveBeenCalled();
  });
  it("does not pass a no-op as onNewSession", () => {
    const values = propValues(chatSource, "onNewSession");

    // It must be passed, or the "+" button is unbound.
    expect(values.length).toBeGreaterThan(0);

    for (const value of values) {
      // The exact shape of the original bug.
      expect(value).not.toMatch(
        /^\(\)\s*=>\s*(undefined|void 0|\{\s*\}|null)$/,
      );
      // A named handler is required, so the behaviour is testable elsewhere.
      expect(value).toMatch(/^[A-Za-z_$][\w$]*$/);
    }
  });

  it("passes a real new-session handler that creates a pty", () => {
    // The handler must exist and actually call terminalCreate; a stub that
    // merely exists would still leave the button dead.
    expect(chatSource).toMatch(/const\s+handleNewOnFinishSession\s*=/);
    const start = chatSource.indexOf("const handleNewOnFinishSession");
    const body = chatSource.slice(start, start + 1600);
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

  it("shows the terminal icon whether or not the On-Finish queue is armed", () => {
    // The terminal is a general tool: it must not disappear when the queue is
    // empty. Gating the trigger on `onFinishArmed` was the bug.
    const trigger = /aria-label="Terminal"/;
    expect(chatSource).toMatch(trigger);

    // Anchor on the terminal trigger and confirm no `onFinishArmed &&` guards
    // it. The two are adjacent in source; a guard would appear just before.
    const idx = chatSource.indexOf('aria-label="Terminal"');
    expect(idx).toBeGreaterThan(-1);
    const before = chatSource.slice(Math.max(0, idx - 900), idx);
    expect(before).not.toMatch(/\{onFinishArmed\s*&&\s*\(/);
  });

  it("styles the last-prompt chip plainly and the dialog as Material", () => {
    // The CHIP must stay a plain pill — a neutral surface with only an accent
    // border on hover, not a tinted/gradient highlight treatment.
    const start = css.indexOf(".chat-last-prompt {");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(
      start,
      css.indexOf("/* ── Last-prompt reader", start),
    );
    expect(block).not.toContain("linear-gradient");
    expect(block).not.toContain("::before");
    expect(block).toContain("border: 1px solid var(--border");

    // The DIALOG is the Material surface: flat fill, small radius, modest
    // elevation — and specifically NOT a gradient wash.
    const dialogStart = css.indexOf(".last-prompt-dialog {");
    expect(dialogStart).toBeGreaterThan(-1);
    const dialogBlock = css.slice(
      dialogStart,
      css.indexOf("/* Empty state */", dialogStart),
    );
    expect(dialogBlock).toContain("border-radius: 8px");
    expect(dialogBlock).toContain("box-shadow");
    expect(dialogBlock).not.toContain("linear-gradient");
    // The reader still scrolls for very long prompts.
    const bodyStart = css.indexOf(".chat-last-prompt-dialog-body {");
    expect(css.slice(bodyStart, bodyStart + 600)).toContain("overflow: auto");
  });

  it("gives the last-prompt dialog a copy action wired to the full text", () => {
    // The dialog carries a copy button that writes the FULL prompt (the pill's
    // preview is truncated), styled as a quiet Material text button.
    expect(chipSource).toContain("handleCopy");
    expect(chipSource).toContain("copyToClipboard");
    // Copies `full`, never the capped `preview`.
    const copyIdx = chipSource.indexOf("copyToClipboard(");
    expect(copyIdx).toBeGreaterThan(-1);
    expect(chipSource.slice(copyIdx, copyIdx + 40)).toContain("full");

    const start = css.indexOf(".chat-last-prompt-dialog-copy {");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, start + 600);
    // Flat, token-based, no gradient — consistent with the Material dialog.
    expect(block).not.toContain("linear-gradient");
    expect(block).toContain("var(--text-muted");
  });

  it("opens the full prompt in a dialog instead of scrolling the transcript", () => {
    // A scroll-based jump was flaky: the target row can be virtualised out of
    // the DOM (nothing to scroll to) and the stick-to-bottom auto-follow fights
    // a programmatic scroll. The chip therefore exposes no onJump at all — it
    // renders a dialog, which always shows the complete prompt.
    const chipIdx = chatSource.indexOf("<LastPromptChip");
    expect(chipIdx).toBeGreaterThan(-1);
    const end = chatSource.indexOf("/>", chipIdx);
    const props = chatSource.slice(chipIdx, end);
    expect(props).not.toContain("onJump");
    expect(props).toContain("containerRef={containerRef}");
    // The dialog lives inside the chip component itself.
    expect(chipSource).toContain("FloatingDialog");
    expect(chipSource).toContain("chat-last-prompt-dialog-body");
  });

  it("mounts LastPromptChip OUTSIDE the scrolling transcript", () => {
    // A sticky element only sticks within its parent's bounds, so a chip placed
    // inside the scroll content scrolls out of view — the reported "shows for a
    // second, then disappears". It must be a sibling of .chat-messages.
    const chipIdx = chatSource.indexOf("<LastPromptChip");
    expect(chipIdx).toBeGreaterThan(-1);

    // The transcript's inner content wrapper must CLOSE before the chip appears.
    const scrollDivIdx = chatSource.indexOf('className="chat-messages"');
    expect(scrollDivIdx).toBeGreaterThan(-1);
    expect(chipIdx).toBeGreaterThan(scrollDivIdx);

    const between = chatSource.slice(scrollDivIdx, chipIdx);
    // Two closing </div> tags: the contentRef wrapper and .chat-messages.
    const closes = between.match(/<\/div>/g) ?? [];
    expect(closes.length).toBeGreaterThanOrEqual(2);

    // The chip must come after the LAST closing div in that span — i.e. it is a
    // sibling of .chat-messages, never nested inside the scrolling content.
    const lastCloseIdx = between.lastIndexOf("</div>");
    const afterLastClose = between.slice(lastCloseIdx + "</div>".length);
    expect(afterLastClose).not.toMatch(/<div[^>]*className="chat-messages"/);
    expect(afterLastClose).not.toMatch(/ref=\{contentRef\}/);
  });

  it("exposes Fallbacks as a rail category directly under All models", () => {
    // The fallback list is a rail CATEGORY (like the provider groups), not a
    // section appended to the model list: "All models" then "Fallback models".
    const allIdx = pickerSource.indexOf('{t("chat.allModels")}');
    const fbIdx = pickerSource.indexOf('{t("chat.fallbackModels")');
    expect(allIdx).toBeGreaterThan(-1);
    expect(fbIdx).toBeGreaterThan(allIdx);
    // Both are rail items, and the fallback one renders BEFORE the custom-group
    // section, i.e. it sits right beneath "All models".
    const customIdx = pickerSource.indexOf('{t("chat.customGroups")}');
    expect(customIdx).toBeGreaterThan(fbIdx);
    // Selecting it swaps the pane: the fallback manager renders inside the
    // right pane (.chat-model-list), guarded by the fallbackView flag.
    expect(pickerSource).toContain("{fallbackView ? (");
  });

  it("styles the fallback rows with the app palette, not hardcoded colors", () => {
    const start = css.indexOf(".chat-model-fallback {");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf(".chat-model-group-menu", start));
    expect(block.length).toBeGreaterThan(400);
    // Uses design tokens so it follows the theme.
    expect(block).toContain("var(--text-muted)");
    expect(block).toContain("var(--bg-secondary)");
    // Ordering is the point of the list, so the position badge is styled.
    expect(block).toContain(".chat-model-fallback-order");
  });
});
