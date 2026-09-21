import { describe, expect, it } from "vitest";
import {
  applyCompletion,
  buildInsertion,
  matchDirectories,
  parseCompletionContext,
  quotePath,
  replacementKeystrokes,
  resolveListingDir,
  type DirEntry,
} from "./terminalComplete";

const ENTRIES: DirEntry[] = [
  { name: "src", isDirectory: true },
  { name: "scripts", isDirectory: true },
  { name: "README.md", isDirectory: false },
  { name: ".git", isDirectory: true },
  { name: ".config", isDirectory: true },
  { name: "node_modules", isDirectory: true },
];

describe("parseCompletionContext", () => {
  it("recognises a bare cd", () => {
    const ctx = parseCompletionContext("cd sr");
    expect(ctx).not.toBeNull();
    expect(ctx!.command).toBe("cd");
    expect(ctx!.namePrefix).toBe("sr");
    expect(ctx!.dirPart).toBe("");
  });

  it("splits a path fragment into dir + name", () => {
    const ctx = parseCompletionContext("cd ../src/comp");
    expect(ctx!.dirPart).toBe("../src/");
    expect(ctx!.namePrefix).toBe("comp");
  });

  it("handles an absolute path", () => {
    const ctx = parseCompletionContext("cd /usr/lo");
    expect(ctx!.dirPart).toBe("/usr/");
    expect(ctx!.namePrefix).toBe("lo");
  });

  it("handles a Windows path", () => {
    const ctx = parseCompletionContext("cd C:\\Users\\ri");
    expect(ctx!.dirPart).toBe("C:\\Users\\");
    expect(ctx!.namePrefix).toBe("ri");
  });

  it("ignores non-directory commands", () => {
    expect(parseCompletionContext("echo hello")).toBeNull();
    expect(parseCompletionContext("git commit -m x")).toBeNull();
  });

  it("ignores a bare command with no argument yet", () => {
    // `cd` alone: the shell has no fragment to complete.
    expect(parseCompletionContext("cd")).toBeNull();
    expect(parseCompletionContext("cd ")).toBeNull();
  });

  it("ignores flags rather than treating them as paths", () => {
    expect(parseCompletionContext("ls -la")).toBeNull();
  });

  it("ignores shell expansions it cannot resolve", () => {
    expect(parseCompletionContext("cd ~/proj")).toBeNull();
    expect(parseCompletionContext("cd $HOME/src")).toBeNull();
  });

  it("tolerates leading whitespace", () => {
    expect(parseCompletionContext("   cd sr")!.namePrefix).toBe("sr");
  });

  it("completes the LAST token only", () => {
    // Caret tracking means the fragment is whatever was typed last.
    const ctx = parseCompletionContext("cd /tmp/foo bar");
    expect(ctx!.namePrefix).toBe("bar");
  });
});

describe("matchDirectories", () => {
  it("returns directories matching the prefix", () => {
    expect(matchDirectories(ENTRIES, "s").map((e) => e.name)).toEqual([
      "scripts",
      "src",
    ]);
  });

  it("never returns files", () => {
    // `cd README.md` fails; offering it would be a guaranteed error.
    expect(matchDirectories(ENTRIES, "READ")).toEqual([]);
  });

  it("hides dotfiles unless a dot was typed", () => {
    expect(matchDirectories(ENTRIES, "").map((e) => e.name)).not.toContain(".git");
    expect(matchDirectories(ENTRIES, ".").map((e) => e.name)).toEqual([
      ".config",
      ".git",
    ]);
  });

  it("matches case-insensitively", () => {
    expect(matchDirectories(ENTRIES, "SR").map((e) => e.name)).toEqual(["src"]);
  });

  it("returns everything for an empty prefix", () => {
    const names = matchDirectories(ENTRIES, "").map((e) => e.name);
    expect(names).toEqual(["node_modules", "scripts", "src"]);
  });

  it("is sorted so the dropdown order is stable", () => {
    const names = matchDirectories(ENTRIES, "").map((e) => e.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });
});

describe("resolveListingDir", () => {
  it("uses the cwd for a bare name", () => {
    expect(resolveListingDir("/home/me/proj", "")).toBe("/home/me/proj");
  });

  it("joins a relative directory onto the cwd", () => {
    expect(resolveListingDir("/home/me/proj", "src/")).toBe("/home/me/proj/src");
  });

  it("resolves a parent-relative fragment", () => {
    expect(resolveListingDir("/home/me/proj", "../")).toBe("/home/me/proj/..");
  });

  it("keeps an absolute POSIX path", () => {
    expect(resolveListingDir("/home/me", "/usr/")).toBe("/usr");
  });

  it("keeps an absolute Windows path", () => {
    expect(resolveListingDir("C:\\proj", "C:\\Users\\")).toBe("C:\\Users");
  });

  it("picks the separator style of the cwd", () => {
    expect(resolveListingDir("C:\\proj", "src/")).toBe("C:\\proj\\src");
    expect(resolveListingDir("/home/me", "src/")).toBe("/home/me/src");
  });

  it("handles a drive-root cwd without doubling separators", () => {
    expect(resolveListingDir("C:\\", "src/")).toBe("C:\\src");
  });
});

describe("buildInsertion and quoting", () => {
  it("appends a separator so drilling continues", () => {
    expect(buildInsertion("", "src")).toBe("src/");
    expect(buildInsertion("../", "src")).toBe("../src/");
  });

  it("leaves simple paths unquoted", () => {
    expect(quotePath("src/components")).toBe("src/components");
  });

  it("quotes paths containing spaces", () => {
    // Without quoting the shell would split the token into two arguments.
    expect(quotePath("my docs")).toBe('"my docs"');
  });

  it("escapes characters special inside double quotes", () => {
    expect(quotePath('a"b')).toBe('"a\\"b"');
    expect(quotePath("a$b")).toBe('"a\\$b"');
    expect(quotePath("a`b")).toBe('"a\\`b"');
    expect(quotePath("a\\b")).toBe('"a\\\\b"');
  });
});

describe("applyCompletion", () => {
  it("replaces the fragment with the completion", () => {
    expect(applyCompletion("cd sr", "src/")).toBe("cd src/");
  });

  it("keeps the directory part of the fragment", () => {
    expect(applyCompletion("cd ../li", "../lib/")).toBe("cd ../lib/");
  });

  it("quotes the inserted path when needed", () => {
    expect(applyCompletion("cd my", "my docs/")).toBe('cd "my docs/"');
  });

  it("preserves earlier flags", () => {
    expect(applyCompletion("ls -la sr", "src/")).toBe("ls -la src/");
  });
});

describe("replacementKeystrokes", () => {
  it("clears to line start before retyping", () => {
    // Ctrl-U discards the whole line, so the entire line must be resent —
    // sending only the fragment would delete the command word.
    expect(replacementKeystrokes("cd src/")).toBe("\u0015cd src/");
  });
});
