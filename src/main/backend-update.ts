import { execFile } from "child_process";

import { BACKEND_SOURCE_URL, type BackendUpdateStatus } from "../shared/backend-update";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";


const API = "https://api.github.com/repos/NousResearch/hermes-agent";

async function metadata(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Official repository check failed (HTTP ${response.status})`);
  return await response.json() as Record<string, unknown>;
}

export async function backendGit(repo: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["--no-optional-locks", "-C", repo, ...args], {
      timeout: 15_000, ...HIDDEN_SUBPROCESS_OPTIONS,
    }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  });
}

/** Read-only: neither fetch nor tracking refs touch the installed backend. */
export async function checkBackendUpdate(repo: string): Promise<BackendUpdateStatus> {
  try {
    const installed = await backendGit(repo, ["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!/^[a-f0-9]{40}$/.test(installed)) throw new Error("Installed backend commit is unknown");
    const info = await metadata("");
    const branch = info.default_branch;
    if (typeof branch !== "string" || !branch) throw new Error("Official default branch is unknown");
    const commit = await metadata(`/commits/${encodeURIComponent(branch)}`);
    const latest = commit.sha;
    if (typeof latest !== "string" || !/^[a-f0-9]{40}$/.test(latest)) throw new Error("Official commit is unknown");
    let status: BackendUpdateStatus["status"] = "current";
    if (installed !== latest) {
      // Compare immutable SHAs, not a stale origin/<branch> ref or version banner.
      const comparison = await metadata(`/compare/${latest}...${installed}`);
      const states = { behind: "available", ahead: "ahead", diverged: "diverged" } as const;
      if (!Object.hasOwn(states, String(comparison.status))) throw new Error("Commit relationship is unknown");
      status = states[comparison.status as keyof typeof states];
    }
    const labels = {
      current: "Matches official commit", available: "Official update available",
      ahead: "Local commits ahead of official", diverged: "Local and official history diverged",
      unknown: "Update status unknown",
    };
    return { status, installed, latest, branch,
      detail: `${labels[status]} · ${installed.slice(0, 10)} / ${latest.slice(0, 10)} (${branch})` };
  } catch (error) {
    return { status: "unknown", detail: `Update check failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The CLI updates its configured origin; never silently update a fork instead. */
export async function assertOfficialBackendUpdateTarget(repo: string): Promise<void> {
  const origin = await backendGit(repo, ["remote", "get-url", "origin"]);
  if (![BACKEND_SOURCE_URL, `${BACKEND_SOURCE_URL}.git`, "git@github.com:NousResearch/hermes-agent.git"].includes(origin)) {
    throw new Error(`Backend update requires an official origin (${BACKEND_SOURCE_URL}). Update this custom installation manually.`);
  }
  const status = await checkBackendUpdate(repo);
  const branch = await backendGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (status.status !== "available" || branch !== status.branch) {
    throw new Error("Automatic backend update requires the official default branch with a verified update. Review detached, custom or diverged installations manually.");
  }
}
