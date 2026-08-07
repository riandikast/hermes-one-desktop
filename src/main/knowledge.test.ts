// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildFolderIndex,
  buildKnowledgeIndex,
  createKnowledgeBundle,
  deleteKnowledgeBundle,
  deleteKnowledgeFile,
  listKnowledgeBundles,
  moveKnowledgeFile,
  readKnowledgeFile,
  renameKnowledgeBundle,
  writeKnowledgeFile,
} from "./knowledge";

describe("knowledge store", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hermes-knowledge-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates and lists knowledge bundles", async () => {
    await createKnowledgeBundle("ui-rules", tempDir);
    const bundles = await listKnowledgeBundles(tempDir);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].name).toBe("ui-rules");
  });

  it("writes, reads, and deletes knowledge files", async () => {
    await createKnowledgeBundle("guide", tempDir);
    await writeKnowledgeFile("guide", "style.md", "# Style Guide", tempDir);

    const content = await readKnowledgeFile("guide", "style.md", tempDir);
    expect(content).toBe("# Style Guide");

    const bundles = await listKnowledgeBundles(tempDir);
    expect(bundles[0].files).toHaveLength(1);
    expect(bundles[0].files[0].name).toBe("style.md");

    await deleteKnowledgeFile("guide", "style.md", tempDir);
    const afterDelete = await readKnowledgeFile("guide", "style.md", tempDir);
    expect(afterDelete).toBeNull();
  });

  it("deletes a whole bundle", async () => {
    await createKnowledgeBundle("doomed", tempDir);
    await writeKnowledgeFile("doomed", "test.txt", "abc", tempDir);

    const deleted = await deleteKnowledgeBundle("doomed", tempDir);
    expect(deleted).toBe(true);

    const bundles = await listKnowledgeBundles(tempDir);
    expect(bundles).toHaveLength(0);
  });

  it("renames a bundle and keeps its files", async () => {
    await createKnowledgeBundle("old-name", tempDir);
    await writeKnowledgeFile("old-name", "style.md", "# Style", tempDir);

    const ok = await renameKnowledgeBundle("old-name", "new-name", tempDir);
    expect(ok).toBe(true);

    const bundles = await listKnowledgeBundles(tempDir);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].name).toBe("new-name");
    expect(bundles[0].files).toHaveLength(1);
    expect(bundles[0].files[0].name).toBe("style.md");
  });

  it("rejects renaming a bundle to the same or invalid name", async () => {
    await createKnowledgeBundle("same", tempDir);

    expect(await renameKnowledgeBundle("same", "same", tempDir)).toBe(false);
    expect(await renameKnowledgeBundle("same", "   ", tempDir)).toBe(false);
    const bundles = await listKnowledgeBundles(tempDir);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].name).toBe("same");
  });

  it("moves a file between bundles", async () => {
    await createKnowledgeBundle("from", tempDir);
    await createKnowledgeBundle("to", tempDir);
    await writeKnowledgeFile("from", "note.md", "content", tempDir);

    const ok = await moveKnowledgeFile("from", "note.md", "to", tempDir);
    expect(ok).toBe(true);

    expect(await readKnowledgeFile("from", "note.md", tempDir)).toBeNull();
    expect(await readKnowledgeFile("to", "note.md", tempDir)).toBe("content");
  });

  it("rejects moving a file to its own bundle", async () => {
    await createKnowledgeBundle("only", tempDir);
    await writeKnowledgeFile("only", "note.md", "content", tempDir);

    const ok = await moveKnowledgeFile("only", "note.md", "only", tempDir);
    expect(ok).toBe(false);
    expect(await readKnowledgeFile("only", "note.md", tempDir)).toBe("content");
  });

  it("builds a knowledge index with file hints", async () => {
    await createKnowledgeBundle("ui-rules", tempDir);
    await writeKnowledgeFile(
      "ui-rules",
      "style.md",
      "# Style Guide\nColors!",
      tempDir,
    );
    await writeKnowledgeFile(
      "ui-rules",
      "naming.md",
      "Naming conventions",
      tempDir,
    );

    const index = await buildKnowledgeIndex(["ui-rules"], tempDir);

    expect(index).toContain("## ui-rules");
    expect(index).toContain(
      `- ${join(tempDir, "knowledge", "ui-rules", "style.md")} — # Style Guide — Colors!`,
    );
    expect(index).toContain(
      `- ${join(tempDir, "knowledge", "ui-rules", "naming.md")} — Naming conventions`,
    );
    expect(index).toContain("Read files with the file tools");
    expect(index).toContain("AUTHORITATIVE");
    expect(index).toContain("open the file to see its full content");
  });

  it("returns empty index for no bundles", async () => {
    const index = await buildKnowledgeIndex([], tempDir);
    expect(index).toBe("");
  });

  it("skips missing bundles and dedupes names", async () => {
    await createKnowledgeBundle("present", tempDir);
    await writeKnowledgeFile("present", "a.md", "Alpha", tempDir);

    const index = await buildKnowledgeIndex(
      ["missing", "present", "present"],
      tempDir,
    );

    expect(index).toContain("## present");
    expect(index).not.toContain("## missing");
  });

  it("truncates long first lines in hints", async () => {
    await createKnowledgeBundle("long", tempDir);
    await writeKnowledgeFile(
      "long",
      "b.md",
      `${"x".repeat(300)}\nsecond line`,
      tempDir,
    );

    const index = await buildKnowledgeIndex(["long"], tempDir);

    expect(index).toContain(
      `- ${join(tempDir, "knowledge", "long", "b.md")} — `,
    );
    expect(index).not.toContain("second line");
    expect(index.length).toBeLessThan(2000);
  });

  it("enriches a short heading hint with the next non-empty line", async () => {
    await createKnowledgeBundle("proj", tempDir);
    await writeKnowledgeFile(
      "proj",
      "readme.md",
      "# Project Notes\nThis describes the build system.",
      tempDir,
    );
    await writeKnowledgeFile(
      "proj",
      "plain.md",
      "Just a prose sentence that is long enough to not be a heading.",
      tempDir,
    );

    const index = await buildKnowledgeIndex(["proj"], tempDir);

    // A short heading alone is cryptic; the next non-empty line is appended so
    // the model can judge relevance without opening every file.
    expect(index).toContain(
      "# Project Notes — This describes the build system.",
    );
    // A long prose first line already carries meaning, so no second line is
    // pulled (keeps the hint a pointer, not a content dump).
    expect(index).toContain(
      "- " +
        join(tempDir, "knowledge", "proj", "plain.md") +
        " — Just a prose sentence that is long enough to not be a heading.",
    );
  });

  describe("buildFolderIndex", () => {
    let workspace: string;

    beforeEach(async () => {
      workspace = join(tempDir, "workspace");
      await mkdir(join(workspace, "src"), { recursive: true });
      await mkdir(join(workspace, "node_modules", "pkg"), { recursive: true });
      await mkdir(join(workspace, ".git"), { recursive: true });
      await writeFile(
        join(workspace, "readme.md"),
        "# Workspace\nBuild docs.",
        "utf8",
      );
      await writeFile(
        join(workspace, "src", "main.ts"),
        "export const x = 1;",
        "utf8",
      );
      await writeFile(
        join(workspace, "node_modules", "pkg", "index.js"),
        "hidden",
        "utf8",
      );
      await writeFile(join(workspace, ".git", "config"), "hidden", "utf8");
    });

    it("indexes workspace files with hints, skipping vcs/deps dirs", async () => {
      const index = await buildFolderIndex([workspace]);

      expect(index).toContain("## workspace");
      expect(index).toContain(
        `- ${join(workspace, "readme.md")} — # Workspace — Build docs.`,
      );
      expect(index).toContain(`- ${join(workspace, "src", "main.ts")}`);
      expect(index).not.toContain("node_modules");
      expect(index).not.toContain("pkg");
      expect(index).not.toContain(".git");
    });

    it("returns an empty string for no folders", async () => {
      expect(await buildFolderIndex([])).toBe("");
      expect(await buildFolderIndex(["   "])).toBe("");
    });
  });
});
