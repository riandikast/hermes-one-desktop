import { expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { IgnoredFiles } from "./IgnoredFiles";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("toggles displayed ignored entries together or per group without mutating Git or collapsing", async () => {
  const list = vi.fn().mockResolvedValue({ ok: true,
    rules: [{ line: 0, pattern: "*.cache" }, { line: 1, pattern: "*.log" }, { line: 2, pattern: "cache/" }],
    files: ["a.cache", "b.cache", "c.cache"], version: "v", hasMore: true });
  const remove = vi.fn(), unignore = vi.fn(), refresh = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  Object.assign(window, { hermesAPI: { gitIgnoreList: list, gitIgnoreRemove: remove, gitIgnoreUnignore: unignore } });
  const { container } = render(<IgnoredFiles dir="/repo" refresh={refresh} />);
  const details = container.querySelector("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  fireEvent.click(await screen.findByLabelText("Select ignored c.cache"));
  const rules = screen.getByRole("button", { name: "Select all ignored rules" });
  expect(rules.closest("summary")).toBeNull();
  fireEvent.click(rules);
  expect(rules).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Select ignore rule *.cache")).toBeChecked();
  expect(screen.getByLabelText("Select ignore rule *.log")).toBeChecked();
  expect(screen.getByLabelText("Select ignored a.cache")).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Select all ignored files" }));
  expect(screen.getByLabelText("Select ignored a.cache")).toBeChecked();
  expect(screen.getByRole("button", { name: "Unselect all ignored" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Unselect all ignored rules" }));
  expect(screen.getByLabelText("Select ignore rule *.cache")).not.toBeChecked();
  expect(screen.getByLabelText("Select ignored c.cache")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Select all ignored" }));
  fireEvent.click(screen.getByRole("button", { name: "Unselect all ignored" }));
  for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
  expect(details.open).toBe(true);
  expect(remove).not.toHaveBeenCalled(); expect(unignore).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
  expect(list).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "cache" } });
  await screen.findByLabelText("Select ignored a.cache");
  expect(screen.queryByLabelText("Select ignore rule *.log")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Select all ignored" }));
  expect(screen.getAllByRole("checkbox")).toHaveLength(5);
  for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).toBeChecked();
  expect(screen.getByText(/Showing up to 100 matching paths/)).toBeTruthy();
  expect(list).toHaveBeenLastCalledWith("/repo", 0, "cache", "name");
});
it("resets only the relevant ignored Shift anchor, disables empty/loading/busy toggles", async () => {
  let finish!: (value: unknown) => void;
  const result = { ok: true,
    rules: [{ line: 0, pattern: "a" }, { line: 1, pattern: "b" }, { line: 2, pattern: "c" }],
    files: ["one/", "two/", "three/"], version: "v", hasMore: false };
  const list = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const refresh = vi.fn();
  Object.assign(window, { hermesAPI: { gitIgnoreList: list } });
  const view = render(<IgnoredFiles dir="/repo" refresh={refresh} />);
  const details = view.container.querySelector("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  expect(screen.getByRole("button", { name: "Select all ignored" })).toBeDisabled();
  await screen.findByRole("status");
  expect(screen.getByRole("button", { name: "Select all ignored rules" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Select all ignored files" })).toBeDisabled();
  await act(async () => finish(result));
  fireEvent.click(screen.getByLabelText("Select ignore rule a"));
  fireEvent.click(screen.getByLabelText("Select ignored one/"));
  fireEvent.click(screen.getByRole("button", { name: "Select all ignored rules" }));
  fireEvent.click(screen.getByRole("button", { name: "Unselect all ignored rules" }));
  fireEvent.click(screen.getByLabelText("Select ignore rule c"), { shiftKey: true });
  expect(screen.getByLabelText("Select ignore rule a")).not.toBeChecked();
  expect(screen.getByLabelText("Select ignore rule b")).not.toBeChecked();
  expect(screen.getByLabelText("Select ignore rule c")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Select ignored three/"), { shiftKey: true });
  expect(screen.getByLabelText("Select ignored two/")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Unselect all ignored files" }));
  fireEvent.click(screen.getByLabelText("Select ignored three/"), { shiftKey: true });
  expect(screen.getByLabelText("Select ignored one/")).not.toBeChecked();
  expect(screen.getByLabelText("Select ignored two/")).not.toBeChecked();
  expect(screen.getByLabelText("Select ignored three/")).toBeChecked();
  view.rerender(<IgnoredFiles dir="/repo" refresh={refresh} busy />);
  expect(screen.getByRole("button", { name: "Select all ignored" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Select all ignored rules" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Select all ignored files" })).toBeDisabled();
  view.rerender(<IgnoredFiles dir="/repo" refresh={refresh} />);
  list.mockResolvedValue({ ...result, rules: [], files: [] });
  fireEvent.click(screen.getByRole("button", { name: "Refresh ignored" }));
  await screen.findByText("No root rules");
  for (const name of ["ignored", "ignored rules", "ignored files"]) {
    expect(screen.getByRole("button", { name: `Select all ${name}` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Select all ${name}` })).toHaveAttribute("aria-pressed", "false");
  }
});
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
  await waitFor(() => expect(list).toHaveBeenLastCalledWith("/repo", 0, "cache", "name"));
});

it("toggles icon-only name/date sorting and follows sorted rule ranges", async () => {
  const list = vi.fn().mockResolvedValue({ ok: true, rules: [{ line: 0, pattern: "a" }, { line: 1, pattern: "z" }], files: [], version: "v", hasMore: false });
  Object.assign(window, { hermesAPI: { gitIgnoreList: list } });
  const { container } = render(<IgnoredFiles dir="/repo" refresh={vi.fn()} />);
  const details = container.querySelector("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  await screen.findByRole("checkbox", { name: "Select ignore rule a" });
  const sort = screen.getByRole("button", { name: "Sort ignored by date" });
  expect(sort.textContent).toBe("");
  fireEvent.click(sort);
  await waitFor(() => expect(list).toHaveBeenLastCalledWith("/repo", 0, "", "date"));
  const last = await screen.findByRole("checkbox", { name: "Select ignore rule a" });
  const first = screen.getByRole("checkbox", { name: "Select ignore rule z" });
  expect(first.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(first); fireEvent.click(last, { shiftKey: true });
  expect(first).toBeChecked(); expect(last).toBeChecked();
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
