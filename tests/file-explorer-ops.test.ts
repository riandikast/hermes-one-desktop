// @vitest-environment node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  copyExplorerEntry,
  createExplorerEntry,
  deleteExplorerEntry,
  renameExplorerEntry,
  validateEntryName,
} from "../src/main/file-explorer-ops";

let root = "";
let outside = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "explorer-ops-"));
  outside = await mkdtemp(join(tmpdir(), "explorer-outside-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "a.txt"), "hello");
  writeFileSync(join(root, "src", "b.ts"), "const b = 1;");
});

afterEach(async () => {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true }),
  ]);
});

it("renames a file or folder inside the root only", async () => {
  await expect(
    renameExplorerEntry(root, join(root, "a.txt"), "renamed.txt"),
  ).resolves.toMatchObject({ ok: true });
  expect(existsSync(join(root, "renamed.txt"))).toBe(true);
  expect(existsSync(join(root, "a.txt"))).toBe(false);
  await writeFile(join(root, "other.txt"), "x");
  await expect(
    renameExplorerEntry(root, join(root, "renamed.txt"), "other.txt"),
  ).resolves.toMatchObject({
    ok: false,
    error: expect.stringContaining("already exists"),
  });
  writeFileSync(join(outside, "secret.txt"), "s");
  await expect(
    renameExplorerEntry(root, join(outside, "secret.txt"), "hijacked.txt"),
  ).resolves.toMatchObject({ ok: false });
  await expect(
    renameExplorerEntry(root, join(root, "a.txt"), "../escape.txt"),
  ).resolves.toMatchObject({ ok: false });
});

it("creates files and folders with validated names and no overwrite", async () => {
  await expect(
    createExplorerEntry(root, join(root, "src"), "new.ts", "file"),
  ).resolves.toMatchObject({ ok: true });
  await expect(
    createExplorerEntry(root, join(root), "nested", "directory"),
  ).resolves.toMatchObject({ ok: true });
  expect(readFileSync(join(root, "src", "new.ts"), "utf-8")).toBe("");
  expect(existsSync(join(root, "nested"))).toBe(true);
  await expect(
    createExplorerEntry(root, join(root, "src"), "new.ts", "file"),
  ).resolves.toMatchObject({ ok: false });
  await expect(
    createExplorerEntry(root, join(root, "src"), "a/b.ts", "file"),
  ).resolves.toMatchObject({ ok: false });
  await expect(
    createExplorerEntry(root, outside, "x.ts", "file"),
  ).resolves.toMatchObject({ ok: false });
  expect(validateEntryName("..")).toBeTruthy();
  expect(validateEntryName(" padded ")).toBeTruthy();
  expect(validateEntryName("ok.ts")).toBeNull();
});

it("trashes a chat entry through the injected trash function", async () => {
  const trash = vi.fn(async () => undefined);
  await expect(
    deleteExplorerEntry(root, join(root, "a.txt"), trash),
  ).resolves.toMatchObject({ ok: true });
  expect(trash).toHaveBeenCalledTimes(1);
  expect(trash.mock.calls[0][0].replace(/\\/g, "/").endsWith("/a.txt")).toBe(
    true,
  );
  expect(existsSync(join(root, "a.txt"))).toBe(true); // injected trash does not delete
  const blocked = vi.fn(async () => undefined);
  await expect(
    deleteExplorerEntry(root, outside, blocked),
  ).resolves.toMatchObject({ ok: false });
  expect(blocked).not.toHaveBeenCalled();
});

it("copies files and folders with copy-suffix conflicts and refuses self-copy", async () => {
  await expect(
    copyExplorerEntry(root, join(root, "a.txt"), join(root, "src")),
  ).resolves.toMatchObject({ ok: true });
  expect(readFileSync(join(root, "src", "a.txt"), "utf-8")).toBe("hello");
  await expect(
    copyExplorerEntry(root, join(root, "a.txt"), join(root, "src")),
  ).resolves.toMatchObject({
    ok: true,
    path: expect.stringContaining("a copy.txt"),
  });
  await expect(
    copyExplorerEntry(root, join(root, "a.txt"), join(root, "src")),
  ).resolves.toMatchObject({
    ok: true,
    path: expect.stringContaining("a copy 2.txt"),
  });
  await expect(
    copyExplorerEntry(root, join(root, "src"), join(root)),
  ).resolves.toMatchObject({
    ok: true,
    path: expect.stringContaining("src copy"),
  });
  expect(existsSync(join(root, "src copy", "b.ts"))).toBe(true);
  await expect(
    copyExplorerEntry(root, join(root, "src"), join(root, "src")),
  ).resolves.toMatchObject({ ok: false });
  await expect(
    copyExplorerEntry(root, join(root, "a.txt"), outside),
  ).resolves.toMatchObject({ ok: false });
});
