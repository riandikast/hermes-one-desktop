import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  win32,
  posix,
} from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { unzipSync, zipSync } from "fflate";
import { getKnowledgeDir, listKnowledgeBundles } from "./knowledge";
import type {
  KnowledgeImportOptions,
  KnowledgeImportResult,
  KnowledgePackagePreview,
  KnowledgePortableState,
  KnowledgeReference,
  KnowledgeSourceSettings,
} from "../shared/knowledge-package";

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 1000;
const STATE = ".portable.json";
interface PackageManifest {
  format: "hermes-knowledge";
  version: 1;
  bundles: string[];
  sources: { id: string; name: string }[];
  references: Record<string, KnowledgeReference[]>;
  hashes: Record<string, string>;
  settings: KnowledgeSourceSettings;
}
const tickets = new Map<string, { archive: Buffer; home?: string }>();
const updates = new Map<string, Promise<unknown>>();
async function locked<T>(
  home: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const key = resolve(getKnowledgeDir(home));
  const next = (updates.get(key) || Promise.resolve())
    .catch(() => undefined)
    .then(run);
  updates.set(key, next);
  try {
    return (await next) as T;
  } finally {
    if (updates.get(key) === next) updates.delete(key);
  }
}
const windowsPath = (path: string): boolean =>
  /^(?:[a-z]:[\\/]|\\\\)/i.test(path);
