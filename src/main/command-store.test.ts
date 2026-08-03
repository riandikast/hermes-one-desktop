// @vitest-environment node

import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteCommand,
  listCommands,
  saveCommand,
  type CommandRecord,
} from "./command-store";

describe("command store", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hermes-commands-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function record(id: string, patch: Partial<CommandRecord> = {}): CommandRecord {
    return {
      id,
      name: "Test",
      command: "echo hi",
      description: "",
      cwd: "",
      folder: "",
      createdAt: 0,
      updatedAt: 0,
      ...patch,
    };
  }

  it("returns an empty list when the store file is absent", async () => {
    expect(await listCommands(tempDir)).toEqual([]);
  });

  it("returns an empty list when the store file is corrupt", async () => {
    const { mkdir, writeFile } = await import("fs/promises");
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, "commands.json"), "{not json", "utf8");
    expect(await listCommands(tempDir)).toEqual([]);
  });

  it("saves, lists, and updates a command preserving createdAt", async () => {
    const saved = await saveCommand(record("c1", { createdAt: 100, updatedAt: 100 }), tempDir);
    expect(saved.updatedAt).toBeGreaterThanOrEqual(100);

    const listed = await listCommands(tempDir);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe("c1");
    expect(listed[0].createdAt).toBe(100);

    const updated = await saveCommand(
      record("c1", { name: "Renamed", command: "echo two\nlines", createdAt: 100 }),
      tempDir,
    );
    expect(updated.createdAt).toBe(100);
    const after = await listCommands(tempDir);
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe("Renamed");
    expect(after[0].command).toBe("echo two\nlines");
  });

  it("saves a new record without an id by keeping the caller's id", async () => {
    const saved = await saveCommand(record("brand-new"), tempDir);
    const listed = await listCommands(tempDir);
    expect(listed[0].id).toBe("brand-new");
    expect(saved.id).toBe("brand-new");
  });

  it("persists the folder field and defaults missing folders to empty", async () => {
    await saveCommand(record("f1", { folder: "Deploy" }), tempDir);
    await saveCommand(record("f2"), tempDir);
    const listed = await listCommands(tempDir);
    expect(listed.find((r) => r.id === "f1")?.folder).toBe("Deploy");
    expect(listed.find((r) => r.id === "f2")?.folder).toBe("");
  });

  it("deletes a command and persists the change", async () => {
    await saveCommand(record("keep"), tempDir);
    await saveCommand(record("drop"), tempDir);

    expect(await deleteCommand("drop", tempDir)).toBe(true);
    const listed = await listCommands(tempDir);
    expect(listed.map((r) => r.id)).toEqual(["keep"]);

    const raw = JSON.parse(await readFile(join(tempDir, "commands.json"), "utf8"));
    expect(raw).toHaveLength(1);

    expect(await deleteCommand("missing", tempDir)).toBe(false);
  });
});
