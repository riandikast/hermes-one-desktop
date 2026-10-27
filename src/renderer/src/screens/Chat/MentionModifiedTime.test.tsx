import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MentionModifiedTime } from "./MentionModifiedTime";
import { ChatInput, type ChatInputHandle } from "./ChatInput";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const modifiedAt = new Date(2026, 0, 12, 21, 0).getTime();

// @lat: [[mentions#Modification timestamps]]
it("shows local modification time beside file/folder names in picker and tags without changing submitted paths", async () => {
  const getPathModifiedTime = vi.fn().mockResolvedValue(modifiedAt);
  vi.stubGlobal("hermesAPI", {
    getPathModifiedTime,
    listFilesRecursive: vi.fn().mockResolvedValue([
      { name: "file.ts", path: "/project/file.ts", isDirectory: false },
      { name: "folder", path: "/project/folder", isDirectory: true },
    ]),
  });
  const ref = createRef<ChatInputHandle>();
  const onSubmit = vi.fn();
  render(
    <ChatInput
      ref={ref}
      isLoading={false}
      hasSession
      contextFolders={["/project"]}
      onSubmit={onSubmit}
      onQuickAsk={vi.fn()}
      onAbort={vi.fn()}
    />,
  );
  const textarea = screen.getByPlaceholderText("chat.typeMessage");
  fireEvent.change(textarea, { target: { value: "@" } });
  await waitFor(() =>
    expect(document.querySelectorAll(".mention-menu-item time")).toHaveLength(
      2,
    ),
  );
  fireEvent.mouseDown(screen.getByTitle("/project/file.ts"));
  act(() =>
    ref.current!.insertMentionTag({
      name: "folder",
      path: "/project/folder",
      isDirectory: true,
    }),
  );
  await waitFor(() =>
    expect(document.querySelectorAll(".chat-mention-tag time")).toHaveLength(2),
  );
  for (const time of document.querySelectorAll("time")) {
    expect(time.textContent).toBe("21:00, 12 Jan 2026");
    expect(time.getAttribute("datetime")).toBe(
      new Date(modifiedAt).toISOString(),
    );
  }
  fireEvent.keyDown(textarea, { key: "Enter" });
  fireEvent.keyDown(textarea, { key: "Enter" });
  expect(onSubmit).toHaveBeenCalledOnce();
  const prompt = onSubmit.mock.calls[0][0];
  expect(prompt).toContain("/project/file.ts");
  expect(prompt).toContain("/project/folder");
  expect(prompt).not.toContain("2026");
});

it.each([null, NaN, Infinity, 1e20])(
  "omits unavailable or invalid metadata (%s)",
  async (value) => {
    const getPathModifiedTime = vi.fn().mockResolvedValue(value);
    vi.stubGlobal("hermesAPI", { getPathModifiedTime });
    const { container } = render(<MentionModifiedTime path="/missing" />);
    await act(async () => {});
    expect(getPathModifiedTime).toHaveBeenCalledWith("/missing");
    expect(container.querySelector("time")).toBeNull();
  },
);

it("ignores a stale result and handles request failure", async () => {
  let resolve!: (value: number) => void;
  const getPathModifiedTime = vi
    .fn()
    .mockReturnValueOnce(
      new Promise<number>((done) => {
        resolve = done;
      }),
    )
    .mockRejectedValueOnce(new Error("unreadable"));
  vi.stubGlobal("hermesAPI", { getPathModifiedTime });
  const { rerender, container } = render(<MentionModifiedTime path="/old" />);
  rerender(<MentionModifiedTime path="/new" />);
  await act(async () => {
    resolve(modifiedAt);
  });
  expect(container.querySelector("time")).toBeNull();
});
