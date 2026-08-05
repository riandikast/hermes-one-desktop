// @vitest-environment node

import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractHostFromRemoteUrl,
  gitTokenAuthArgs,
  loadGitTokens,
  saveGitTokens,
  type TokenCipher,
} from "./git-credentials";

const fakeCipher: TokenCipher = {
  encrypt: (plain: string) => Buffer.from(plain, "utf8").toString("base64"),
  decrypt: (encrypted: string) =>
    Buffer.from(encrypted, "base64").toString("utf8"),
};

describe("git token credentials", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hermes-git-token-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("extracts hosts from https and ssh remote urls", () => {
    expect(extractHostFromRemoteUrl("https://github.com/org/repo.git")).toBe(
      "github.com",
    );
    expect(
      extractHostFromRemoteUrl("https://gitlab.example.com/group/proj.git"),
    ).toBe("gitlab.example.com");
    expect(extractHostFromRemoteUrl("git@github.com:org/repo.git")).toBe(
      "github.com",
    );
    expect(extractHostFromRemoteUrl("")).toBeNull();
    expect(extractHostFromRemoteUrl("not a url")).toBeNull();
  });

  it("builds bearer-token auth args only when a token exists", () => {
    expect(gitTokenAuthArgs("github.com", null)).toEqual([]);
    expect(gitTokenAuthArgs(null, "abc")).toEqual([]);
    expect(gitTokenAuthArgs("github.com", "ghp_123")).toEqual([
      "-c",
      "http.https://github.com/.extraHeader=Authorization: Bearer ghp_123",
    ]);
  });

  it("round-trips tokens through the encrypted store", async () => {
    const file = join(dir, "git-tokens.json");
    const tokens = new Map<string, string>([
      ["github.com", "ghp_abc"],
      ["gitlab.com", "glpat_xyz"],
    ]);
    await saveGitTokens(file, tokens, fakeCipher);

    // On disk values are cipher-encrypted, not plaintext.
    const raw = await readFile(file, "utf8");
    expect(raw).toContain(Buffer.from("ghp_abc", "utf8").toString("base64"));
    expect(raw).not.toContain("ghp_abc");

    const loaded = await loadGitTokens(file, fakeCipher);
    expect(loaded.get("github.com")).toBe("ghp_abc");
    expect(loaded.get("gitlab.com")).toBe("glpat_xyz");
  });

  it("returns an empty map for a missing store file", async () => {
    const loaded = await loadGitTokens(join(dir, "nope.json"), fakeCipher);
    expect(loaded.size).toBe(0);
  });
});
