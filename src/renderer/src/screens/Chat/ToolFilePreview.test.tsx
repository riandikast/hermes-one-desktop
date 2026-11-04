import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

it("four agents share one editor, inactive tabs do not read or animate", async () => {
  const agents = [1, 2, 3, 4].map((n) => ({
    id: `agent${n}`,
    label: `Agent ${n}`,
    messages: [
      {
        id: `t${n}`,
        kind: "tool_call" as const,
        role: "agent" as const,
        callId: `t${n}`,
        name: "write_file",
        status: "running" as const,
        args: JSON.stringify({
          path: `C:/repo/file${n}.ts`,
          content: `agent ${n}`,
        }),
      },
    ],
  }));
  const view = render(<ToolFilePreview {...props} agents={agents} />);
  await waitFor(() =>
    expect(view.container.querySelectorAll(".cm-editor")).toHaveLength(1),
  );
  expect(screen.getAllByRole("tab")).toHaveLength(5);
  expect(
    readFile.mock.calls.every((call) => call[0] === "C:/repo/file4.ts"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("tab", { name: /Agent 2/ }));
  await waitFor(() =>
    expect(readFile).toHaveBeenCalledWith("C:/repo/file2.ts", 64 * 1024),
  );
  expect(view.container.querySelectorAll(".cm-editor")).toHaveLength(1);
  expect(
    screen.getByRole("tab", { name: /Agent 2/ }).getAttribute("aria-selected"),
  ).toBe("true");
  const updated = agents.map((agent) => ({ ...agent, status: "working" }));
  view.rerender(<ToolFilePreview {...props} agents={updated} />);
  expect(
    screen.getByRole("tab", { name: /Agent 2/ }).getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.keyDown(screen.getByRole("tab", { name: /Agent 2/ }), {
    key: "ArrowRight",
  });
  expect(
    screen.getByRole("tab", { name: /Agent 3/ }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(view.container.querySelectorAll(".cm-editor")).toHaveLength(1);
  expect(writeFile).not.toHaveBeenCalled();
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

it.each([
  { reading: true, reduced: true },
  { reading: true, reduced: false },
  { reading: false, reduced: true },
  { reading: false, reduced: false },
])("keeps CRLF replay selections inside the document ($reading, $reduced)", ({ reading, reduced }) => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: reduced,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const before = "first\r\nold\r\nlast\r\n";
  const after = "first\r\nnew\r\nlast\r\n";
  const rendered = render(
    <AnimatedFileCode path="a.unknown" before={before} after={after} reading={reading} />,
  );
  act(() => { vi.advanceTimersByTime(6000); });
  const editor = EditorView.findFromDOM(rendered.container.querySelector(".cm-editor")!)!;
  expect(editor.state.doc.toString()).toBe("first\nnew\nlast\n");
  expect(editor.state.selection.main.to).toBeLessThanOrEqual(editor.state.doc.length);
  rendered.rerender(
    <AnimatedFileCode path="a.unknown" before={before} after={"short\r\n"} reading={reading} />,
  );
  act(() => { vi.advanceTimersByTime(6000); });
  expect(editor.state.doc.toString()).toBe("short\n");
  expect(editor.state.selection.main.to).toBeLessThanOrEqual(editor.state.doc.length);
});

it("syntax-highlights the animated preview by file extension", async () => {
  const view = render(
    <AnimatedFileCode
      path="C:/repo/a.ts"
      before=""
      after={'const answer: number = 42;\nconst label = "ok";'}
    />,
  );
  await waitFor(() => expect(codeText(view.container)).toContain("ok"));
  await waitFor(() => {
    const classes = new Set(
      [...view.container.querySelectorAll(".cm-line span")].map(
        (node) => node.className,
      ),
    );
    expect(classes.size).toBeGreaterThanOrEqual(3);
  });
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
    vi.advanceTimersByTime(2000);
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

it("keeps typing through late baseline updates instead of spawning the final text", () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const target = "new content typed progressively";
  const view = render(
    <AnimatedFileCode path="a.txt" before="" after={target} />,
  );
  act(() => {
    vi.advanceTimersByTime(100);
  });
  const partial = codeText(view.container);
  expect(partial.length).toBeGreaterThan(0);
  expect(partial.length).toBeLessThan(target.length);
  view.rerender(
    <AnimatedFileCode path="a.txt" before={target} after={target} />,
  );
  expect(codeText(view.container)).toBe(partial);
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(codeText(view.container)).toBe(target);
});

it("replays a fast completed patch even when the disk snapshot already contains its result", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  readFile.mockResolvedValue({ content: "new", truncated: false });
  const completed = messages.map((row) =>
    row.kind === "tool_call" ? { ...row, status: "completed" as const } : row,
  );
  const view = render(<ToolFilePreview {...props} messages={completed} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(codeText(view.container)).toBe("old");
  act(() => {
    vi.advanceTimersByTime(180);
  });
  expect(codeText(view.container)).not.toBe("new");
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(codeText(view.container)).toBe("new");
});

it("reads by progressively selecting text without changing the document or taking focus", () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const text = "one two three four five six seven";
  const view = render(
    <AnimatedFileCode path="a.txt" before="" after={text} reading />,
  );
  const editor = EditorView.findFromDOM(
    view.container.querySelector(".cm-editor")!,
  )!;
  expect(codeText(view.container)).toBe(text);
  act(() => {
    vi.advanceTimersByTime(240);
  });
  expect(editor.state.selection.main.from).toBe(0);
  expect(editor.state.selection.main.to).toBeGreaterThan(0);
  expect(editor.state.selection.main.to).toBeLessThan(text.length);
  expect(editor.hasFocus).toBe(false);
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(editor.state.selection.main.to).toBe(text.length);
  expect(codeText(view.container)).toBe(text);
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
