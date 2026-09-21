// @vitest-environment jsdom
//
// The worktree and web-preview panels are DIALOGS now, opened from the floating
// rail, rather than inline panes that take horizontal space from the transcript.
//
// Covered here are the parts that are easy to regress:
//   - the file-explorer icon exists ONLY when a folder is attached (requested),
//   - the panels render embedded (filling the dialog, no resize handle),
//   - the dialogs keep their contents mounted across close/reopen.
//
// Chat.tsx cannot be rendered without a large provider tree, so this asserts
// against its source — the same source-guard approach used elsewhere here.

import { describe, expect, it } from "vitest";
// `?raw` works for .tsx (it does NOT for .css — see railOverlap.test.ts).
import chatSource from "./Chat.tsx?raw";

/** The JSX block for a floating rail button, found by its aria-label. */
function railButton(label: string): string {
  const idx = chatSource.indexOf(`aria-label="${label}"`);
  if (idx < 0) return "";
  // Walk back to the enclosing `{` condition and forward to the closing `)}`.
  const start = chatSource.lastIndexOf("{", idx);
  const end = chatSource.indexOf("</button>", idx);
  return chatSource.slice(Math.max(0, start - 400), end + 9);
}

describe("file explorer icon visibility", () => {
  it("is rendered only when a context folder is attached", () => {
    const block = railButton("File explorer");
    expect(block).not.toBe("");
    // Requested behaviour: no folder means no icon.
    expect(block).toContain("contextFolders.length > 0");
  });

  it("is NOT gated on the panel being open", () => {
    // The icon must remain clickable to close the panel it opened.
    const block = railButton("File explorer");
    expect(block).not.toMatch(/\bworktreeVisible\s*&&/);
  });

  it("is not rendered inside the input toolbar any more", () => {
    // It moved from the composer toolbar to the floating rail.
    const toolbarRegion = chatSource.slice(
      chatSource.indexOf("onCompactContext"),
      chatSource.indexOf("onCompactContext") + 2500,
    );
    expect(toolbarRegion).not.toContain('aria-label="File explorer"');
  });
});

describe("web preview icon", () => {
  it("is rendered in the floating rail with a dialog toggle", () => {
    const block = railButton("Web preview");
    expect(block).toContain("setWebPreviewVisible");
    expect(block).toContain('aria-expanded={webPreviewVisible}');
  });

  it("is only shown once a URL has been previewed", () => {
    // There is nothing to display without an initial URL.
    const block = railButton("Web preview");
    expect(block).toContain("webPreviewUrl");
  });

  it("no longer lives in the composer toolbar", () => {
    const toolbarRegion = chatSource.slice(
      chatSource.indexOf("onCompactContext"),
      chatSource.indexOf("onCompactContext") + 2500,
    );
    expect(toolbarRegion).not.toContain("Show web preview");
  });
});

describe("panels are dialogs, not inline panes", () => {
  it("mounts each panel inside a FloatingDialog", () => {
    expect(chatSource).toMatch(
      /<FloatingDialog[\s\S]{0,400}<WebPreviewPanel[\s\S]{0,300}embedded/,
    );
    expect(chatSource).toMatch(
      /<FloatingDialog[\s\S]{0,400}<WorktreePanel[\s\S]{0,300}embedded/,
    );
  });

  it("passes the embedded flag so the panels fill the dialog", () => {
    // Without it the panel keeps its own width AND its resize handle, which
    // fights the dialog's sizing.
    expect(chatSource).toContain("<WorktreePanel folderPaths={contextFolders} embedded />");
    expect(chatSource).toMatch(/onInspectElement=\{handleInspectElement\}\s*\n?\s*embedded/);
  });

  it("does not render the panels as siblings of the transcript", () => {
    // That is what made them steal horizontal space from the messages column.
    const body = chatSource.slice(
      chatSource.indexOf("<div className=\"chat-body\">"),
      chatSource.indexOf("</div>", chatSource.indexOf("<div className=\"chat-body\">")),
    );
    expect(body).not.toContain("<WorktreePanel");
  });

  it("keeps both dialogs mounted lazily but persistently", () => {
    // Opened at least once, then kept so the webview pages and tree state
    // survive a close.
    expect(chatSource).toContain("webPreviewEverOpened");
    expect(chatSource).toContain("worktreeEverOpened");
    expect(chatSource).toMatch(/webPreviewEverOpened \?/);
    expect(chatSource).toMatch(/worktreeEverOpened \?/);
  });

  it("uses keepMounted so closed dialogs hide rather than unmount", () => {
    // Anchor on the DIALOG's title, not the rail icon's tooltip: the icon uses
    // the same string and appears earlier in the file.
    const at = chatSource.lastIndexOf('title="Web preview"');
    expect(at).toBeGreaterThan(-1);
    // Props AFTER the title in this JSX, so slice forward past it.
    const block = chatSource.slice(at, at + 160);
    expect(block).toContain("keepMounted");
    expect(block).toContain('size="full"');
  });

  it("sizes the two dialogs for their content", () => {
    // The terminal preset is wide and short (read in lines); a web page and a
    // file tree both need vertical room. lastIndexOf picks the dialog, since
    // each rail icon repeats the same title as a tooltip.
    const around = (title: string): string => {
      // Props follow the title in this JSX, so the window looks FORWARD.
      const at = chatSource.lastIndexOf(`title="${title}"`);
      return at < 0 ? "" : chatSource.slice(at, at + 160);
    };
    expect(around("Web preview")).toContain('size="full"');
    expect(around("File explorer")).toContain('size="wide"');
  });

  it("keeps the terminal on its own preset", () => {
    // Guard against a blanket size change flattening all three dialogs.
    const at = chatSource.lastIndexOf('title="Terminal"');
    expect(at).toBeGreaterThan(-1);
    const block = chatSource.slice(at, at + 160);
    expect(block).not.toContain('size="full"');
    expect(block).not.toContain('size="wide"');
  });
});
