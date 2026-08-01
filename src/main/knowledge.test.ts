// @vitest-environment node

import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createKnowledgeBundle,
  deleteKnowledgeBundle,
  deleteKnowledgeFile,
  listKnowledgeBundles,
  readKnowledgeFile,
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
});
