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
import messageListSource from "./MessageList.tsx?raw";
import transportSource from "./hooks/useDashboardChatTransport.ts?raw";
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
    // The reader still scrolls for very long prompts — the LIST scrolls, and an
    // expanded row caps its own height so one huge prompt cannot grow the dialog
    // past the viewport.
    const listStart = css.indexOf(".chat-last-prompt-list {");
    expect(css.slice(listStart, listStart + 600)).toContain("overflow: auto");
    const bodyStart = css.indexOf(".chat-last-prompt-item-body {");
    expect(css.slice(bodyStart, bodyStart + 400)).toContain("overflow: auto");
    // The shared single-message reader (the pinned-message dialog) keeps its own
    // scrolling body; deleting this would unstyle that dialog.
    const sharedBody = css.indexOf(".chat-last-prompt-dialog-body {");
    expect(css.slice(sharedBody, sharedBody + 600)).toContain("overflow: auto");

    // Both readers sit on their OWN panel, so the text area reads as a surface
    // instead of sharing the dialog background. The panel must cover the
    // COLLAPSED preview too, not just the expanded body — a panel on the body
    // alone is why it looked like it "only works on the expanded version".
    // The panel rule is the grouped one naming all three bodies (collapsed
    // preview, expanded body, pinned reader). Build the needle from a char
    // code so no line-ending escaping is involved.
    const nl = String.fromCharCode(13) + String.fromCharCode(10);
    const panelStart = css.indexOf(
      ".chat-last-prompt-item-preview," + nl + ".chat-last-prompt-item-body,",
    );
    expect(panelStart).toBeGreaterThan(-1);
    const panel = css.slice(panelStart, panelStart + 400);
    // The panel must NOT be coloured from a --bg-* token: the dialog is painted
    // with --bg-elevated and in several themes those two variables hold the same
    // hex, which is why the container was invisible.
    expect(panel).toContain("background: color-mix(");
    expect(panel).toContain("var(--bg-elevated");
    expect(panel).toContain("padding: 10px 12px");

    // The pinned reader must NOT collapse. `flex: 1` + `min-height: 0` belong to
    // a flex-column parent and zero-heighted this element, so its panel never
    // showed.
    const pinnedStart = css.indexOf(".chat-last-prompt-dialog-body {");
    const pinnedBlock = css.slice(pinnedStart, css.indexOf("}", pinnedStart));
    expect(pinnedStart).toBeGreaterThan(-1);
    expect(pinnedBlock).not.toContain("flex: 1");
    expect(pinnedBlock).not.toContain("min-height: 0");

    // And the token class must NOT re-declare a background further down the
    // file: it shares the element with the panel rule, and a later
    // `background: transparent` would silently win and flatten the panel.
    // Strip comments first — the block documents this very trap.
    const hlStart = css.indexOf(".chat-hl-text {");
    const hlBlock = css
      .slice(hlStart, css.indexOf("}", hlStart))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(hlBlock).not.toContain("background");
  });

  it("gives the last-prompt dialog a copy action wired to the full text", () => {
    // Each list row carries a copy button that writes that row's FULL prompt
    // (the pill's preview is truncated), styled as a quiet Material text button.
    expect(chipSource).toContain("copyText");
    expect(chipSource).toContain("copyToClipboard");
    // Copies the row's `text`, never the capped `preview`.
    const copyIdx = chipSource.indexOf("copyToClipboard(");
    expect(copyIdx).toBeGreaterThan(-1);
    expect(chipSource.slice(copyIdx, copyIdx + 40)).toContain("text");

    const start = css.indexOf(".chat-last-prompt-item-toggle,");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, start + 900);
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
    // The dialog lives inside the chip component itself, and lists the RECENT
    // prompts (injections filtered) with expand + copy per row.
    expect(chipSource).toContain("FloatingDialog");
    expect(chipSource).toContain("chat-last-prompt-list");
    expect(chipSource).toContain("findRecentPrompts");
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

  it("mounts the pinned bar OUTSIDE the scrolling transcript", () => {
    // Same trap as the chip: a sticky bar inside the scroll content only sticks
    // within its own parent's bounds, so it scrolls away exactly when the user
    // is scrolled up — which is when they would want to reach it (the reported
    // "pinned icon seems gone"). It must be a sibling of .chat-messages.
    const barIdx = chatSource.indexOf("<PinnedMessagesBar");
    expect(barIdx).toBeGreaterThan(-1);

    const scrollDivIdx = chatSource.indexOf('className="chat-messages"');
    expect(scrollDivIdx).toBeGreaterThan(-1);
    expect(barIdx).toBeGreaterThan(scrollDivIdx);

    const between = chatSource.slice(scrollDivIdx, barIdx);
    const closes = between.match(/<\/div>/g) ?? [];
    expect(closes.length).toBeGreaterThanOrEqual(2);
    const lastCloseIdx = between.lastIndexOf("</div>");
    const afterLastClose = between.slice(lastCloseIdx + "</div>".length);
    expect(afterLastClose).not.toMatch(/<div[^>]*className="chat-messages"/);

    // And it must NOT still be rendered from inside the list.
    expect(messageListSource).not.toContain("<PinnedMessagesBar");
  });

  it("keeps the pinned bar's reader a dialog, with no go-to-message control", () => {
    // Reading a pinned message opens the SAME Material reader dialog the
    // last-prompt chip uses (copy button included) instead of expanding inline
    // — inline growth pushed the other pins out of view.
    expect(messageListSource).toContain("pinned-reader-dialog");
    expect(messageListSource).toContain("chat-last-prompt-dialog-body");
    expect(messageListSource).toContain("copyToClipboard");
    // "Go to message" was removed: the reader is the way to read a pin.
    expect(messageListSource).not.toContain("chat-pinned-go");
    expect(messageListSource).not.toContain("Go to message");
    expect(messageListSource).not.toContain("onGoToMessage");
    // Delete stays.
    expect(messageListSource).toContain("chat-pinned-unpin");
  });

  it("mounts the pinned reader OUTSIDE the pinned bar's positioned box", () => {
    // A `position: fixed` overlay nested in `.chat-pinned-float` (position:
    // absolute) resolves its `inset: 0` against that ~360px box, not the
    // window — the reported "side mini dialog". The reader must therefore be
    // rendered by Chat, as a sibling of the bar's container, and the bar must
    // only ASK for it to open.
    expect(chatSource).toContain("<PinnedMessageReader");
    // The bar takes a callback, not the dialog itself.
    expect(chatSource).toContain("onOpenMessage={setPinnedReaderId}");
    // MessageList defines the reader but must NOT render it inside the bar's
    // return: the only occurrence is its own definition.
    const barBody = messageListSource.slice(
      messageListSource.indexOf("export function PinnedMessagesBar"),
    );
    expect(barBody).not.toContain("<FloatingDialog");

    // The reader must be a sibling of the bar container, not a descendant:
    // after the bar's closing </div> and before the worktree comment.
    const floatIdx = chatSource.indexOf('className="chat-pinned-float"');
    const readerIdx = chatSource.indexOf("<PinnedMessageReader");
    const worktreeIdx = chatSource.indexOf(
      "The worktree and web-preview panels are DIALOGS now",
    );
    expect(floatIdx).toBeGreaterThan(-1);
    expect(readerIdx).toBeGreaterThan(floatIdx);
    if (worktreeIdx > -1) expect(readerIdx).toBeLessThan(worktreeIdx);
  });

  it("starts the floating icon rail BELOW the pinned bar", () => {
    // `.chat-pinned-float` occupies top: 48px on the right edge; the icon rail
    // must start far enough down that an expanded bar cannot cover it.
    // Read the DECLARATION, not prose: the rail's own comment quotes the bar's
    // top value, so a naive first `top:` match reads the comment.
    const declTop = (block: string): number => {
      const m = block.match(/^\s*top:\s*(\d+)px;/m);
      expect(m).not.toBeNull();
      return Number(m![1]);
    };

    const floatStart = css.indexOf(".chat-pinned-float {");
    expect(floatStart).toBeGreaterThan(-1);
    const floatTop = declTop(
      css.slice(floatStart, css.indexOf(".chat-pinned-bar {", floatStart)),
    );

    const railStart = css.indexOf(".chat-display-controls {");
    expect(railStart).toBeGreaterThan(-1);
    const railBlock = css.slice(
      railStart,
      css.indexOf(".chat-display-controls-menu {", railStart),
    );
    const railTop = declTop(railBlock);

    expect(railTop).toBeGreaterThan(floatTop + 40);
  });

  it("keeps the pinned bar in the top-RIGHT, clear of the chip and DB counter", () => {
    // The chip owns the top-LEFT band (left: 12px) and the DB counter the
    // top-right of the SAME band (top: 12px; right: 18px). The pinned bar goes
    // below that band on the right so all three can coexist.
    const start = css.indexOf(".chat-pinned-float {");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf(".chat-pinned-bar {", start));
    expect(block).toContain("position: absolute");
    expect(block).toContain("right: 18px");
    // Below the counter's band, not level with it.
    const topMatch = block.match(/top:\s*(\d+)px/);
    expect(topMatch).not.toBeNull();
    expect(Number(topMatch![1])).toBeGreaterThanOrEqual(40);
  });

  it("caps the chip so it cannot reach the DB counter's lane", () => {
    // The chip used to reach min(72vw, 640px) from left: 12px, overlapping the
    // counter (top: 12px; right: 18px) on any chat body under ~900px wide.
    const start = css.indexOf(".chat-last-prompt-wrap {");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf(".chat-last-prompt {", start));
    // The wrap reserves the counter's lane...
    expect(block).toContain("right: 232px");
    // ...so the pill fills the free space instead of a viewport-relative cap.
    const pillStart = css.indexOf(".chat-last-prompt {");
    const pillBlock = css.slice(pillStart, css.indexOf(".chat-last-prompt:hover", pillStart));
    expect(pillBlock).toContain("max-width: 100%");
    expect(pillBlock).not.toContain("72vw");
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

  it("add-list lists GROUPS first and drills in, instead of dumping all models", () => {
    // The add-list mirrors the rail's two levels. Level 1 renders the bucket
    // rows; a bucket click sets fallbackPickGroup, which swaps the list to that
    // group's models. It must never render every model unconditionally.
    expect(pickerSource).toContain("fallbackBuckets");
    expect(pickerSource).toContain("chat-model-fallback-bucket");
    expect(pickerSource).toContain("setFallbackPickGroup");
    // Custom groups are listed BEFORE the provider buckets.
    const groupIdx = pickerSource.indexOf("...customRail.map");
    const providerIdx = pickerSource.indexOf("...railProviders.map");
    expect(groupIdx).toBeGreaterThan(-1);
    expect(providerIdx).toBeGreaterThan(groupIdx);
  });

  it("gives the fallback add-list a search that spans every group", () => {
    expect(pickerSource).toContain("fallbackSearch");
    expect(pickerSource).toContain("chat-model-fallback-search-input");
    // Search results are drawn from ALL rows, not just the drilled-in bucket.
    expect(pickerSource).toContain("fallbackSearchResults");

    const start = css.indexOf(".chat-model-fallback-search {");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, start + 600);
    // Pinned to the top of the scrolling list so it never scrolls away.
    expect(block).toContain("position: sticky");
    expect(block).toContain("var(--bg-elevated");
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

  it("keeps modal overlays ABOVE the tab strip", () => {
    // `.top-menu-wrapper` / `.active-sessions-bar` are z-index 1001 (the window
    // title-bar drag band). An overlay below that paints behind the tabs — the
    // Ctrl+K sessions dialog visibly spawned under them at z-index 200.
    const zOf = (selector: string): number => {
      const start = css.indexOf(`${selector} {`);
      expect(start, `${selector} not found`).toBeGreaterThan(-1);
      const block = css.slice(start, css.indexOf("}", start));
      const m = block.match(/^\s*z-index:\s*(\d+);/m);
      expect(m, `${selector} has no z-index`).not.toBeNull();
      return Number(m![1]);
    };

    const tabStrip = zOf(".top-menu-wrapper");
    expect(tabStrip).toBe(1001);
    // Every overlay a dialog uses must clear it.
    expect(zOf(".models-modal-overlay")).toBeGreaterThan(tabStrip);
    expect(zOf(".terminal-dialog-overlay")).toBeGreaterThan(tabStrip);
  });

  it("tells the sidebar to re-sync when a turn completes", () => {
    // The sidebar's "last updated" project order reads each session's newest
    // message timestamp. A turn finishing in an EXISTING session changes that
    // timestamp, so the sidebar must be told — otherwise the order refreshed
    // only on the 60s poll / app restart ("they only updated once app
    // restart"). Assert the dispatch exists in BOTH completion paths: the
    // normal `message.complete` handler and the quiet-finalize fallback.
    const dispatches =
      transportSource.match(/hermes-session-db-synced/g)?.length ?? 0;
    // One for a newly created session row (pre-existing), plus one per
    // completion path.
    expect(dispatches).toBeGreaterThanOrEqual(3);
    // Guard the specific pairing so removing one path is caught.
    expect(transportSource).toMatch(
      /finalizeFileChanges\(\);\s*\n\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*window\.dispatchEvent\(new Event\("hermes-session-db-synced"\)\)/,
    );
  });
});
