import { execFile } from "node:child_process";
import { homedir } from "node:os";
import type { GitHubAuthStatus } from "../shared/github-auth";

const validAccount = (value: unknown): value is string => typeof value === "string" && /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value);
const sameAccount = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

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
    const listed = await run(["credential-manager", "github", "list", "--url", "https://github.com"], signal);
    if (listed.ok) result.accounts = [...new Set(listed.out.trim().split(/\r?\n/).filter(validAccount))];
    const pinned = await run(["config", "--get-urlmatch", "credential.username", "https://github.com"], signal);
    const username = pinned.out.trim();
    if (!pinned.ok || !validAccount(username)) return result;
    result.selectedAccount = username;
    return this.verify(result, username, signal);
  }

  private async verify(result: GitHubAuthStatus, username: string, signal?: AbortSignal): Promise<GitHubAuthStatus> {
    // Force the native helper and requested account; never accept an arbitrary first credential.
    const credential = await run(["-c", "credential.helper=", "-c", "credential.helper=manager", "credential", "fill"], signal, `protocol=https\nhost=github.com\nusername=${username}\n\n`);
    const account = credential.out.split(/\r?\n/).find((line) => line.startsWith("username="))?.slice(9);
    if (!account || !sameAccount(account, username)) return result;
    if (!credential.ok) return result;
    const password = credential.out.split(/\r?\n/).find((line) => line.startsWith("password="))?.slice(9);
    if (!password) return result;
    try {
      const response = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${password}`, Accept: "application/vnd.github+json", "User-Agent": "Hermes-One" }, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
      if (response.status === 401) return { ...result, auth: "unauthenticated" };
      if (!response.ok) return result;
      const user = await response.json() as { login?: unknown };
      if (!validAccount(user.login) || !sameAccount(user.login, username)) return result;
      return { ...result, auth: "authenticated", account: user.login };
    } catch { return result; }
  }

  async selectAccount(username: unknown): Promise<GitHubAuthStatus> {
    return this.change(false, username);
  }

  async signIn(): Promise<GitHubAuthStatus> {
    return this.change(true);
  }

  /**
   * Remove ONE stored account from the native credential manager.
   *
   * `account` is required on purpose: the renderer must name the account the
   * user confirmed. Silently unlinking "whichever account is pinned" would
   * delete the wrong credential on a machine with several accounts. When the
   * removed account is the pinned one (or it was the last), the global HTTPS
   * username pin is cleared so Git stops demanding a credential that is gone.
   */
  async disconnect(username: unknown): Promise<GitHubAuthStatus> {
    if (this.active) return { git: true, manager: true, helper: false, auth: "unknown", error: "busy" };
    const controller = new AbortController();
    this.active = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    try {
      const before = await this.status(controller.signal);
      if (!before.manager) return { ...before, error: "unavailable" };
      if (!validAccount(username)) return { ...before, error: "failed" };
      if (!before.accounts?.some((account) => sameAccount(account, username))) return { ...before, error: "failed" };
      const removed = await run(
        ["credential-manager", "github", "logout", username as string, "--url", "https://github.com", "--no-ui"],
        controller.signal,
      );
      if (controller.signal.aborted) return { ...before, error: timedOut ? "timeout" : "cancelled" };
      if (!removed.ok) return { ...before, error: "failed" };
      const remaining = (before.accounts ?? []).filter((account) => !sameAccount(account, username));
      // Only drop the pin when it names the account we just removed; another
      // pinned account must keep working untouched.
      if (before.selectedAccount && sameAccount(before.selectedAccount, username)) {
        const cleared = await run(
          ["config", "--global", "--unset-all", "credential.https://github.com.username"],
          controller.signal,
        );
        // `--unset-all` exits non-zero when the key is absent; that is not a failure.
        if (controller.signal.aborted) return { ...before, error: timedOut ? "timeout" : "cancelled" };
        if (!cleared.ok && remaining.length === 0) return { ...before, error: "failed" };
      }
      const after = await this.status(controller.signal);
      if (controller.signal.aborted) return { ...before, error: timedOut ? "timeout" : "cancelled" };
      return after;
    } finally { clearTimeout(timeout); this.active = undefined; }
  }

  private async change(loginRequested: boolean, username?: unknown): Promise<GitHubAuthStatus> {
    if (this.active) return { git: true, manager: true, helper: false, auth: "unknown", error: "busy" };
    const controller = new AbortController();
    this.active = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 210_000);
    try {
      const before = await this.status(controller.signal);
      if (!before.manager) return { ...before, error: "unavailable" };
      if (loginRequested) {
        const login = await run(["credential-manager", "github", "login", "--url", "https://github.com", "--browser"], controller.signal, undefined, true);
        if (!login.ok || controller.signal.aborted) return { ...before, error: timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "failed" };
        const after = await this.status(controller.signal);
        if (controller.signal.aborted) return { ...before, error: timedOut ? "timeout" : "cancelled" };
        if (!before.accounts || !after.accounts) return { ...after, error: "selectAccount" };
        const added = after.accounts?.filter((account) => !before.accounts?.some((old) => sameAccount(old, account))) ?? [];
        // GCM login emits no identity. Existing-account reauth must be explicitly selected, never guessed.
        if (added.length !== 1) return { ...after, error: "selectAccount" };
        username = added[0];
      } else if (!validAccount(username) || !before.accounts?.some((account) => sameAccount(account, username as string))) {
        return { ...before, error: "failed" };
      }
      if (!validAccount(username)) return { ...before, error: "failed" };
      const verified = await this.verify({ ...before, auth: "unknown", account: undefined }, username, controller.signal);
      if (controller.signal.aborted) return { ...before, error: timedOut ? "timeout" : "cancelled" };
      if (verified.auth !== "authenticated") return { ...before, error: "failed" };
      // User-clicked, current OS user's GitHub HTTPS default; repository/URL users may override.
      for (const args of [
        ["config", "--global", "--replace-all", "credential.https://github.com.helper", ""],
        ["config", "--global", "--add", "credential.https://github.com.helper", "manager"],
        ["config", "--global", "--replace-all", "credential.https://github.com.username", verified.account!],
      ]) {
        if (controller.signal.aborted || !(await run(args, controller.signal)).ok) return { ...before, error: timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "failed" };
      }
      const after = await this.status(controller.signal);
      return after.auth === "authenticated" && after.selectedAccount && sameAccount(after.selectedAccount, username) ? after : { ...after, error: "failed" };
    } finally { clearTimeout(timeout); this.active = undefined; }
  }
}
