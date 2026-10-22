import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The release workflow computes the next version as
 * `max(package.json patch, highest published tag patch) + 1`.
 *
 * Running the real YAML needs Actions, so this mirrors the exact shell logic
 * and pins the properties that matter: the number always increases by one, a
 * stale package.json (the bug where About showed 0.7.4 while releases were at
 * 0.7.13) can never win, and a fresh repo starts at patch 1 rather than
 * reusing an existing tag.
 */
function withRepo<T>(pkgVersion: string, tags: string[], run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "bump-test-"));
  try {
    const git = (...args: string[]): string =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true });
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: pkgVersion }));
    // Tags need a commit to point at.
    git("add", "package.json");
    git("commit", "-qm", "init");
    for (const tag of tags) git("tag", tag);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Same shell pipeline as the workflow's "Compute next version" step. */
function nextVersion(pkgVersion: string, tags: string[]): string {
  return withRepo(pkgVersion, tags, (dir) => {
    const script = `
      set -euo pipefail
      BASE=$(node -p 'require("./package.json").version.split(".").slice(0,2).join(".")')
      PKG_PATCH=$(node -p 'parseInt(require("./package.json").version.split(".")[2].replace(/[^0-9].*$/,""),10)||0')
      TAG_PATCH=$(git tag --list "custom-v\${BASE}.*" \\
        | sed -E "s|^custom-v\${BASE//./\\\\.}\\.([0-9]+)$|\\1|" \\
        | grep -E '^[0-9]+$' | sort -n | tail -1 || true)
      TAG_PATCH=\${TAG_PATCH:-0}
      HIGHEST=$(( PKG_PATCH > TAG_PATCH ? PKG_PATCH : TAG_PATCH ))
      echo "\${BASE}.$(( HIGHEST + 1 ))"
    `;
    return execFileSync("bash", ["-c", script], { cwd: dir, encoding: "utf8", windowsHide: true }).trim();
  });
}

describe("custom release version bump", () => {
  it("increments past a stale package.json using the highest published tag", () => {
    // The reported symptom: package.json 0.7.4, releases up to 0.7.13.
    expect(nextVersion("0.7.4", ["custom-v0.7.9", "custom-v0.7.13"])).toBe("0.7.14");
  });

  it("uses package.json when it is already ahead of every tag", () => {
    expect(nextVersion("0.7.20", ["custom-v0.7.13"])).toBe("0.7.21");
  });

  it("starts at patch 1 when no tag exists yet", () => {
    expect(nextVersion("0.7.0", [])).toBe("0.7.1");
  });

  it("ignores tags from other branches and other majors", () => {
    expect(nextVersion("0.7.4", ["v0.8.9", "custom-v0.6.99", "beta-v0.7.50"])).toBe("0.7.5");
  });

  it("always produces a version newer than every tag, so no tag is reused", () => {
    const tags = ["custom-v0.7.1", "custom-v0.7.2", "custom-v0.7.10"];
    const next = nextVersion("0.7.2", tags);
    expect(tags).not.toContain(`custom-v${next}`);
    expect(next).toBe("0.7.11");
  });
});

/**
 * The write-back step must leave package.json exactly at the released version,
 * which is what Settings → About & Updates reads via app.getVersion().
 *
 * `set-version.mjs` resolves package.json relative to its OWN location, so the
 * script is copied into the fixture repo. Running the real one from here would
 * rewrite THIS repository's package.json.
 */
describe("set-version script", () => {
  const installScript = (dir: string): string => {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    const script = join(dir, "scripts", "set-version.mjs");
    copyFileSync(join(process.cwd(), "scripts", "set-version.mjs"), script);
    return script;
  };

  it("writes the exact version and is idempotent", () => {
    withRepo("0.7.4", [], (dir) => {
      const script = installScript(dir);
      const pkgPath = join(dir, "package.json");
      const bump = (version: string): void => {
        execFileSync(process.execPath, [script, version], { cwd: dir, encoding: "utf8", windowsHide: true });
      };
      bump("0.7.14");
      expect(JSON.parse(readFileSync(pkgPath, "utf8")).version).toBe("0.7.14");
      bump("0.7.14");
      expect(JSON.parse(readFileSync(pkgPath, "utf8")).version).toBe("0.7.14");
    });
  });

  it("also mirrors the version into package-lock.json", () => {
    withRepo("0.7.4", [], (dir) => {
      const script = installScript(dir);
      writeFileSync(
        join(dir, "package-lock.json"),
        JSON.stringify({ name: "x", version: "0.7.4", lockfileVersion: 3, packages: { "": { name: "x", version: "0.7.4" } } }, null, 2) + "\n",
      );
      execFileSync(process.execPath, [script, "0.7.15"], { cwd: dir, encoding: "utf8", windowsHide: true });
      const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
      // A stale lock version makes the tree disagree with the app version.
      expect(lock.version).toBe("0.7.15");
      expect(lock.packages[""].version).toBe("0.7.15");
    });
  });

  it("refuses a malformed version instead of corrupting package.json", () => {
    withRepo("0.7.4", [], (dir) => {
      const script = installScript(dir);
      const pkgPath = join(dir, "package.json");
      expect(() =>
        execFileSync(process.execPath, [script, "not-a-version"], {
          cwd: dir, encoding: "utf8", windowsHide: true, stdio: "pipe",
        }),
      ).toThrow();
      expect(JSON.parse(readFileSync(pkgPath, "utf8")).version).toBe("0.7.4");
    });
  });
});
