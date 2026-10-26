// @vitest-environment node
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import {
  exportKnowledgePackage,
  previewKnowledgePackage,
  importKnowledgePackage,
  saveKnowledgeDocument,
  readKnowledgePortableState,
  locateKnowledgeSource,
} from "./knowledge-package";
import { emptyKnowledgeSettings } from "../shared/knowledge-package";
import {
  renameKnowledgeBundle,
  renameKnowledgeFile,
  moveKnowledgeFile,
  deleteKnowledgeFile,
  deleteKnowledgeBundle,
} from "./knowledge";
let temp: string, first: string, second: string;
it("preserves both concurrent document saves", async () => {
  const source = join(temp, "project");
  await mkdir(source);
  const path = join(source, "file.ts");
  await Promise.all(
    ["a", "b"].map((name) =>
      saveKnowledgeDocument(
        `guide/${name}.md`,
        path,
        [{ start: 0, end: path.length, text: path, path }],
        [source],
        first,
      ),
    ),
  );
  expect(
    Object.keys((await readKnowledgePortableState(first)).references).sort(),
  ).toEqual(["guide/a.md", "guide/b.md"]);
});
it("keeps portable references after bundle rename, file rename, move and delete", async () => {
  const target = join(first, "knowledge", "guide", "target.md");
  await writeFile(target, "target");
  await saveKnowledgeDocument(
    "guide/note.md",
    target,
    [{ start: 0, end: target.length, text: target, path: target }],
    [],
    first,
  );
  expect(await renameKnowledgeBundle("guide", "renamed", first)).toBe(true);
  expect(
    await renameKnowledgeFile("renamed", "target.md", "other.md", first),
  ).toBe(true);
  await mkdir(join(first, "knowledge", "moved"));
  expect(await moveKnowledgeFile("renamed", "note.md", "moved", first)).toBe(
    true,
  );

  const refs = (await readKnowledgePortableState(first)).references;
  expect(refs["moved/note.md"][0].target).toEqual({
    kind: "bundle",
    path: "renamed/other.md",
  });
  const archive = await exportKnowledgePackage(emptyKnowledgeSettings(), first);
  const preview = await previewKnowledgePackage(archive, second);
  await importKnowledgePackage(
    {
      ticket: preview.ticket,
      names: { renamed: "copy", moved: "notes" },
      roots: {},
    },
    second,
  );

  expect(
    await readFile(join(second, "knowledge", "notes", "note.md"), "utf8"),
  ).toBe(join(second, "knowledge", "copy", "other.md"));
  expect(await deleteKnowledgeFile("moved", "note.md", first)).toBe(true);
  expect(
    (await readKnowledgePortableState(first)).references["moved/note.md"],
  ).toBeUndefined();
  expect(await deleteKnowledgeBundle("moved", first)).toBe(true);
});
it("exports portable registered text without device roots and detects file corruption", async () => {
  const path = join(first, "knowledge", "guide", "target.md");
  await writeFile(path, "target");
  await saveKnowledgeDocument(
    "guide/note.md",
    path,
    [{ start: 0, end: path.length, text: path, path }],
    [],
    first,
  );
  const files = unzipSync(
    await exportKnowledgePackage(emptyKnowledgeSettings(), first),
  );
  expect(Buffer.from(files["files/guide/note.md"]).toString()).not.toContain(
    first,
  );
  expect(Buffer.from(files["manifest.json"]).toString()).not.toContain(
    JSON.stringify(path).slice(1, -1),
  );
  files["files/guide/target.md"] = Buffer.from("damaged");
  await expect(
    previewKnowledgePackage(Buffer.from(zipSync(files)), second),
  ).rejects.toThrow(/integrity/);
});
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "knowledge-package-"));
  first = join(temp, "one");
  second = join(temp, "two");
  await mkdir(join(first, "knowledge", "guide"), { recursive: true });
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

