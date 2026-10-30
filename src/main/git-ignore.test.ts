import { beforeEach, afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir, utimes } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { gitIgnoreEdit, gitIgnoreList, gitIgnoreAddMany } from "./git-ignore";
let repo: string;
const git = (...args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true });
beforeEach(async () => { repo = await mkdtemp(join(process.env.TMPDIR || tmpdir(), "ignore-test-")); git("init", "-q"); });
afterEach(async () => { await rm(repo, { recursive: true, force: true }); });
it("escapes literal paths, preserves existing CRLF and removes only selected rules", async () => {
  await writeFile(join(repo, ".gitignore"), "# existing\r\n*.cache");
  for (const path of ["!wow.txt", "#hash.txt", " spaced .txt", "[literal].txt"]) {
    await writeFile(join(repo, path), "keep");
    expect((await gitIgnoreEdit(repo, { path })).ok).toBe(true);
    expect(git("check-ignore", "--", path).replace(/\r?\n$/, "")).toBe(path);
    expect(await readFile(join(repo, path), "utf8")).toBe("keep");
  }
  const list = await gitIgnoreList(repo);
  const rule = list.rules.find((rule) => rule.pattern.includes("wow"))!;
  expect((await gitIgnoreEdit(repo, { ...rule, version: list.version })).ok).toBe(true);
  const text = await readFile(join(repo, ".gitignore"), "utf8");
  expect(text.startsWith("# existing\r\n*.cache\r\n")).toBe(true);
  expect(text).not.toContain("wow");
  expect((await gitIgnoreEdit(repo, { ...rule, version: list.version })).ok).toBe(false);
});
it("rejects traversal, injected rules and tracked files without changing files or index", async () => {
  await writeFile(join(repo, "tracked.txt"), "keep"); git("add", "tracked.txt");
  for (const path of ["../outside", "/absolute", "a/../b", "a\n*.txt", "C:/outside", "tracked.txt", ".git/config", ".gitignore"]) expect((await gitIgnoreEdit(repo, { path })).ok).toBe(false);
  expect(git("ls-files").trim()).toBe("tracked.txt");
  expect((await gitIgnoreList(repo)).rules).toEqual([]);
});
it("shows ignored directories collapsed and keeps external rules effective after root removal", async () => {
  await writeFile(join(repo, ".gitignore"), "*.cache\n");
  await writeFile(join(repo, ".git", "info", "exclude"), "*.cache\n");
  await writeFile(join(repo, "x.cache"), "keep");
  await mkdir(join(repo, "cache"));
  await writeFile(join(repo, "cache", "nested.cache"), "keep");
  await writeFile(join(repo, ".gitignore"), "*.cache\n/cache/\n");
  const list = await gitIgnoreList(repo);
  expect(list.files).toContain("cache/");
  expect(list.files).not.toContain("cache/nested.cache");
  expect(list.files).toContain("x.cache");
  expect((await gitIgnoreEdit(repo, { ...list.rules[0], version: list.version })).ok).toBe(true);
  expect((await gitIgnoreList(repo)).files).toContain("x.cache");
});
it("searches beyond the first 100 collapsed paths while bounding the response", async () => {
  await writeFile(join(repo, ".gitignore"), "*.cache\n");
  for (let i = 0; i < 110; i++) await writeFile(join(repo, `item-${String(i).padStart(3, "0")}.cache`), "keep");
  const initial = await gitIgnoreList(repo);
  expect(initial.files).toHaveLength(100);
  expect(initial.hasMore).toBe(true);
  await utimes(join(repo, "item-109.cache"), new Date("2099-01-01T00:00:00Z"), new Date("2099-01-01T00:00:00Z"));
  expect((await gitIgnoreList(repo, 0, "", "date")).files[0]).toBe("item-109.cache");
  const found = await gitIgnoreList(repo, 0, "ITEM-109");
  expect(found.files).toEqual(["item-109.cache"]);
  expect(found.hasMore).toBe(false);
});
it("unignores literal root paths without deleting files and refuses external sources or stale versions", async () => {
  await writeFile(join(repo, ".gitignore"), "*.cache\r\n");
  await writeFile(join(repo, "[one].cache"), "keep");
  const before = await gitIgnoreList(repo);
  expect((await gitIgnoreEdit(repo, { unignore: "[one].cache", version: before.version })).ok).toBe(true);
  expect((await gitIgnoreList(repo)).files).not.toContain("[one].cache");
  expect(await readFile(join(repo, "[one].cache"), "utf8")).toBe("keep");
  expect(await readFile(join(repo, ".gitignore"), "utf8")).toBe("*.cache\r\n!/\\[one\\].cache\r\n");
  expect((await gitIgnoreEdit(repo, { unignore: "[one].cache", version: before.version })).ok).toBe(false);
  await writeFile(join(repo, ".git", "info", "exclude"), "external.txt\n");
  await writeFile(join(repo, "external.txt"), "keep");
  const current = await gitIgnoreList(repo);
  const failed = await gitIgnoreEdit(repo, { unignore: "external.txt", version: current.version });
  expect(failed.ok).toBe(false);
  expect(failed.error).toContain("at their source");
  expect((await gitIgnoreList(repo)).version).toBe(current.version);
});
it("date-sorts even when .gitignore itself is ignored", async () => {
  await writeFile(join(repo, ".gitignore"), "*\n");
  expect((await gitIgnoreList(repo, 0, "", "date")).ok).toBe(true);
});
it("sorts ignored paths by name or newest modification before truncating", async () => {
  await writeFile(join(repo, ".gitignore"), "*.cache\n");
  for (const path of ["a.cache", "z.cache"]) await writeFile(join(repo, path), "keep");
  await utimes(join(repo, "a.cache"), 1000, 1000);
  await utimes(join(repo, "z.cache"), 2000, 2000);
  expect((await gitIgnoreList(repo, 0, "", "name")).files).toEqual(["a.cache", "z.cache"]);
  expect((await gitIgnoreList(repo, 0, "", "date")).files).toEqual(["z.cache", "a.cache"]);
  expect((await gitIgnoreList(repo, 0, "a.", "date")).files).toEqual(["a.cache"]);
});
it("adds a multi-selection in one write and skips duplicates", async () => {
  await writeFile(join(repo, ".gitignore"), "*.cache\n");
  const paths = ["one.txt", "two words.txt", "!bang.txt", "one.txt"];
  for (const path of paths.slice(0, 3)) await writeFile(join(repo, path), "keep");
  const result = await gitIgnoreAddMany(repo, paths);
  expect(result.ok).toBe(true);
  expect(result.added).toBe(3);
  const text = await readFile(join(repo, ".gitignore"), "utf8");
  expect(text.startsWith("*.cache\n")).toBe(true);
  expect(text.match(/one\.txt/g)).toHaveLength(1);
  for (const path of ["one.txt", "two words.txt", "!bang.txt"]) {
    expect(git("check-ignore", "--", path).replace(/\r?\n$/, "")).toBe(path);
    expect(await readFile(join(repo, path), "utf8")).toBe("keep");
  }
  // Second identical batch changes nothing and reports skips.
  const again = await gitIgnoreAddMany(repo, ["one.txt", "two words.txt"]);
  expect(again.ok).toBe(true);
  expect(again.added).toBe(0);
  expect(await readFile(join(repo, ".gitignore"), "utf8")).toBe(text);
});
it("skips tracked paths in a mixed batch and still ignores the untracked ones", async () => {
  await writeFile(join(repo, "tracked.txt"), "keep");
  await writeFile(join(repo, "loose.txt"), "keep");
  git("add", "tracked.txt");
  const result = await gitIgnoreAddMany(repo, ["loose.txt", "tracked.txt"]);
  expect(result.ok).toBe(true);
  expect(result.added).toBe(1);
  expect(result.output).toMatch(/Skipped 1 tracked path/);
  expect(git("check-ignore", "--", "loose.txt").replace(/\r?\n$/, "")).toBe("loose.txt");
  // The tracked file stays tracked and gains no rule.
  expect(git("ls-files").trim()).toBe("tracked.txt");
  expect(await readFile(join(repo, ".gitignore"), "utf8")).not.toContain("tracked.txt");
});
it("refuses only when every selected path is already tracked", async () => {
  await writeFile(join(repo, "tracked.txt"), "keep");
  git("add", "tracked.txt");
  const result = await gitIgnoreAddMany(repo, ["tracked.txt"]);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/Only untracked files can be ignored/);
  expect(await readFile(join(repo, ".gitignore"), "utf8").catch(() => "")).toBe("");
  expect(git("ls-files").trim()).toBe("tracked.txt");
});
