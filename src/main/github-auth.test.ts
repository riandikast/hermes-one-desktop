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
    const out = args.includes("fill") ? `username=octocat\npassword=${secret}\n` : args.includes("list") ? "octocat\n" : args.includes("credential.username") ? "octocat\n" : args.includes("--get-urlmatch") ? "manager\n" : "version";
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
    expect(status).toMatchObject({ git: true, manager: true, helper: true, auth: "authenticated", account: "octocat", selectedAccount: "octocat", accounts: ["octocat"] });
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
  it("uses fixed native browser command without guessing an existing account", async () => {
    const result = await new GitHubAuth().signIn();
    expect(result.auth).toBe("authenticated");
    expect(calls).toContainEqual(["credential-manager", "github", "login", "--url", "https://github.com", "--browser"]);
    expect(result.error).toBe("selectAccount");
    expect(calls.some((a) => a.includes("--global"))).toBe(false);
  });
  it("does not configure credentials after failed login and sanitizes errors", async () => {
    const original = execFile.getMockImplementation()!;
    execFile.mockImplementation((file, args, opts, cb) => args.includes("login") ? (queueMicrotask(() => cb(new Error(secret), secret)), { stdin: { end: vi.fn() } }) : original(file, args, opts, cb));
    const result = await new GitHubAuth().signIn();
    expect(result.error).toBe("failed");
    expect(calls.some((a) => a.includes("--global"))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("removes only the requested account and clears its pin", async () => {
    const result = await new GitHubAuth().disconnect("octocat");
    // Native removal targets the named account against the GitHub host only.
    expect(calls).toContainEqual([
      "credential-manager", "github", "logout", "octocat", "--url", "https://github.com", "--no-ui",
    ]);
    expect(calls).toContainEqual(["config", "--global", "--unset-all", "credential.https://github.com.username"]);
    expect(result.error).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("refuses to disconnect an account that is not signed in", async () => {
    const result = await new GitHubAuth().disconnect("someone-else");
    expect(result.error).toBe("failed");
    expect(calls.some((a) => a.includes("logout"))).toBe(false);
    // Never touch global config when nothing was removed.
    expect(calls.some((a) => a.includes("--unset-all"))).toBe(false);
  });
  it("rejects a malformed account name instead of passing it to Git", async () => {
    for (const bad of ["--help", "", "a b", "x;rm -rf /", null]) {
      const result = await new GitHubAuth().disconnect(bad);
      expect(result.error).toBe("failed");
    }
    expect(calls.some((a) => a.includes("logout"))).toBe(false);
  });
  it("reports a failed native removal without claiming the account is gone", async () => {
    const original = execFile.getMockImplementation()!;
    execFile.mockImplementation((file, args, opts, cb) =>
      args.includes("logout")
        ? (queueMicrotask(() => cb(new Error(secret), "")), { stdin: { end: vi.fn() } })
        : original(file, args, opts, cb));
    const result = await new GitHubAuth().disconnect("octocat");
    expect(result.error).toBe("failed");
    // The pin must survive a failed removal, or Git loses its account for nothing.
    expect(calls.some((a) => a.includes("--unset-all"))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("stores a token in the native store and reads the account from it", async () => {
    const token = "ghp_" + "a".repeat(36);
    // The store call must receive the token on stdin, keyed to the resolved account.
    const stdin: string[] = [];
    const original = execFile.getMockImplementation()!;
    execFile.mockImplementation((file, args, opts, cb) => {
      const built = original(file, args, opts, cb);
      if (args.includes("store")) {
        return { stdin: { end: (data?: string) => { stdin.push(data ?? ""); } } };
      }
      return built;
    });
    const result = await new GitHubAuth().signInWithToken(token);
    expect(result.error).toBeUndefined();
    expect(result.auth).toBe("authenticated");
    // Username comes from the API identity, never from whatever the user typed.
    expect(stdin[0]).toBe(`protocol=https\nhost=github.com\nusername=octocat\npassword=${token}\n\n`);
    expect(calls).toContainEqual(["credential-manager", "store"]);
    // Identity is resolved with the token as a Bearer credential.
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/user",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${token}` }) }),
    );
    expect(calls.some((a) => a.includes("login"))).toBe(false);
    // Nothing secret may be returned to the renderer.
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("ghp_");
  });
  it("rejects a token GitHub refuses without storing anything", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);
    const result = await new GitHubAuth().signInWithToken("ghp_" + "b".repeat(36));
    expect(result.error).toBe("invalidToken");
    expect(calls.some((a) => a.includes("store"))).toBe(false);
    expect(calls.some((a) => a.includes("--global"))).toBe(false);
  });
  it("rejects malformed tokens before any process or network call", async () => {
    for (const bad of ["", "   ", "abc", "has spaces ghp_x", "line1\nline2", "x".repeat(300), null, 42]) {
      const result = await new GitHubAuth().signInWithToken(bad);
      expect(result.error).toBe("invalidToken");
    }
    expect(calls.some((a) => a.includes("store"))).toBe(false);
    // No request was even attempted with a malformed value.
    expect(fetch).not.toHaveBeenCalled();
  });
});
