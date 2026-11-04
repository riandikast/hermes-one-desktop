// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync("src/renderer/src/assets/main.css", "utf8");
const chat = readFileSync("src/renderer/src/screens/Chat/Chat.tsx", "utf8");
const rule = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("}", start) + 1);
};

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
  const pane = rule(".tool-file-preview");
  expect(pane).toContain("margin: 112px 62px 12px 0");
  expect(pane).not.toMatch(/position:\s*(?:fixed|absolute)|z-index/);
  expect(css).toContain(
    ".chat-body:has(.tool-file-preview) { flex-direction: column; }",
  );
  expect(css).toContain("margin: 0 62px 12px 24px");
});