// @lat: [[knowledge-packages#Portable knowledge packages#Relocation and unresolved sources]]
it("round-trips a ZIP, relocates registered references only, restores settings, resolves missing sources later", async () => {
  const target = join(first, "knowledge", "guide", "target.md");
  await writeFile(target, "# Target");
  const project = join(temp, "project-one");
  await mkdir(project);
  await writeFile(join(project, "private.txt"), "must not export");
  const external = join(project, "private.txt"),
    content = `Bundle: ${target}\nExternal: ${external}\nProse: ${external}`;
  const a = content.indexOf(target),
    b = content.indexOf(external);
  await saveKnowledgeDocument(
    "guide/note.md",
    content,
    [
      { start: a, end: a + target.length, text: target, path: target },
      { start: b, end: b + external.length, text: external, path: external },
    ],
    [project],
    first,
  );
  const settings = {
    ...emptyKnowledgeSettings(),
    folders: [project],
    fileFolders: { "guide/note.md": [project] },
    folderState: { "guide/note.md": { [project]: false } },
    disabledBundles: { guide: true },
  };
  const archive = await exportKnowledgePackage(settings, first);
  expect(
    Object.keys(unzipSync(archive)).some((k) => k.includes("private.txt")),
  ).toBe(false);
  const preview = await previewKnowledgePackage(archive, second);
  expect(preview.sources).toHaveLength(1);
  const result = await importKnowledgePackage(
    { ticket: preview.ticket, names: { guide: "copied" }, roots: {} },
    second,
  );
  expect(result.bundles).toEqual(["copied"]);
  expect(result.settings.disabledBundles).toEqual({ copied: true });
  let saved = await readFile(
    join(second, "knowledge", "copied", "note.md"),
    "utf8",
  );
  expect(saved).toContain(join(second, "knowledge", "copied", "target.md"));
  expect(saved).toContain("knowledge-source:");
  expect(saved).toContain(`Prose: ${external}`);
  const state = await readKnowledgePortableState(second),
    projectTwo = join(temp, "project-two");
  await mkdir(projectTwo);
  const restored = await locateKnowledgeSource(
    state.sources[0].id,
    projectTwo,
    second,
  );
  expect(restored.folderState).toEqual({
    "copied/note.md": { [projectTwo]: false },
  });
  saved = await readFile(
    join(second, "knowledge", "copied", "note.md"),
    "utf8",
  );
  expect(saved).toContain(`External: ${join(projectTwo, "private.txt")}`);
  expect(saved).toContain(`Prose: ${external}`);
});
it("maps a source once and restores unchecked per-file source settings", async () => {
  const root = join(temp, "source");
  await mkdir(root);
  const path = join(root, "code.ts");
  await saveKnowledgeDocument(
    "guide/note.md",
    path,
    [{ start: 0, end: path.length, text: path, path }],
    [root],
    first,
  );
  const settings = {
    ...emptyKnowledgeSettings(),
    folders: [root],
    fileFolders: { "guide/note.md": [root] },
    folderState: { "guide/note.md": { [root]: false } },
  };
  const preview = await previewKnowledgePackage(
    await exportKnowledgePackage(settings, first),
    second,
  );
  const result = await importKnowledgePackage(
    {
      ticket: preview.ticket,
      names: { guide: "guide" },
      roots: { [preview.sources[0].id]: root },
    },
    second,
  );
  expect(result.settings.folderState).toEqual({
    "guide/note.md": { [root]: false },
  });
  expect(
    await readFile(join(second, "knowledge", "guide", "note.md"), "utf8"),
  ).toBe(path);
});
it("previews conflicts, rejects overwrites, preserves existing content", async () => {
  await writeFile(join(first, "knowledge", "guide", "note.md"), "original");
  const preview = await previewKnowledgePackage(
    await exportKnowledgePackage(emptyKnowledgeSettings(), first),
    first,
  );
  expect(preview.bundles[0].conflict).toBe(true);
  await expect(
    importKnowledgePackage(
      { ticket: preview.ticket, names: { guide: "guide" }, roots: {} },
      first,
    ),
  ).rejects.toThrow(/exists/);
  expect(
    await readFile(join(first, "knowledge", "guide", "note.md"), "utf8"),
  ).toBe("original");
});
it.each([
  "../outside.md",
  "C:/outside.md",
  "guide/../../outside.md",
  "guide/CON",
])("rejects ZIP traversal and unsafe path %s", async (path) => {
  const archive = zipSync({
    ["files/" + path]: Buffer.from("bad"),
    "manifest.json": Buffer.from("{}"),
  });
  await expect(
    previewKnowledgePackage(Buffer.from(archive), second),
  ).rejects.toThrow();
});
it("rejects invalid schema, references, oversized data and symlink exports", async () => {
  await writeFile(join(first, "knowledge", "guide", "note.md"), "# Note");
  const good = await exportKnowledgePackage(emptyKnowledgeSettings(), first),
    files = unzipSync(good),
    manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
  manifest.references = {
    "guide/note.md": [
      {
        start: 0,
        end: 2,
        text: "no",
        target: { kind: "bundle", path: "../escape" },
      },
    ],
  };
  files["manifest.json"] = Buffer.from(JSON.stringify(manifest));
  await expect(
    previewKnowledgePackage(Buffer.from(zipSync(files)), second),
  ).rejects.toThrow();
  await expect(
    previewKnowledgePackage(Buffer.alloc(33 * 1024 * 1024), second),
  ).rejects.toThrow(/32 MB/);
  const outside = join(temp, "outside.md");
  await writeFile(outside, "private");
  try {
    await symlink(outside, join(first, "knowledge", "guide", "link.md"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EPERM") return;
    throw e;
  }
  await expect(
    exportKnowledgePackage(emptyKnowledgeSettings(), first),
  ).rejects.toThrow();
});
