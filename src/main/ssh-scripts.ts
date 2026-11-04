/** Python payloads used by the SSH explorer. Kept dependency-free so the
 * exact scripts can be executed against a local temp folder in tests. */

export const PRELUDE = `import base64, json, os, shutil, sys
p = json.loads(sys.stdin.read() or "{}")
def emit(value):
    print(json.dumps(value))
def fail(message):
    emit({"ok": False, "error": str(message)})
    sys.exit(0)
def target(value):
    return os.path.abspath(os.path.expanduser(str(value or "~")))
def guarded(root, value):
    real_root = os.path.realpath(target(root))
    real_value = os.path.realpath(target(value))
    if real_value == real_root or not real_value.startswith(real_root + os.sep):
        fail("Path is outside the opened folder")
    return real_value
def guarded_dir(root, value):
    real_root = os.path.realpath(target(root))
    real_value = os.path.realpath(target(value))
    if real_value != real_root and not real_value.startswith(real_root + os.sep):
        fail("Path is outside the opened folder")
    return real_value
def entry_name(name):
    name = str(name or "")
    if not name or name in (".", "..") or "/" in name or "\\x00" in name:
        fail("Invalid name")
    return name
try:
`;

export const EPILOGUE = `
except Exception as exc:
    fail(exc)
`;

/**
 * Remote scripts are kept as named bodies so they can be syntax/behaviour
 * tested locally without an SSH host.
 */
export const SSH_SCRIPTS = {
  test: `emit({"ok": True, "home": os.path.expanduser("~")})`,
  list: `path = target(p.get("path"))
rows = []
for entry in os.scandir(path):
    rows.append({"name": entry.name, "isDirectory": entry.is_dir(follow_symlinks=True)})
rows.sort(key=lambda item: (not item["isDirectory"], item["name"].lower(), item["name"]))
emit({"ok": True, "entries": rows, "path": path})`,
  read: `path = target(p.get("path"))
limit = int(p.get("maxBytes") or 0)
with open(path, "rb") as handle:
    data = handle.read(limit + 1 if limit else -1)
truncated = bool(limit) and len(data) > limit
if truncated:
    data = data[:limit]
emit({"ok": True, "content": base64.b64encode(data).decode("ascii"), "truncated": truncated})`,
  write: `path = target(p.get("path"))
with open(path, "w", encoding="utf-8", newline="") as handle:
    handle.write(p.get("content") or "")
emit({"ok": True})`,
  create: `parent = guarded_dir(p.get("root"), p.get("parent"))
name = entry_name(p.get("name"))
target_path = os.path.join(parent, name)
if os.path.lexists(target_path):
    fail("A file or folder with that name already exists")
if p.get("kind") == "directory":
    os.mkdir(target_path)
else:
    handle = os.open(target_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    os.close(handle)
emit({"ok": True, "path": target_path})`,
  rename: `source = guarded(p.get("root"), p.get("path"))
name = entry_name(p.get("name"))
destination = os.path.join(os.path.dirname(source), name)
if os.path.lexists(destination):
    fail("A file or folder with that name already exists")
os.rename(source, destination)
emit({"ok": True, "path": destination})`,
  delete: `source = guarded(p.get("root"), p.get("path"))
if os.path.isdir(source) and not os.path.islink(source):
    shutil.rmtree(source)
else:
    os.remove(source)
emit({"ok": True})`,
  copy: `source = guarded(p.get("root"), p.get("source"))
destination_dir = guarded_dir(p.get("root"), p.get("destination"))
if os.path.isdir(source) and (destination_dir == source or destination_dir.startswith(source + os.sep)):
    fail("Cannot copy a folder into itself")
base = os.path.basename(source)
stem, extension = os.path.splitext(base)
def candidate(attempt):
    if attempt == 0:
        return base
    suffix = " copy" + ("" if attempt == 1 else " " + str(attempt))
    return base + suffix if os.path.isdir(source) else stem + suffix + extension
attempt = 0
copied = os.path.join(destination_dir, candidate(0))
while os.path.lexists(copied):
    attempt += 1
    copied = os.path.join(destination_dir, candidate(attempt))
if os.path.isdir(source):
    shutil.copytree(source, copied, symlinks=True)
else:
    shutil.copy2(source, copied)
emit({"ok": True, "path": copied})`,
} as const;

export type SshScriptKind = keyof typeof SSH_SCRIPTS;

/** The prelude opens a `try:` block, so every body line must be indented. */
export function wrapScript(body: string): string {
  const indented = body
    .split("\n")
    .map((line) => (line.trim() ? `    ${line}` : line))
    .join("\n");
  return `${PRELUDE}${indented}${EPILOGUE}`;
}

/** Full executable source for one operation (used by parity tests). */
export function sshScriptSource(kind: SshScriptKind): string {
  return wrapScript(SSH_SCRIPTS[kind]);
}
