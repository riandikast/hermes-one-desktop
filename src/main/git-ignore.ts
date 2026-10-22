import { readFile, writeFile, lstat } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";
import { runGit, type GitActionResult } from "./git";

import type { GitIgnoreResult } from "../shared/git-ignore";
const digest = (text: string): string => createHash("sha256").update(text).digest("hex");
async function ignoreFile(dir: string): Promise<{ path: string; text: string }> {
  if (typeof dir !== "string" || !dir) throw new Error("Invalid repository");
  const root = await runGit(dir, ["rev-parse", "--show-toplevel"], 10_000);
  if (root.code !== 0) throw new Error("Not a working repository");
  const path = join(root.stdout.trim(), ".gitignore");
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) throw new Error(".gitignore must be a regular file under 256 KiB");
    return { path, text: await readFile(path, "utf8") };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { path, text: "" };
    throw err;
  }
}
function validatePath(path: string): void {
  if (typeof path !== "string" || !path || path.length > 4096 || /[\x00-\x1f\x7f\\:]/.test(path) || path.startsWith("/") || path.replace(/\/$/, "").split("/").some((part) => !part || part === "." || part === "..") || path === ".gitignore" || path.split("/").includes(".git")) throw new Error("Invalid repository-relative file path");
}
export async function gitIgnoreList(dir: string, offset = 0): Promise<GitIgnoreResult> {
  try {
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error("Invalid ignored-file offset");
    const { text } = await ignoreFile(dir);
    // Matching ignored directories stay collapsed: never recursively enumerate cache contents.
    const result = await runGit(dir, ["status", "--porcelain=v1", "--ignored=matching", "--untracked-files=normal", "-z"], 10_000);
    if (result.code !== 0) throw new Error(result.stderr || "Ignored files unavailable");
    const files = result.stdout.split("\0").filter((line) => line.startsWith("!! ")).map((line) => line.slice(3));
    return { ok: true, rules: text.split(/\r?\n/).flatMap((pattern, line) => pattern && !pattern.startsWith("#") ? [{ line, pattern }] : []), version: digest(text), files: files.slice(offset, offset + 100), hasMore: files.length > offset + 100 };
  } catch (err) { return { ok: false, rules: [], files: [], version: "", hasMore: false, error: String(err) }; }
}
// Serialize edits so two renderer clicks cannot overwrite each other's rules.
let editing = false;
export async function gitIgnoreEdit(dir: string, edit: { path: string } | { line: number; pattern: string; version: string }): Promise<GitActionResult> {
  if (editing) return { ok: false, error: "Ignore edit already in progress" };
  editing = true;
  try {
    const file = await ignoreFile(dir);
    let text = file.text;
    if ("path" in edit) {
      validatePath(edit.path);
      const root = await runGit(dir, ["rev-parse", "--show-toplevel"], 10_000);
      const tracked = await runGit(root.stdout.trim(), ["ls-files", "-z", "--", `:(literal)${edit.path}`], 10_000);
      if (tracked.code !== 0 || tracked.stdout) throw new Error("Tracked files cannot be ignored. No files were untracked.");
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      const pattern = "/" + edit.path.replace(/[\\!*?\[\]# ]/g, "\\$&");
      if (text.split(/\r?\n/).includes(pattern)) return { ok: true, output: "Already in .gitignore" };
      text += (text && !text.endsWith("\n") ? eol : "") + pattern + eol;
    } else {
      if (!Number.isInteger(edit.line) || edit.line < 0 || typeof edit.pattern !== "string" || /[\r\n\0]/.test(edit.pattern) || digest(text) !== edit.version) throw new Error("Ignore rules changed. Refresh before removing a rule.");
      const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
      if (lines[edit.line]?.replace(/\r?\n$/, "") !== edit.pattern || edit.pattern.startsWith("#")) throw new Error("Ignore rule no longer matches");
      lines.splice(edit.line, 1);
      text = lines.join("");
    }
    await writeFile(file.path, text, "utf8");
    return { ok: true, output: "Updated .gitignore only. Other rules may still ignore this path." };
  } catch (err) { return { ok: false, error: String(err) }; }
  finally { editing = false; }
}
