import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { AnimatedFileCode, ToolFilePreview } from "./ToolFilePreview";
import type { ChatMessage } from "./types";

const readFile = vi.fn();
const writeFile = vi.fn();
const messages: ChatMessage[] = [
  { id: "u", role: "user", content: "edit file" },
  {
    id: "t",
    kind: "tool_call",
    role: "agent",
    callId: "t",
    name: "patch",
    status: "running",
    args: JSON.stringify({
      path: "C:/repo/a.ts",
      old_string: "old",
      new_string: "new",
    }),
  },
];
const props = {
  messages,
  enabled: true,
  running: true,
  active: true,
  local: true,
};
const codeText = (container: HTMLElement): string =>
  container.querySelector(".cm-content")?.textContent ?? "";

beforeEach(() => {
  // jsdom has no text layout; CodeMirror still measures selections/scroll effects.
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
  readFile.mockReset().mockResolvedValue({ content: "old", truncated: false });
  writeFile.mockReset();
  Object.assign(window, {
    hermesAPI: { ...window.hermesAPI, readFile, writeFile },
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows a real read-only editor then hides it on completion, opt-out or background tab without writes", async () => {
  const view = render(<ToolFilePreview {...props} />);
  await waitFor(() => expect(codeText(view.container)).toBe("new"));
  expect(
    screen.getByRole("complementary", { name: "Live file preview" }),
  ).toBeTruthy();
  expect(
    view.container
      .querySelector(".cm-content")
      ?.getAttribute("contenteditable"),
  ).toBe("false");
  expect(
    view.container.querySelector(".cm-content")?.getAttribute("aria-readonly"),
  ).toBe("true");
  expect(readFile).toHaveBeenCalledWith("C:/repo/a.ts", 64 * 1024);
  for (const state of [
    { running: false },
    { enabled: false },
    { active: false },
  ]) {
    view.rerender(<ToolFilePreview {...props} {...state} />);
    expect(view.container.querySelector(".tool-file-preview")).toBeNull();
  }
  expect(writeFile).not.toHaveBeenCalled();
});

it("animates deletion then insertion using bounded transactions; reduced motion settles immediately", () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const view = render(
    <AnimatedFileCode
      path="a.unknown"
      before="hello old tail"
      after="hello new tail"
    />,
  );
  expect(codeText(view.container)).toBe("hello old tail");
  act(() => {
    vi.advanceTimersByTime(120);
  });
  expect(codeText(view.container)).not.toBe("hello old tail");
  expect(codeText(view.container)).not.toBe("hello new tail");
  act(() => {
    vi.advanceTimersByTime(600);
  });
  expect(codeText(view.container)).toBe("hello new tail");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  view.rerender(
    <AnimatedFileCode path="a.unknown" before="hello new tail" after="final" />,
  );
  expect(codeText(view.container)).toBe("final");
});

it("destroys the editor and cancels in-flight reads on unmount", async () => {
  let resolve!: (value: { content: string; truncated: boolean }) => void;
  readFile.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const destroy = vi.spyOn(EditorView.prototype, "destroy");
  const view = render(<ToolFilePreview {...props} />);
  view.unmount();
  await act(async () => {
    resolve({ content: "late", truncated: false });
  });
  expect(destroy).toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
  destroy.mockRestore();
});

it("never reads local disk for a remote tool and labels the payload fallback", () => {
  render(<ToolFilePreview {...props} local={false} />);
  expect(readFile).not.toHaveBeenCalled();
  expect(screen.getByText("Remote file — tool payload only")).toBeTruthy();
});

it("refreshes observed content on completion, discards a stale response for the previous file", async () => {
  let stale!: (value: { content: string; truncated: boolean }) => void;
  readFile.mockImplementation((path) =>
    path.endsWith("a.ts")
      ? new Promise((done) => {
          stale = done;
        })
      : Promise.resolve({ content: "second file", truncated: false }),
  );
  const view = render(<ToolFilePreview {...props} />);
  const second: ChatMessage = {
    id: "t2",
    kind: "tool_call",
    role: "agent",
    callId: "t2",
    name: "read_file",
    status: "completed",
    args: JSON.stringify({ path: "C:/repo/b.ts" }),
  };
  view.rerender(
    <ToolFilePreview {...props} messages={[...messages, second]} />,
  );
  await waitFor(() => expect(codeText(view.container)).toBe("second file"));
  await act(async () => {
    stale({ content: "stale first file", truncated: false });
  });
  expect(codeText(view.container)).toBe("second file");
});

it("reports unavailable and capped files without misrepresenting their payload as full content", async () => {
  readFile.mockRejectedValue(new Error("missing"));
  const view = render(<ToolFilePreview {...props} />);
  await screen.findByText("File unavailable — showing tool payload only");
  expect(screen.getByRole("status").textContent).toContain("patch excerpt");
  view.unmount();
  readFile.mockResolvedValue({ content: "long file", truncated: true });
  render(<ToolFilePreview {...props} />);
  await screen.findByText("Preview limited to 64 KB");
});
