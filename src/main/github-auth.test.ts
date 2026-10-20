// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile }));
import { GitHubAuth } from "./github-auth";
const secret = "test-secret-never-returned";
let calls: string[][];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ login: "octocat" }) }));
  execFile.mockImplementation((_file, args, options, callback) => {
    calls.push(args);
    const out = args.includes("fill") ? `username=octocat\npassword=${secret}\n` : args.includes("--get-urlmatch") ? "manager\n" : "version";
    queueMicrotask(() => callback(null, out));
    expect(options.env.GIT_TERMINAL_PROMPT).toBe("0");
    return { stdin: { end: vi.fn() } };
  });
});
describe("native GitHub auth", () => {
  it("cancels an in-flight login and rejects duplicate sign-ins", async () => {
    const original = execFile.getMockImplementation()!;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    execFile.mockImplementation((file, args, opts, cb) => {
      if (!args.includes("login")) return original(file, args, opts, cb);
      opts.signal.addEventListener("abort", () => cb(new Error("aborted"), ""), { once: true });
      started();
      return { stdin: { end: vi.fn() } };
    });
    const service = new GitHubAuth();
    const pending = service.signIn();
    await ready;
    expect((await service.signIn()).error).toBe("busy");
    service.cancel();
    expect((await pending).error).toBe("cancelled");
    expect(calls.some((args) => args.includes("--global"))).toBe(false);
  });
  it("verifies identity without exposing credential or starting login/configuration", async () => {
    const status = await new GitHubAuth().status();
    expect(status).toEqual({ git: true, manager: true, helper: true, auth: "authenticated", account: "octocat" });
    expect(JSON.stringify(status)).not.toContain(secret);
    expect(calls.some((a) => a.includes("login") || a.includes("--global"))).toBe(false);
    expect(calls.find((a) => a.includes("fill"))).toEqual(["-c", "credential.helper=", "-c", "credential.helper=manager", "credential", "fill"]);
    expect(fetch).toHaveBeenCalledWith("https://api.github.com/user", expect.objectContaining({ redirect: "error" }));
  });
  it("does not mistake helper configuration for authentication", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);
    expect((await new GitHubAuth().status()).auth).toBe("unauthenticated");
    vi.mocked(fetch).mockRejectedValue(new Error(secret));
    expect((await new GitHubAuth().status()).auth).toBe("unknown");
  });
  it("uses fixed native browser command then GitHub-scoped helper configuration", async () => {
    const result = await new GitHubAuth().signIn();
    expect(result.auth).toBe("authenticated");
    expect(calls).toContainEqual(["credential-manager", "github", "login", "--url", "https://github.com", "--browser"]);
    expect(calls).toContainEqual(["config", "--global", "--add", "credential.https://github.com.helper", "manager"]);
  });
  it("does not configure credentials after failed login and sanitizes errors", async () => {
    const original = execFile.getMockImplementation()!;
    execFile.mockImplementation((file, args, opts, cb) => args.includes("login") ? (queueMicrotask(() => cb(new Error(secret), secret)), { stdin: { end: vi.fn() } }) : original(file, args, opts, cb));
    const result = await new GitHubAuth().signIn();
    expect(result.error).toBe("failed");
    expect(calls.some((a) => a.includes("--global"))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
