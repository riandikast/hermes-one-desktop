// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile }));
import { GitHubAuth } from "./github-auth";
let pinned: string;
let accounts: string[];
let inputs: string[];
let writes: string[][];
let added: string;
let wrong: boolean;
beforeEach(() => {
  pinned = "second"; accounts = ["first", "second"]; inputs = []; writes = []; added = ""; wrong = false;
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, opts) => ({ ok: true, json: async () => ({ login: opts.headers.Authorization.endsWith("first") ? "first" : "second" }) })));
  execFile.mockImplementation((_file, args, _opts, cb) => {
    let input = "";
    queueMicrotask(() => {
      if (args.includes("--global")) { writes.push(args); if (args.includes("credential.https://github.com.username")) pinned = args.at(-1); }
      if (args.includes("login") && added) accounts.push(added);
      const account = wrong ? "first" : /username=(.*)/.exec(input)?.[1];
      cb(null, args.includes("fill") ? `username=${account}\npassword=mock-${account}\n` : args.includes("list") ? accounts.join("\n") : args.includes("credential.username") ? pinned : args.includes("--get-urlmatch") ? "manager" : "version");
    });
    return { stdin: { end: (value?: string) => { input = value || ""; if (value) inputs.push(value); } } };
  });
});
it("keeps the second account sticky across repeated status and new instances", async () => {
  for (let i = 0; i < 3; i++) expect((await new GitHubAuth().status()).account).toBe("second");
  expect(inputs).toHaveLength(3);
  expect(inputs.every((input) => input.includes("username=second\n"))).toBe(true);
  expect(writes).toEqual([]);
});
it("explicitly pins an existing account and reads it back", async () => {
  expect((await new GitHubAuth().selectAccount("first")).account).toBe("first");
  expect((await new GitHubAuth().status()).selectedAccount).toBe("first");
  expect(writes).toContainEqual(["config", "--global", "--replace-all", "credential.https://github.com.username", "first"]);
});
it("never asks for an unfiltered first credential", async () => {
  pinned = "";
  expect((await new GitHubAuth().status()).auth).toBe("unknown");
  expect(inputs).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
it("refuses mismatched identity and invalid selections without mutation", async () => {
  wrong = true;
  expect((await new GitHubAuth().selectAccount("second")).error).toBe("failed");
  expect(fetch).not.toHaveBeenCalled();
  for (const value of ["first\nhost=evil", "missing", {}, "--force"]) expect((await new GitHubAuth().selectAccount(value)).error).toBe("failed");
  expect(writes).toEqual([]);
});
it("rejects a token whose API identity differs from the requested account", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ login: "first" }) } as Response);
  expect((await new GitHubAuth().selectAccount("second")).error).toBe("failed");
  expect(writes).toEqual([]);
});
it("cancels selection before config mutation", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ login: "second" }) } as Response).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    started();
  }));
  const service = new GitHubAuth();
  const pending = service.selectAccount("first");
  await ready;
  service.cancel();
  expect((await pending).error).toBe("cancelled");
  expect(writes).toEqual([]);
  expect(pinned).toBe("second");
});
it("pins only the unambiguous newly added browser account", async () => {
  accounts = ["first"]; pinned = "first"; added = "second";
  const status = await new GitHubAuth().signIn();
  expect(status.account).toBe("second");
  expect(status.selectedAccount).toBe("second");
  expect(JSON.stringify(status)).not.toContain("mock-");
});
it("does not overwrite a pin after ambiguous existing-account browser login", async () => {
  expect((await new GitHubAuth().signIn()).error).toBe("selectAccount");
  expect(pinned).toBe("second");
  expect(writes).toEqual([]);
});
