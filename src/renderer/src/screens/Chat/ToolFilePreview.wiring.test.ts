// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import ts from "typescript";

const css = readFileSync("src/renderer/src/assets/main.css", "utf8");
const chat = readFileSync("src/renderer/src/screens/Chat/Chat.tsx", "utf8");
const rule = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("}", start) + 1);
};

it("anchors the DB badge to the transcript column, never over the sibling preview", () => {
  const source = ts.createSourceFile(
    "Chat.tsx",
    chat,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let badge: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(source) === "LocalSessionCounter"
    )
      badge = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(badge).toBeDefined();
  const column = badge!.parent;
  expect(
    ts.isJsxElement(column) && column.openingElement.getText(source),
  ).toContain('className="chat-transcript-column"');
  const body = column.parent;
  expect(
    ts.isJsxElement(body) && body.openingElement.getText(source),
  ).toContain('className="chat-body"');
  expect(rule(".chat-transcript-column")).toContain("position: relative");
  expect(rule(".chat-transcript-column")).toContain("min-width: 0");
  expect(css).not.toContain(
    ".chat-container:has(.tool-file-preview) > .chat-local-session-counter",
  );
});

it("aligns the file summary with the existing assistant avatar/gap column", () => {
  expect(rule(".chat-avatar")).toContain("width: 28px");
  expect(rule(".chat-message")).toContain("gap: 12px");
  expect(rule(".chat-file-changes-row")).toContain("margin: 2px 0 6px 40px");
  expect(rule(".chat-file-changes-row")).toContain(
    "max-width: calc(100% - 40px)",
  );
});

it("mounts the preview in chat-body flow with current-session data and separate preference", () => {
  const preview = chat.slice(
    chat.indexOf("<ToolFilePreview"),
    chat.indexOf("/>", chat.indexOf("<ToolFilePreview")),
  );
  for (const prop of [
    "messages={messages}",
    "enabled={toolCallsAnimation}",
    "running={isLoading}",
    "active={active}",
    'local={connectionMode === "local"}',
    "baseDir={contextFolders[0]}",
  ])
    expect(preview).toContain(prop);
  expect(chat.indexOf("<ToolFilePreview")).toBeGreaterThan(
    chat.indexOf('className="chat-body"'),
  );
  expect(chat.indexOf("<ToolFilePreview")).toBeLessThan(
    chat.indexOf('className="chat-input-area"'),
  );
  expect(chat).not.toContain('className="chat-workspace"');
  expect(css).not.toMatch(/\.chat-input-area[^{}]*\{[^}]*width:/);
  expect(chat.match(/<ToolFilePreview/g)).toHaveLength(1);
  const pane = rule(".tool-file-preview");
  expect(pane).toContain("margin: 0");
  expect(pane).toContain("flex: 0 0 clamp(240px, 32%, 480px)");
  expect(pane).not.toMatch(/position:\s*(?:fixed|absolute)|z-index/);
  expect(rule(".chat-body:has(> .tool-file-preview)")).toContain("gap: 12px");
  expect(css).toContain(
    ".chat-body:has(> .tool-file-preview) { flex-direction: column; }",
  );
  expect(
    rule(".chat-container:has(.tool-file-preview) > .chat-display-controls"),
  ).toContain("right: calc(clamp(240px, 32%, 480px) + 30px)");
  expect(pane).toContain("background: var(--bg-primary)");
  expect(pane).toContain("border-radius: 0");
  expect(rule(".tool-file-preview-code.file-viewer-cm-host")).toContain(
    "background: transparent",
  );
  expect(
    readFileSync("src/renderer/src/screens/Chat/ToolFilePreview.tsx", "utf8"),
  ).not.toContain("oneDark");
  expect(css).not.toContain("margin: 112px 62px 12px 0");
});
