import { beforeEach, expect, it, vi } from "vitest";
import { execFile } from "child_process";
import { checkBackendUpdate, assertOfficialBackendUpdateTarget } from "./backend-update";
import { BACKEND_SOURCE_URL } from "../shared/backend-update";
vi.mock("child_process", () => { const execFile = vi.fn(); return { execFile, default: { execFile } }; });
const installed = "a".repeat(40), latest = "b".repeat(40);
let branch: string;
let origin: string;
let detached: boolean;
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  branch = "main"; origin = `${BACKEND_SOURCE_URL}.git`; detached = false;
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(execFile).mockImplementation(((_cmd: string, args: string[], _opts: unknown, callback: Function) => {
    const value = args.includes("get-url") ? origin : args.includes("--abbrev-ref") ? (detached ? "HEAD" : branch) : installed;
    callback(null, value, "");
  }) as never);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ default_branch: "main", sha: latest, status: "behind" }) });
});
it.each([['behind', 'available'], ['ahead', 'ahead'], ['diverged', 'diverged']])("compares fresh official SHAs: %s", async (relationship, status) => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ default_branch: "trunk", sha: latest, status: relationship }) });
  expect(await checkBackendUpdate("install")).toMatchObject({ status, installed, latest, branch: "trunk" });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "https://api.github.com/repos/NousResearch/hermes-agent",
    "https://api.github.com/repos/NousResearch/hermes-agent/commits/trunk",
    `https://api.github.com/repos/NousResearch/hermes-agent/compare/${latest}...${installed}`,
  ]);
  expect(vi.mocked(execFile).mock.calls[0][1]).toEqual(["--no-optional-locks", "-C", "install", "rev-parse", "--verify", "HEAD^{commit}"]);
});
it("reports current only for matching official commit", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ default_branch: "main", sha: installed }) });
  expect(await checkBackendUpdate("install")).toMatchObject({ status: "current" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("checks detached commits but refuses automatic detached update", async () => {
  detached = true;
  expect(await checkBackendUpdate("install")).toMatchObject({ status: "available" });
  await expect(assertOfficialBackendUpdateTarget("install")).rejects.toThrow("detached");
});
it("permits only verified official default branch updates", async () => {
  await expect(assertOfficialBackendUpdateTarget("install")).resolves.toBeUndefined();
  origin = "https://github.com/riandikast/hermes-one-desktop";
  await expect(assertOfficialBackendUpdateTarget("install")).rejects.toThrow("official origin");
  origin = `${BACKEND_SOURCE_URL}.git`; branch = "custom";
  await expect(assertOfficialBackendUpdateTarget("install")).rejects.toThrow("default branch");
});
it.each([404, 403, 500])("never reports current for official HTTP %s", async (status) => {
  fetchMock.mockResolvedValue({ ok: false, status });
  expect(await checkBackendUpdate("install")).toMatchObject({ status: "unknown", detail: expect.stringContaining(`HTTP ${status}`) });
});
it("reports network failures honestly", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await checkBackendUpdate("install")).toEqual({ status: "unknown", detail: "Update check failed: offline" });
});
it("reports non-git installs without consulting stale tracking refs", async () => {
  vi.mocked(execFile).mockImplementation(((_c: unknown, _a: unknown, _o: unknown, cb: Function) => cb(new Error("not a git repository"))) as never);
  expect(await checkBackendUpdate("install")).toMatchObject({ status: "unknown" });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects malformed upstream metadata and unrecognized comparisons", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  expect(await checkBackendUpdate("install")).toMatchObject({ status: "unknown" });
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ default_branch: "main", sha: latest, status: "identical" }) });
  expect(await checkBackendUpdate("install")).toMatchObject({ status: "unknown" });
});
