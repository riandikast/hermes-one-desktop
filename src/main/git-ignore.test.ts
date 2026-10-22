import { beforeEach, afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { gitIgnoreEdit, gitIgnoreList } from "./git-ignore";
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
