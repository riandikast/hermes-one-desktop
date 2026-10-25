import { execFile } from "child_process";

import { BACKEND_SOURCE_URL, type BackendUpdateStatus } from "../shared/backend-update";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";


const API = "https://api.github.com/repos/NousResearch/hermes-agent";

class MetadataError extends Error {
  constructor(readonly status: number, path: string) {
    super(`Official repository check failed at ${path || "/"} (HTTP ${status})`);
  }
}

async function metadata(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // GitHub uses 422 (not 404) for a syntactically valid unpublished SHA.
    if (response.status === 422 && path.startsWith("/commits/")) {
      const body = await response.json() as { message?: unknown };
      if (body.message === `No commit found for SHA: ${path.slice(9)}`) throw new MetadataError(404, path);
    }
    throw new MetadataError(response.status, path);
  }
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
  let installed: string | undefined, latest: string | undefined, branch: string | undefined;
  try {
    installed = await backendGit(repo, ["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!/^[a-f0-9]{40}$/.test(installed)) throw new Error("Installed backend commit is unknown");
    const info = await metadata("");
    if (typeof info.default_branch !== "string" || !info.default_branch) throw new Error("Official default branch is unknown");
    branch = info.default_branch;
    const commit = await metadata(`/commits/${encodeURIComponent(branch)}`);
    if (typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error("Official commit is unknown");
    latest = commit.sha;
    let status: BackendUpdateStatus["status"] = "current";
    if (installed !== latest) {
      // Compare immutable SHAs, not a stale origin/<branch> ref or version banner.
      let comparison: Record<string, unknown>;
      try {
        comparison = await metadata(`/compare/${latest}...${installed}`);
      } catch (error) {
        if (!(error instanceof MetadataError) || error.status !== 404) throw error;
        // A compare 404 alone does not prove a custom commit: probe that SHA.
        try {
          await metadata(`/commits/${installed}`);
        } catch (commitError) {
          if (!(commitError instanceof MetadataError) || commitError.status !== 404) throw commitError;
          // Bounded, read-only first-parent walk: local commits need not exist on GitHub.
          const ancestors = (await backendGit(repo, ["rev-list", "--first-parent", "--max-count=21", installed])).split(/\r?\n/).slice(1);
          for (const ancestor of ancestors) {
            if (!/^[a-f0-9]{40}$/.test(ancestor)) throw new Error("Invalid local ancestor commit");
            try {
              const published = await metadata(`/commits/${ancestor}`);
              if (published.sha !== ancestor) throw new Error("Published ancestor metadata is invalid");
            } catch (ancestorError) {
              if (ancestorError instanceof MetadataError && ancestorError.status === 404) continue;
              throw ancestorError;
            }
            const base = ancestor === latest ? "identical" : (await metadata(`/compare/${latest}...${ancestor}`)).status;
            const relationships = { identical: "Published base matches official HEAD", behind: "Official updates available beyond published base",
              ahead: "Published base is ahead of official HEAD", diverged: "Published base and official history diverged" };
            if (!Object.hasOwn(relationships, String(base))) throw new Error("Published base relationship is unknown");
            return { status: "diverged", installed, latest, branch,
              detail: `Custom/local commits above published base ${ancestor.slice(0, 10)}. ${relationships[base as keyof typeof relationships]}; review and update manually from ${BACKEND_SOURCE_URL}. Installed ${installed.slice(0, 10)} / official ${latest.slice(0, 10)} (${branch}).` };
          }
          return { status: "unknown", installed, latest, branch,
            detail: `Installed commit is not published in the official repository (custom/local). No published base found within 20 first-parent ancestors; review and update manually from ${BACKEND_SOURCE_URL}. Installed ${installed.slice(0, 10)} / official ${latest.slice(0, 10)} (${branch}).` };
        }
        throw error;
      }
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
    return { status: "unknown", ...(installed ? { installed } : {}), ...(latest ? { latest } : {}), ...(branch ? { branch } : {}),
      detail: `Update check failed: ${error instanceof Error ? error.message : String(error)}${latest ? ` · Installed ${installed?.slice(0, 10)} / official ${latest.slice(0, 10)} (${branch}); review manually.` : ""}` };
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
