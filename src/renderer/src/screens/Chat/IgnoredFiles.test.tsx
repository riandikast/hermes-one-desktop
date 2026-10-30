import { expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { IgnoredFiles } from "./IgnoredFiles";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("selects rules, searches both groups through IPC, confirms file exceptions and reports failures", async () => {
  const list = vi.fn().mockResolvedValue({ ok: true, rules: [{ line: 0, pattern: "*.cache" }, { line: 1, pattern: "*.log" }], files: ["one.cache"], version: "version", hasMore: true });
  const unignore = vi.fn().mockResolvedValue({ ok: false, error: "Edit external rules at their source" });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  Object.assign(window, { hermesAPI: { gitIgnoreList: list, gitIgnoreUnignore: unignore } });
  const { container } = render(<IgnoredFiles dir="/repo" refresh={vi.fn()} />);
  const details = container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  const rule = await screen.findByRole("checkbox", { name: "Select ignore rule *.cache" });
  fireEvent.click(rule);
  expect(rule).toBeChecked();
  expect(screen.queryByRole("button", { name: /Previous|Next/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Stop ignoring one.cache" }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("No disk files will be deleted"));
  expect(unignore).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Stop ignoring one.cache" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Edit external rules at their source");
  expect(unignore).toHaveBeenCalledWith("/repo", "one.cache", "version");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "cache" } });
  await waitFor(() => expect(list).toHaveBeenLastCalledWith("/repo", 0, "cache"));
});

it("supports shift-click range selection on rules and places loading below search tools", async () => {
  let resolveList: (val: unknown) => void = () => {};
  const list = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveList = resolve; }));
  Object.assign(window, { hermesAPI: { gitIgnoreList: list, gitIgnoreUnignore: vi.fn() } });
  const { container } = render(<IgnoredFiles dir="/repo" refresh={vi.fn()} />);
  const details = container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  const tools = container.querySelector(".source-control-ignore-tools")!;
  const loading = await screen.findByRole("status");
  expect(tools.compareDocumentPosition(loading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  resolveList({
    ok: true,
    rules: [
      { line: 0, pattern: "*.a" },
      { line: 1, pattern: "*.b" },
      { line: 2, pattern: "*.c" },
    ],
    files: [],
    version: "v1",
    hasMore: false,
  });

  const ruleA = await screen.findByRole("checkbox", { name: "Select ignore rule *.a" });
  const ruleC = await screen.findByRole("checkbox", { name: "Select ignore rule *.c" });
  fireEvent.click(ruleA);
  expect(ruleA).toBeChecked();

  fireEvent.click(ruleC, { shiftKey: true });
  expect(ruleA).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Select ignore rule *.b" })).toBeChecked();
  expect(ruleC).toBeChecked();
});
