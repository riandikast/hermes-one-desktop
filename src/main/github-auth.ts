import { execFile } from "node:child_process";
import { homedir } from "node:os";
import type { GitHubAuthStatus } from "../shared/github-auth";

// No process output or exception text crosses IPC: credential protocols contain secrets.
function run(args: string[], signal?: AbortSignal, input?: string, interactive = false): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: interactive ? "always" : "never", GCM_CREDENTIAL_STORE: process.platform === "win32" ? "wincredman" : process.platform === "darwin" ? "keychain" : "secretservice" };
    for (const key of Object.keys(env)) {
      if (key.startsWith("GIT_TRACE") || key.startsWith("GCM_TRACE") || key === "GIT_CURL_VERBOSE") delete env[key];
    }
    const child = execFile("git", args, { cwd: homedir(), env, windowsHide: true, timeout: interactive ? 180_000 : 15_000, maxBuffer: 64 * 1024, signal }, (error, stdout) => resolve({ ok: !error, out: error ? "" : stdout }));
    child.stdin?.end(input);
  });
}

export class GitHubAuth {
  private active?: AbortController;

  cancel(): void { this.active?.abort(); }

  async status(signal?: AbortSignal): Promise<GitHubAuthStatus> {
    const git = (await run(["--version"], signal)).ok;
    const manager = git && (await run(["credential-manager", "--version"], signal)).ok;
    const configured = await run(["config", "--get-urlmatch", "credential.helper", "https://github.com"], signal);
    const helpers = configured.out.trim().split(/\r?\n/);
    const result: GitHubAuthStatus = { git, manager, helper: configured.ok && helpers.at(-1) === "manager", auth: "unknown" };
    if (!manager || signal?.aborted) return result;
    // Force the known native helper; never execute an arbitrary configured shell helper.
    const credential = await run(["-c", "credential.helper=", "-c", "credential.helper=manager", "credential", "fill"], signal, "protocol=https\nhost=github.com\n\n");
    if (!credential.ok) return result;
    const password = credential.out.split(/\r?\n/).find((line) => line.startsWith("password="))?.slice(9);
    if (!password) return result;
    try {
      const response = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${password}`, Accept: "application/vnd.github+json", "User-Agent": "Hermes-One" }, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
      if (response.status === 401) return { ...result, auth: "unauthenticated" };
      if (!response.ok) return result;
      const user = await response.json() as { login?: unknown };
      if (typeof user.login !== "string" || !/^[a-z\d-]{1,39}$/i.test(user.login)) return result;
      return { ...result, auth: "authenticated", account: user.login };
    } catch { return result; }
  }

  async signIn(): Promise<GitHubAuthStatus> {
    if (this.active) return { git: true, manager: true, helper: false, auth: "unknown", error: "busy" };
    const controller = new AbortController();
    this.active = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 210_000);
    try {
      const before = await this.status(controller.signal);
      if (!before.manager) return { ...before, error: "unavailable" };
      const login = await run(["credential-manager", "github", "login", "--url", "https://github.com", "--browser"], controller.signal, undefined, true);
      if (!login.ok || controller.signal.aborted) return { ...before, error: timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "failed" };
      // User-clicked, GitHub-only helper override. Other hosts and SSH stay untouched.
      for (const args of [
        ["config", "--global", "--replace-all", "credential.https://github.com.helper", ""],
        ["config", "--global", "--add", "credential.https://github.com.helper", "manager"],
      ]) {
        if (controller.signal.aborted || !(await run(args, controller.signal)).ok) return { ...before, error: "failed" };
      }
      return await this.status(controller.signal);
    } finally { clearTimeout(timeout); this.active = undefined; }
  }
}
