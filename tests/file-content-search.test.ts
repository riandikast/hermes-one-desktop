// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findMatchingLines,
  searchFileContents,
} from "../src/main/file-content-search";

describe("findMatchingLines", () => {
  it("returns 1-based line numbers of matching lines", () => {
    expect(findMatchingLines("a\nb\nhello world\nc", "hello")).toEqual([
      { line: 3, text: "hello world" },
    ]);
  });

  it("is case-insensitive", () => {
    expect(findMatchingLines("Hello\nWorld", "hello")).toEqual([
      { line: 1, text: "Hello" },
    ]);
  });

  it("handles CRLF and CR line endings", () => {
    expect(findMatchingLines("a\r\nb\r\nfind me\r\n", "find")).toEqual([
      { line: 3, text: "find me" },
    ]);
    expect(findMatchingLines("a\rb\rfind me\r", "find")).toEqual([
      { line: 3, text: "find me" },
    ]);
  });

  it("returns nothing for an empty query", () => {
    expect(findMatchingLines("hello", "")).toEqual([]);
  });

  it("caps matches per file", () => {
    const text = Array.from({ length: 50 }, () => "x hit").join("\n");
    expect(findMatchingLines(text, "hit", 10)).toHaveLength(10);
  });
});

describe("searchFileContents", () => {
  let tempDir: string;
  let root: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hermes-content-search-"));
    root = join(tempDir, "repo");
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, ".hidden-dir"), { recursive: true });
    await writeFile(join(root, "a.txt"), "alpha\nhello world\nomega", "utf8");
    await writeFile(
      join(root, "src", "b.ts"),
      "const x = 1;\nhello ts\n",
      "utf8",
    );
    await writeFile(
      join(root, "node_modules", "pkg", "index.js"),
      "hello node_modules",
      "utf8",
    );
    await writeFile(join(root, ".git", "config"), "hello git", "utf8");
    await writeFile(join(root, ".hidden-dir", "h.txt"), "hello hidden", "utf8");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("finds matches across roots, skipping vcs/build dirs", async () => {
    const results = await searchFileContents([root], "hello");
    const paths = results.map((r) => r.path.replaceAll("\\", "/"));
    expect(paths.some((p) => p.endsWith("/a.txt"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/src/b.ts"))).toBe(true);
    // node_modules / .git are excluded
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(paths.some((p) => p.includes("/.git/"))).toBe(false);
    // hidden dirs are excluded
    expect(paths.some((p) => p.includes(".hidden-dir"))).toBe(false);
  });

  it("returns an empty result for a non-matching query", async () => {
    const results = await searchFileContents([root], "zzz-nothing");
    expect(results).toEqual([]);
  });

  it("returns nothing for an empty query or empty roots", async () => {
    expect(await searchFileContents([root], "   ")).toEqual([]);
    expect(await searchFileContents([], "hello")).toEqual([]);
  });

  it("skips binary files", async () => {
    await writeFile(
      join(root, "bin.dat"),
      Buffer.from([0, 1, 2, 0, 255, 10, 104, 101, 108, 108, 111]),
    );
    const results = await searchFileContents([root], "hello");
    expect(results.some((r) => r.path.endsWith("bin.dat"))).toBe(false);
  });

  it("reports line numbers and text per match", async () => {
    const results = await searchFileContents([root], "hello");
    const a = results.find((r) => r.path.endsWith("a.txt"));
    expect(a).toBeDefined();
    expect(a!.matches).toEqual([{ line: 2, text: "hello world" }]);
  });
});
