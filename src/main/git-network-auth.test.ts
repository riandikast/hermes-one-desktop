// @vitest-environment node
import { execFileSync } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitFetch, gitPull, gitPush, setGitTokenProvider } from "./git";

describe("git network authentication", () => {
  let repo: string;
  let server: Server;
  let oldTrace: string | undefined;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "hermes-git-auth-"));
    execFileSync("git", ["init", "-q", repo]);
    server = createServer((_req, res) => { res.writeHead(404); res.end(); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No proxy address");
    execFileSync("git", ["-C", repo, "config", "http.proxy", `http://127.0.0.1:${address.port}`]);
    oldTrace = process.env.GIT_TRACE;
    process.env.GIT_TRACE = join(repo, "trace.log");
  });

  afterEach(async () => {
    setGitTokenProvider(null);
    if (oldTrace === undefined) delete process.env.GIT_TRACE;
    else process.env.GIT_TRACE = oldTrace;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it.each([
    ["fetch", gitFetch],
    ["pull", gitPull],
    ["push", gitPush],
  ])("leaves legacy GitHub tokens untouched and omits their header for %s", async (_name, action) => {
    execFileSync("git", ["-C", repo, "remote", "add", "origin", "http://GitHub.COM/example/repo.git"]);
    const tokens = new Map([["github.com", "legacy-secret"]]);
    const lookups: string[] = [];
    setGitTokenProvider((host) => { lookups.push(host); return tokens.get(host.toLowerCase()) ?? null; });
    await action(repo);
    const trace = await readFile(join(repo, "trace.log"), "utf8");
    expect(trace).not.toContain("legacy-secret");
    expect(trace).not.toContain("extraHeader");
    expect(lookups).toEqual([]);
    expect(tokens.get("github.com")).toBe("legacy-secret");
  });

  it("keeps non-GitHub host token arguments for real git fetch", async () => {
    execFileSync("git", ["-C", repo, "remote", "add", "origin", "http://gitlab.example/repo.git"]);
    const lookups: string[] = [];
    setGitTokenProvider((host) => { lookups.push(host); return host === "gitlab.example" ? "other-secret" : null; });
    await gitFetch(repo);
    expect(lookups).toEqual(["gitlab.example"]);
  });
});