const cleanSegment = (name: unknown): name is string =>
  typeof name === "string" &&
  name.length > 0 &&
  name.length <= 180 &&
  !/[<>:"/\\|?*]/.test(name) &&
  !Array.from(name).some((char) => char.charCodeAt(0) < 32) &&
  !/[. ]$/.test(name) &&
  !/^\./.test(name) &&
  !/^(?:__proto__|prototype|constructor)$/i.test(name) &&
  !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
const safePath = (path: unknown): path is string =>
  typeof path === "string" &&
  path.split("/").length >= 2 &&
  path.split("/").every(cleanSegment);
const inside = (root: string, path: string): boolean => {
  const r = relative(resolve(root), resolve(path));
  return (
    r !== ".." &&
    !r.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(r)
  );
};
const absolute = (path: string): boolean =>
  isAbsolute(path) || win32.isAbsolute(path);
const normalize = (path: string): string =>
  (windowsPath(path) ? win32 : posix)
    .normalize(path)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
function subpath(root: string, path: string): string | null {
  const r = normalize(root),
    p = normalize(path);
  const windows = windowsPath(root);
  const a = windows ? r.toLowerCase() : r,
    b = windows ? p.toLowerCase() : p;
  return b === a ? "" : b.startsWith(a + "/") ? p.slice(r.length + 1) : null;
}
async function plainPath(root: string, path: string): Promise<void> {
  if (!inside(root, path)) throw new Error("Path outside knowledge directory");
  let current = resolve(root);
  if ((await lstat(current)).isSymbolicLink())
    throw new Error("Linked knowledge directory is not supported");
  for (const segment of relative(current, resolve(path))
    .split(/[\\/]/)
    .filter(Boolean)) {
    current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("Linked files are not supported");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function settings(value: unknown): asserts value is KnowledgeSourceSettings {
  if (
    !record(value) ||
    !Array.isArray(value.folders) ||
    !record(value.fileFolders) ||
    !record(value.folderState) ||
    !record(value.disabledBundles)
  )
    throw new Error("Invalid source settings");
  for (const list of [value.folders, ...Object.values(value.fileFolders)])
    if (!Array.isArray(list) || list.some((x) => typeof x !== "string"))
      throw new Error("Invalid folder list");
  for (const row of Object.values(value.folderState))
    if (!record(row) || Object.values(row).some((x) => typeof x !== "boolean"))
      throw new Error("Invalid folder state");
  if (Object.values(value.disabledBundles).some((x) => typeof x !== "boolean"))
    throw new Error("Invalid bundle state");
}
export function readKnowledgePortableState(
  home?: string,
): Promise<KnowledgePortableState> {
  return locked(home, () => readPortableState(home));
}
export function serializeKnowledgePackageOperation<T>(
  home: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  return locked(home, run);
}
async function readPortableState(
  home?: string,
): Promise<KnowledgePortableState> {
  try {
    const root = getKnowledgeDir(home);
    await plainPath(root, join(root, STATE));
    const state = JSON.parse(await readFile(join(root, STATE), "utf8"));
    if (
      !record(state) ||
      !Array.isArray(state.sources) ||
      !record(state.references)
    )
      throw new Error("Invalid portable reference metadata");
    return state as unknown as KnowledgePortableState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { sources: [], references: {} };
    throw error;
  }
}
export function renameKnowledgeMetadata(
  oldKey: string,
  newKey: string,
  home: string | undefined,
  move: () => Promise<void>,
  rollback: () => Promise<void>,
): Promise<void> {
  return locked(home, () =>
    renameMetadata(oldKey, newKey, home, move, rollback),
  );
}
export function renameKnowledgeMetadataUnlocked(
  oldKey: string,
  newKey: string,
  home: string | undefined,
  move: () => Promise<void>,
  rollback: () => Promise<void>,
): Promise<void> {
  return renameMetadata(oldKey, newKey, home, move, rollback);
}
async function renameMetadata(
  oldKey: string,
  newKey: string,
  home: string | undefined,
  move: () => Promise<void>,
  rollback: () => Promise<void>,
): Promise<void> {
  const state = await readPortableState(home);
  if (
    oldKey.includes("/")
      ? !safePath(oldKey) || !safePath(newKey)
      : !cleanSegment(oldKey) || !cleanSegment(newKey)
  )
    throw new Error("Invalid knowledge path");
  const bundleRename = !oldKey.includes("/");
  const from = bundleRename ? `${oldKey}/` : oldKey;
  const to = bundleRename ? `${newKey}/` : newKey;
  const root = getKnowledgeDir(home);
  const moved: Array<{
    path: string;
    before: string;
    after: string;
    key: string;
    nextKey: string;
  }> = [];
  const allBundles = await listKnowledgeBundles(home);
  const existingKeys = new Set(
    allBundles.flatMap((bundle) =>
      bundle.files.map((file) => `${bundle.name}/${file.name}`),
    ),
  );
  const nextKeys = new Map<string, string>();
  if (bundleRename) {
    for (const key of existingKeys)
      if (key.startsWith(from)) nextKeys.set(key, to + key.slice(from.length));
  } else if (existingKeys.has(oldKey)) nextKeys.set(oldKey, newKey);
  for (const key of Object.keys(state.references))
    if (key.startsWith(from)) nextKeys.set(key, to + key.slice(from.length));
  const allTargets = new Set(nextKeys.values());
  const moving = new Set(nextKeys.keys());
  for (const [key, nextKey] of nextKeys) {
    if (nextKey !== key && existingKeys.has(nextKey) && !moving.has(nextKey))
      throw new Error("Rename destination already exists");
    if (nextKey !== key && state.references[nextKey] && !moving.has(nextKey))
      throw new Error("Portable metadata target already exists");
  }
  if (allTargets.size !== nextKeys.size)
    throw new Error("Rename destinations collide");
  for (const [key, refs] of Object.entries(state.references)) {
    const nextKey = nextKeys.get(key) ?? key;
    const file = join(root, key);
    await plainPath(root, file);
    const before = await readFile(file, "utf8");
    if (refs.some((ref) => !validRef(ref, before)))
      throw new Error(`References changed in ${key}; save before renaming`);
    const rewritten = relocate(before, refs, (ref) => {
      if (ref.target.kind !== "bundle") return ref.text;
      const target = ref.target.path;
      if (bundleRename && target.startsWith(from))
        return join(root, to + target.slice(from.length));
      if (!bundleRename && target === oldKey)
        return join(dirname(join(root, oldKey)), newKey.split("/").pop()!);
      return ref.text;
    });
    if (nextKey !== key && !existingKeys.has(nextKey)) {
      const candidate = join(root, nextKey);
      try {
        await lstat(candidate);
        throw new Error("Rename destination already exists");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    moved.push({ path: file, before, after: rewritten.content, key, nextKey });
    delete state.references[key];
    state.references[nextKey] = rewritten.refs.map((ref) => {
      if (ref.target.kind !== "bundle") return ref;
      let targetPath = ref.target.path;
      if (bundleRename && targetPath.startsWith(from))
        targetPath = to + targetPath.slice(from.length);
      if (!bundleRename && targetPath === oldKey) targetPath = newKey;
      return { ...ref, target: { ...ref.target, path: targetPath } };
    });
  }
  if (state.settings) {
    for (const field of ["fileFolders", "folderState"] as const)
      for (const [key, value] of Object.entries(state.settings[field])) {
        const nextKey = key.startsWith(from)
          ? to + key.slice(from.length)
          : key;
        if (nextKey !== key) {
          (state.settings[field] as Record<string, unknown>)[nextKey] = value;
          delete (state.settings[field] as Record<string, unknown>)[key];
        }
      }
    if (bundleRename && Object.hasOwn(state.settings.disabledBundles, oldKey)) {
      state.settings.disabledBundles[newKey] =
        state.settings.disabledBundles[oldKey];
      delete state.settings.disabledBundles[oldKey];
    }
  }
  let mutationAttempted = false;
  const written: Array<{ path: string; before: string }> = [];
  try {
    for (const item of moved) {
      const path = item.path;
      const temp = join(dirname(path), `.reference-${randomUUID()}.tmp`);
      await writeFile(temp, item.after, { flag: "wx" });
      await rename(temp, path);
      written.push({ path, before: item.before });
    }
    mutationAttempted = true;
    await move();
    await saveState(state, home);
  } catch (error) {
    if (mutationAttempted)
      try {
        await rollback();
      } catch {
        // Keep the original error when filesystem rollback also fails.
      }
    for (const item of written.reverse()) {
      try {
        const temp = join(
          dirname(item.path),
          `.reference-rollback-${randomUUID()}.tmp`,
        );
        await writeFile(temp, item.before, { flag: "wx" });
        await rename(temp, item.path);
      } catch {
        // Keep the original error when reference rollback also fails.
      }
    }
    throw error;
  }
}
export function forgetKnowledgeFile(key: string, home?: string): Promise<void> {
  return locked(home, () => forgetKnowledgeFileInternal(key, home));
}
export function forgetKnowledgeFileUnlocked(
  key: string,
  home?: string,
): Promise<void> {
  return forgetKnowledgeFileInternal(key, home);
}
async function forgetKnowledgeFileInternal(
  key: string,
  home?: string,
): Promise<void> {
  if (!safePath(key)) throw new Error("Invalid knowledge path");
  const state = await readPortableState(home);
  delete state.references[key];
  if (state.settings) {
    delete state.settings.fileFolders[key];
    delete state.settings.folderState[key];
  }
  await saveState(state, home);
}
export function forgetKnowledgeBundle(
  bundle: string,
  home?: string,
): Promise<void> {
  return locked(home, () => forgetKnowledgeBundleInternal(bundle, home));
}
export function forgetKnowledgeBundleUnlocked(
  bundle: string,
  home?: string,
): Promise<void> {
  return forgetKnowledgeBundleInternal(bundle, home);
}
async function forgetKnowledgeBundleInternal(
  bundle: string,
  home?: string,
): Promise<void> {
  if (!cleanSegment(bundle)) throw new Error("Invalid bundle name");
  const state = await readPortableState(home),
    prefix = `${bundle}/`;
  for (const key of Object.keys(state.references))
    if (key.startsWith(prefix)) delete state.references[key];
  if (state.settings) {
    for (const field of ["fileFolders", "folderState"] as const)
      for (const key of Object.keys(state.settings[field]))
        if (key.startsWith(prefix)) delete state.settings[field][key];
    delete state.settings.disabledBundles[bundle];
  }
  await saveState(state, home);
}
async function saveState(
  state: KnowledgePortableState,
  home?: string,
): Promise<void> {
  const root = getKnowledgeDir(home);
  await mkdir(root, { recursive: true });
  await plainPath(root, join(root, STATE));
  const temp = join(root, `.portable-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(state, null, 2), { flag: "wx" });
    await rename(temp, join(root, STATE));
  } finally {
    await rm(temp, { force: true });
  }
}
export interface DocumentReference {
  start: number;
  end: number;
  text: string;
  path: string;
}
function validRef(
  ref: KnowledgeReference | DocumentReference,
  content: string,
): boolean {
  return (
    Number.isSafeInteger(ref.start) &&
    Number.isSafeInteger(ref.end) &&
    ref.start >= 0 &&
    ref.end > ref.start &&
    ref.end <= content.length &&
    content.slice(ref.start, ref.end) === ref.text
  );
}
function sourceFor(state: KnowledgePortableState, root: string): string {
  let source = state.sources.find(
    (s) => s.root && normalize(s.root) === normalize(root),
  );
  if (!source) {
    source = {
      id: randomUUID(),
      name: normalize(root).split("/").pop() || "Source folder",
      root,
    };
    state.sources.push(source);
  }
  return source.id;
}
export function saveKnowledgeDocument(
  key: string,
  content: string,
  references: DocumentReference[],
  roots: string[],
  home?: string,
): Promise<boolean> {
  return locked(home, () =>
    saveDocument(key, content, references, roots, home),
  );
}
async function saveDocument(
  key: string,
  content: string,
  references: DocumentReference[],
  roots: string[],
  home?: string,
): Promise<boolean> {
  if (
    !safePath(key) ||
    key.split("/").length !== 2 ||
    typeof content !== "string" ||
    Buffer.byteLength(content) > MAX_BYTES ||
    !Array.isArray(references) ||
    references.length > MAX_FILES ||
    !Array.isArray(roots) ||
    roots.some((r) => typeof r !== "string" || !absolute(r))
  )
    throw new Error("Invalid knowledge document");
  const root = getKnowledgeDir(home),
    path = join(root, key);
  await mkdir(root, { recursive: true });
  await plainPath(root, path);
  await mkdir(dirname(path), { recursive: true });
  const state = await readPortableState(home);
  const refs: KnowledgeReference[] = [];
  for (const ref of references) {
    if (!validRef(ref, content) || typeof ref.path !== "string")
      throw new Error("Reference changed; select the path again");
    if (ref.path.startsWith("knowledge-source:")) {
      const old = state.references[key]?.find(
        (r) => r.text === ref.path && r.target.kind === "source",
      );
      if (!old) throw new Error("Unknown unresolved reference");
      refs.push({ ...old, start: ref.start, end: ref.end, text: ref.text });
      continue;
    }
    if (!absolute(ref.path)) throw new Error("Select an absolute file path");
    const bundled = subpath(root, ref.path);
    if (bundled !== null && safePath(bundled))
      refs.push({ ...ref, target: { kind: "bundle", path: bundled } });
    else {
      const candidates = [
        ...roots,
        ...state.sources.flatMap((s) => (s.root ? [s.root] : [])),
      ]
        .filter((r) => subpath(r, ref.path) !== null)
        .sort((a, b) => b.length - a.length);
      const sourceRoot =
        candidates[0] ||
        (win32.isAbsolute(ref.path)
          ? win32.dirname(ref.path)
          : dirname(ref.path));
      refs.push({
        start: ref.start,
        end: ref.end,
        text: ref.text,
        target: {
          kind: "source",
          source: sourceFor(state, sourceRoot),
          path: subpath(sourceRoot, ref.path)!,
        },
      });
    }
  }
  const sorted = refs.sort((a, b) => a.start - b.start);
  if (sorted.some((ref, i) => i > 0 && ref.start < sorted[i - 1].end))
    throw new Error("Overlapping references");
  state.references[key] = sorted;
  let before: Buffer | null = null;
  try {
    before = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    const temp = join(dirname(path), `.document-${randomUUID()}.tmp`);
    await writeFile(temp, content, { flag: "wx" });
    await rename(temp, path);
    await saveState(state, home);
  } catch (error) {
    if (before) {
      const temp = join(
        dirname(path),
        `.document-rollback-${randomUUID()}.tmp`,
      );
      await writeFile(temp, before, { flag: "wx" });
      await rename(temp, path);
    } else await rm(path, { force: true });
    throw error;
  }
  return true;
}
export function getKnowledgeDocumentReferences(
  key: string,
  home?: string,
): Promise<DocumentReference[]> {
  return locked(home, () => getDocumentReferences(key, home));
}
async function getDocumentReferences(
  key: string,
  home?: string,
): Promise<DocumentReference[]> {
  if (!safePath(key)) throw new Error("Invalid file");
  const state = await readPortableState(home);
  const content = await readFile(join(getKnowledgeDir(home), key), "utf8");
  return (state.references[key] || [])
    .filter((ref) => validRef(ref, content))
    .map((ref) => ({
      start: ref.start,
      end: ref.end,
      text: ref.text,
      path: ref.text,
    }));
}
function mapSettings(
  input: KnowledgeSourceSettings,
  mapFolder: (path: string) => string | null,
  mapKey: (key: string) => string,
): KnowledgeSourceSettings {
  return {
    folders: input.folders.flatMap((p) => {
      const mapped = mapFolder(p);
      return mapped ? [mapped] : [];
    }),
    fileFolders: Object.fromEntries(
      Object.entries(input.fileFolders).map(([k, list]) => [
        mapKey(k),
        list.flatMap((p) => {
          const mapped = mapFolder(p);
          return mapped ? [mapped] : [];
        }),
      ]),
    ),
    folderState: Object.fromEntries(
      Object.entries(input.folderState).map(([k, row]) => [
        mapKey(k),
        Object.fromEntries(
          Object.entries(row).flatMap(([p, v]) => {
            const mapped = mapFolder(p);
            return mapped ? [[mapped, v]] : [];
          }),
        ),
      ]),
    ),
    disabledBundles: Object.fromEntries(
      Object.entries(input.disabledBundles).map(([k, v]) => [mapKey(k), v]),
    ),
  };
}
export function exportKnowledgePackage(
  input: KnowledgeSourceSettings,
  home?: string,
): Promise<Buffer> {
  return locked(home, () => exportPackage(input, home));
}
async function exportPackage(
  input: KnowledgeSourceSettings,
  home?: string,
): Promise<Buffer> {
  settings(input);
  const root = getKnowledgeDir(home),
    state = await readPortableState(home);
  const bundles = await listKnowledgeBundles(home);
  const files: Record<string, Uint8Array> = {};
  let bytes = 0;
  for (const bundle of bundles) {
    if (!cleanSegment(bundle.name))
      throw new Error("Rename unsupported bundle before exporting");
    for (const entry of await readdir(bundle.path, { withFileTypes: true })) {
      if (!entry.isFile() || !cleanSegment(entry.name))
        throw new Error(
          "Packages currently support regular files directly inside bundles only",
        );
      const key = `${bundle.name}/${entry.name}`,
        path = join(root, key);
      await plainPath(root, path);
      const data = await readFile(path);
      bytes += data.length;
      if (bytes > MAX_BYTES || Object.keys(files).length >= MAX_FILES)
        throw new Error("Knowledge package exceeds 32 MB or 1000 files");
      files[`files/${key}`] = data;
    }
  }
  const refs = Object.fromEntries(
    Object.entries(state.references)
      .filter(([key]) => files[`files/${key}`])
      .map(([key, list]) => {
        const content = Buffer.from(files[`files/${key}`]).toString("utf8");
        const current = list.filter((ref) => validRef(ref, content));
        const portable = relocate(content, current, (ref) =>
          ref.target.kind === "bundle"
            ? `knowledge-bundle:${ref.target.path}`
            : `knowledge-source:${ref.target.source}/${ref.target.path}`,
        );
        if (current.length)
          files[`files/${key}`] = Buffer.from(portable.content);
        return [
          key,
          portable.refs.map(({ start, end, text, target }) => ({
            start,
            end,
            text,
            target,
          })),
        ];
      }),
  );
  const selectedSettings: KnowledgeSourceSettings = {
    ...input,
    fileFolders: Object.fromEntries(
      Object.entries(input.fileFolders).filter(([k]) => files[`files/${k}`]),
    ),
    folderState: Object.fromEntries(
      Object.entries(input.folderState).filter(([k]) => files[`files/${k}`]),
    ),
    disabledBundles: Object.fromEntries(
      Object.entries(input.disabledBundles).filter(([k]) =>
        bundles.some((b) => b.name === k),
      ),
    ),
  };
  const portableSettings = mapSettings(
    selectedSettings,
    (path) => sourceFor(state, path),
    (key) => key,
  );
  // Keep unresolved checkbox metadata even before the root has been located.
  if (state.settings) {
    const unresolved = new Set(
      state.sources.filter((s) => !s.root).map((s) => s.id),
    );
    for (const [key, ids] of Object.entries(state.settings.fileFolders))
      if (files[`files/${key}`])
        portableSettings.fileFolders[key] = [
          ...new Set([
            ...(portableSettings.fileFolders[key] || []),
            ...ids.filter((id) => unresolved.has(id)),
          ]),
        ];
    for (const [key, row] of Object.entries(state.settings.folderState))
      if (files[`files/${key}`])
        portableSettings.folderState[key] = {
          ...Object.fromEntries(
            Object.entries(row).filter(([id]) => unresolved.has(id)),
          ),
          ...portableSettings.folderState[key],
        };
    portableSettings.folders = [
      ...new Set([
        ...portableSettings.folders,
        ...state.settings.folders.filter((id) => unresolved.has(id)),
      ]),
    ];
  }
  const usedSources = new Set([
    ...portableSettings.folders,
    ...Object.values(portableSettings.fileFolders).flat(),
    ...Object.values(portableSettings.folderState).flatMap(Object.keys),
    ...Object.values(refs)
      .flat()
      .flatMap((ref) =>
        ref.target.kind === "source" ? [ref.target.source] : [],
      ),
  ]);
  const manifest: PackageManifest = {
    format: "hermes-knowledge",
    version: 1,
    bundles: bundles.map((b) => b.name),
    sources: state.sources
      .filter((s) => usedSources.has(s.id))
      .map(({ id, name }) => ({ id, name })),
    references: refs,
    hashes: Object.fromEntries(
      Object.entries(files)
        .filter(([key]) => key.startsWith("files/"))
        .map(([key, data]) => [
          key,
          createHash("sha256").update(data).digest("hex"),
        ]),
    ),
    settings: portableSettings,
  };
  files["manifest.json"] = Buffer.from(JSON.stringify(manifest));
  if (bytes + files["manifest.json"].length > MAX_BYTES)
    throw new Error("Knowledge package exceeds 32 MB");
  return Buffer.from(zipSync(files, { level: 6 }));
}
function unpack(archive: Buffer): {
  manifest: PackageManifest;
  files: Record<string, Uint8Array>;
} {
  if (archive.length > MAX_BYTES) throw new Error("Package exceeds 32 MB");
  let count = 0,
    bytes = 0;
  const seen = new Set<string>();
  const files = unzipSync(archive, {
    filter: (file) => {
      count++;
      bytes += file.originalSize;
      if (seen.has(file.name.toLowerCase()))
        throw new Error("Duplicate ZIP paths");
      seen.add(file.name.toLowerCase());
      if (
        count > MAX_FILES + 1 ||
        bytes > MAX_BYTES ||
        (file.name !== "manifest.json" &&
          (!file.name.startsWith("files/") || !safePath(file.name.slice(6)))) ||
        file.compression > 8
      )
        throw new Error("Unsafe or oversized knowledge ZIP");
      return true;
    },
  });
  if (!files["manifest.json"]) throw new Error("Knowledge manifest missing");
  const m = JSON.parse(Buffer.from(files["manifest.json"]).toString("utf8"));
  if (
    !record(m) ||
    m.format !== "hermes-knowledge" ||
    m.version !== 1 ||
    !Array.isArray(m.bundles) ||
    !m.bundles.length ||
    !m.bundles.every(cleanSegment) ||
    new Set(m.bundles.map((s: string) => s.toLowerCase())).size !==
      m.bundles.length ||
    !Array.isArray(m.sources) ||
    m.bundles.length > MAX_FILES ||
    m.sources.length > MAX_FILES ||
    !record(m.references) ||
    !record(m.hashes)
  )
    throw new Error("Unsupported knowledge package");
  const hashes = m.hashes as Record<string, unknown>;
  settings(m.settings);
  const bundleNames = m.bundles;
  if (
    Object.keys(m.settings.fileFolders).some(
      (k) => !safePath(k) || !files[`files/${k}`],
    ) ||
    Object.keys(m.settings.folderState).some(
      (k) => !safePath(k) || !files[`files/${k}`],
    ) ||
    Object.keys(m.settings.disabledBundles).some(
      (k) => !bundleNames.includes(k),
    )
  )
    throw new Error("Invalid settings target");
  const sources = new Set<string>();
  for (const s of m.sources) {
    if (
      !record(s) ||
      typeof s.id !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(s.id) ||
      typeof s.name !== "string" ||
      s.name.length > 180 ||
      sources.has(s.id)
    )
      throw new Error("Invalid source");
    sources.add(s.id);
  }
  const names = Object.keys(files);
  const archivePaths = new Set(names.map((name) => name.toLowerCase()));
  if (archivePaths.size !== names.length)
    throw new Error("Duplicate ZIP paths");
  const expectedHashes = Object.keys(hashes);
  if (
    expectedHashes.length !== names.length - 1 ||
    names.some(
      (key) =>
        key !== "manifest.json" &&
        hashes[key] !== createHash("sha256").update(files[key]).digest("hex"),
    )
  )
    throw new Error("Package file integrity check failed");
  for (const key of names.filter((n) => n !== "manifest.json"))
    if (
      key.slice(6).split("/").length !== 2 ||
      !m.bundles.includes(key.slice(6).split("/")[0])
    )
      throw new Error("Unexpected package file");
  for (const [key, list] of Object.entries(m.references)) {
    if (!safePath(key) || !files[`files/${key}`] || !Array.isArray(list))
      throw new Error("Invalid references");
    let end = 0;
    const content = Buffer.from(files[`files/${key}`]).toString("utf8");
    for (const ref of [...list].sort((a, b) => a.start - b.start)) {
      if (
        !record(ref) ||
        !validRef(ref as unknown as KnowledgeReference, content) ||
        Number(ref.start) < end ||
        !record(ref.target)
      )
        throw new Error("Invalid reference span");
      const target = ref.target;
      if (
        target.kind === "bundle"
          ? !safePath(target.path) || !files[`files/${target.path}`]
          : target.kind !== "source" ||
            typeof target.source !== "string" ||
            !sources.has(target.source) ||
            typeof target.path !== "string" ||
            (target.path !== "" && !target.path.split("/").every(cleanSegment))
      )
        throw new Error("Invalid reference target");
      end = ref.end as number;
    }
  }
  for (const id of [
    ...m.settings.folders,
    ...Object.values(m.settings.fileFolders).flat(),
    ...Object.values(m.settings.folderState).flatMap(Object.keys),
  ])
    if (!sources.has(id)) throw new Error("Unknown source setting");
  return { manifest: m as unknown as PackageManifest, files };
}
export function previewKnowledgePackage(
  archive: Buffer,
  home?: string,
): Promise<KnowledgePackagePreview> {
  return locked(home, () => previewPackage(archive, home));
}
async function previewPackage(
  archive: Buffer,
  home?: string,
): Promise<KnowledgePackagePreview> {
  const { manifest, files } = unpack(archive);
  const existing = new Set(
    (await listKnowledgeBundles(home)).map((b) => b.name.toLowerCase()),
  );
  const ticket = randomUUID();
  if (tickets.size >= 4) tickets.delete(tickets.keys().next().value!);
  tickets.set(ticket, { archive, home });
  return {
    ticket,
    bundles: manifest.bundles.map((name) => ({
      name,
      files: Object.keys(files).filter((p) => p.startsWith(`files/${name}/`))
        .length,
      conflict: existing.has(name.toLowerCase()),
    })),
    sources: manifest.sources,
  };
}
function relocate(
  content: string,
  refs: KnowledgeReference[],
  target: (r: KnowledgeReference) => string,
): { content: string; refs: KnowledgeReference[] } {
  let result = "",
    cursor = 0;
  const changed: KnowledgeReference[] = [];
  for (const ref of [...refs].sort((a, b) => a.start - b.start)) {
    result += content.slice(cursor, ref.start);
    const text = target(ref),
      start = result.length;
    result += text;
    changed.push({ ...ref, start, end: result.length, text });
    cursor = ref.end;
  }
  return { content: result + content.slice(cursor), refs: changed };
}
export function importKnowledgePackage(
  options: KnowledgeImportOptions,
  home?: string,
): Promise<KnowledgeImportResult> {
  return locked(home, () => importPackage(options, home));
}
async function importPackage(
  options: KnowledgeImportOptions,
  home?: string,
): Promise<KnowledgeImportResult> {
  const pending = tickets.get(options?.ticket);
  if (!pending || pending.home !== home)
    throw new Error("Package preview expired. Select the ZIP again.");
  const { manifest, files } = unpack(pending.archive);
  if (!record(options.names) || !record(options.roots))
    throw new Error("Invalid import choices");
  const names = manifest.bundles.map((b) => options.names[b]);
  if (
    !names.every(cleanSegment) ||
    new Set(names.map((n) => n.toLowerCase())).size !== names.length
  )
    throw new Error("Choose distinct valid bundle names");
  const root = getKnowledgeDir(home);
  await mkdir(root, { recursive: true });
  for (const name of names) {
    await plainPath(root, join(root, name));
    try {
      await lstat(join(root, name));
      throw new Error(`Bundle ${name} already exists; choose another name`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const roots: Record<string, string | null> = {};
  for (const source of manifest.sources) {
    const path = options.roots[source.id] || null;
    if (
      path !== null &&
      (typeof path !== "string" ||
        !isAbsolute(path) ||
        !(await lstat(path)).isDirectory())
    )
      throw new Error("Select an existing source folder");
    roots[source.id] = path;
  }
  const state = await readPortableState(home),
    ids = new Map(manifest.sources.map((s) => [s.id, randomUUID()]));
  state.sources.push(
    ...manifest.sources.map((s) => ({
      ...s,
      id: ids.get(s.id)!,
      root: roots[s.id],
    })),
  );
  const mapKey = (key: string): string => {
    const [bundle, ...rest] = key.split("/");
    return [options.names[bundle] || bundle, ...rest].join("/");
  };
  const importedSettings = mapSettings(
    manifest.settings,
    (id) => ids.get(id)!,
    mapKey,
  );
  state.settings = {
    folders: [
      ...new Set([
        ...(state.settings?.folders || []),
        ...importedSettings.folders,
      ]),
    ],
    fileFolders: {
      ...state.settings?.fileFolders,
      ...importedSettings.fileFolders,
    },
    folderState: {
      ...state.settings?.folderState,
      ...importedSettings.folderState,
    },
    disabledBundles: {
      ...state.settings?.disabledBundles,
      ...importedSettings.disabledBundles,
    },
  };
  const staged = join(root, `.import-${randomUUID()}`),
    created: string[] = [];
  await mkdir(staged);
  try {
    for (const name of names) await mkdir(join(staged, name));
    for (const [name, data] of Object.entries(files)) {
      if (name === "manifest.json") continue;
      const key = name.slice(6),
        destination = mapKey(key),
        refs = manifest.references[key] || [];
      if (!refs.length) {
        await writeFile(join(staged, destination), data);
        continue;
      }
      const moved = relocate(Buffer.from(data).toString("utf8"), refs, (ref) =>
        ref.target.kind === "bundle"
          ? join(root, mapKey(ref.target.path))
          : roots[ref.target.source]
            ? join(roots[ref.target.source]!, ref.target.path)
            : `knowledge-source:${ids.get(ref.target.source)}/${ref.target.path}`,
      );
      state.references[destination] = moved.refs.map((ref) => ({
        ...ref,
        target:
          ref.target.kind === "bundle"
            ? { ...ref.target, path: mapKey(ref.target.path) }
            : { ...ref.target, source: ids.get(ref.target.source)! },
      }));
      await writeFile(join(staged, destination), moved.content);
    }
    for (const name of names) {
      const destination = join(root, name);
      await mkdir(destination);
      created.push(destination);
      for (const file of await readdir(join(staged, name)))
        await rename(join(staged, name, file), join(destination, file));
    }
    await saveState(state, home);
    created.length = 0;
    tickets.delete(options.ticket);
    return {
      bundles: names,
      settings: mapSettings(manifest.settings, (id) => roots[id], mapKey),
    };
  } catch (error) {
    for (const path of created)
      await rm(path, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
}
export function locateKnowledgeSource(
  id: string,
  path: string,
  home?: string,
): Promise<KnowledgeSourceSettings> {
  return locked(home, () => locateSource(id, path, home));
}
async function locateSource(
  id: string,
  path: string,
  home?: string,
): Promise<KnowledgeSourceSettings> {
  if (
    typeof id !== "string" ||
    typeof path !== "string" ||
    !isAbsolute(path) ||
    !(await lstat(path)).isDirectory()
  )
    throw new Error("Select a source folder");
  const state = await readPortableState(home),
    source = state.sources.find((s) => s.id === id);
  if (!source) throw new Error("Unknown source");
  const root = getKnowledgeDir(home);
  const changes: { path: string; before: string; after: string }[] = [];
  for (const [key, refs] of Object.entries(state.references)) {
    if (!refs.some((r) => r.target.kind === "source" && r.target.source === id))
      continue;
    const file = join(root, key);
    if (!safePath(key)) throw new Error("Invalid stored reference");
    await plainPath(root, file);
    const before = await readFile(file, "utf8");
    if (refs.some((r) => !validRef(r, before)))
      throw new Error(
        `References changed in ${key}; save registered references first`,
      );
    const moved = relocate(before, refs, (r) =>
      r.target.kind === "source" && r.target.source === id
        ? join(path, r.target.path)
        : r.text,
    );
    changes.push({ path: file, before, after: moved.content });
    state.references[key] = moved.refs;
  }
  try {
    for (const change of changes) await writeFile(change.path, change.after);
    source.root = path;
    await saveState(state, home);
  } catch (error) {
    for (const change of changes) await writeFile(change.path, change.before);
    throw error;
  }
  return mapSettings(
    state.settings || {
      folders: [],
      fileFolders: {},
      folderState: {},
      disabledBundles: {},
    },
    (id) => state.sources.find((s) => s.id === id)?.root || null,
    (key) => key,
  );
}
