// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { sshScriptSource } from "../src/main/ssh-scripts";

interface ScriptResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

let root = "";
let outside = "";

function run(
  kind: Parameters<typeof sshScriptSource>[0],
  payload: Record<string, unknown>,
): ScriptResult {
  const result = spawnSync("python3", ["-c", sshScriptSource(kind)], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    timeout: 20000,
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim()) as ScriptResult;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ssh-scripts-"));
  outside = mkdtempSync(join(tmpdir(), "ssh-scripts-outside-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

it("lists directories before files and resolves the home shorthand", () => {
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "a.txt"), "a");
  const listed = run("list", { path: root });
  expect(listed.ok).toBe(true);
  expect(
    (listed.entries as Array<{ name: string; isDirectory: boolean }>).map(
      (entry) => entry.name,
    ),
  ).toEqual(["src", "a.txt"]);
  const home = run("test", {});
  expect(home.ok).toBe(true);
  expect(typeof home.home).toBe("string");
});

it("reads and writes file contents with optional truncation", () => {
  const file = join(root, "note.txt");
  expect(run("write", { path: file, content: "hello world" }).ok).toBe(true);
  expect(readFileSync(file, "utf-8")).toBe("hello world");
  const read = run("read", { path: file });
  expect(read).toMatchObject({ ok: true, truncated: false });
  expect(Buffer.from(String(read.content), "base64").toString("utf-8")).toBe(
    "hello world",
  );
  const truncated = run("read", { path: file, maxBytes: 5 });
  expect(truncated.truncated).toBe(true);
  expect(
    Buffer.from(String(truncated.content), "base64").toString("utf-8"),
  ).toBe("hello");
});

it("creates entries, rejects duplicates and traversal names", () => {
  expect(
    run("create", { root, parent: root, name: "new.ts", kind: "file" }).ok,
  ).toBe(true);
  expect(existsSync(join(root, "new.ts"))).toBe(true);
  expect(
    run("create", { root, parent: root, name: "new.ts", kind: "file" }).ok,
  ).toBe(false);
  expect(
    run("create", { root, parent: root, name: "dir", kind: "directory" }).ok,
  ).toBe(true);
  expect(
    run("create", { root, parent: root, name: "../escape", kind: "file" }).ok,
  ).toBe(false);
  expect(
    run("create", { root, parent: outside, name: "x.ts", kind: "file" }).ok,
  ).toBe(false);
});

it("renames, deletes, and keeps mutations inside the root", () => {
  const file = join(root, "a.txt");
  writeFileSync(file, "a");
  const renamed = run("rename", { root, path: file, name: "b.txt" });
  expect(renamed.ok).toBe(true);
  expect(existsSync(join(root, "b.txt"))).toBe(true);
  writeFileSync(join(root, "c.txt"), "c");
  expect(
    run("rename", { root, path: join(root, "b.txt"), name: "c.txt" }).ok,
  ).toBe(false);
  writeFileSync(join(outside, "secret.txt"), "s");
  expect(run("delete", { root, path: join(outside, "secret.txt") }).ok).toBe(
    false,
  );
  expect(run("delete", { root, path: join(root, "b.txt") }).ok).toBe(true);
  expect(existsSync(join(root, "b.txt"))).toBe(false);
});

it("copies with copy-suffix conflicts and refuses copying a folder into itself", () => {
  const file = join(root, "a.txt");
  writeFileSync(file, "a");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "b.ts"), "b");
  expect(
    run("copy", { root, source: file, destination: join(root, "src") }).ok,
  ).toBe(true);
  expect(readFileSync(join(root, "src", "a.txt"), "utf-8")).toBe("a");
  const second = run("copy", {
    root,
    source: file,
    destination: join(root, "src"),
  });
  expect(second.ok).toBe(true);
  expect(String(second.path).endsWith("a copy.txt")).toBe(true);
  const third = run("copy", {
    root,
    source: file,
    destination: join(root, "src"),
  });
  expect(String(third.path).endsWith("a copy 2.txt")).toBe(true);
  const folder = run("copy", {
    root,
    source: join(root, "src"),
    destination: join(root),
  });
  expect(folder.ok).toBe(true);
  expect(existsSync(join(root, "src copy", "b.ts"))).toBe(true);
  expect(
    run("copy", {
      root,
      source: join(root, "src"),
      destination: join(root, "src"),
    }).ok,
  ).toBe(false);
});
