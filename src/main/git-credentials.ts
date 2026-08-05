import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";

/**
 * Token-based git auth for the Source Control dialog.
 *
 * A Personal Access Token (GitHub/GitLab PAT) lets a brand-new machine push
 * without the interactive Git Credential Manager flow: the dialog stores the
 * token per host, encrypted with Electron's safeStorage (DPAPI on Windows),
 * and network git ops send it as `Authorization: Bearer <token>` via a
 * per-URL `http.extraHeader` config override.
 */

export interface TokenCipher {
  encrypt: (plain: string) => string;
  decrypt: (encrypted: string) => string;
}

/** Extract the host from an https or ssh remote URL, or null. */
export function extractHostFromRemoteUrl(url: string): string | null {
  if (!url) return null;
  const https = url.match(/^https?:\/\/([^/:]+)/);
  if (https) return https[1];
  const ssh = url.match(/^[^@]+@([^:]+):/);
  if (ssh) return ssh[1];
  return null;
}

/** Read the encrypted token map from disk. Corrupt entries are skipped. */
export async function loadGitTokens(
  filePath: string,
  cipher: TokenCipher,
): Promise<Map<string, string>> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    const map = new Map<string, string>();
    for (const [host, encrypted] of Object.entries(parsed)) {
      try {
        map.set(host, cipher.decrypt(encrypted));
      } catch {
        /* skip corrupt entry */
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Persist the token map (encrypting each value). */
export async function saveGitTokens(
  filePath: string,
  tokens: Map<string, string>,
  cipher: TokenCipher,
): Promise<void> {
  const out: Record<string, string> = {};
  for (const [host, token] of tokens) out[host] = cipher.encrypt(token);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(out), "utf8");
}

/**
 * Git args that attach a bearer token to https requests for `host`.
 * Empty when there is nothing to attach. Applied as
 * `-c http.https://<host>/.extraHeader=Authorization: Bearer <token>`.
 */
export function gitTokenAuthArgs(
  host: string | null,
  token: string | null,
): string[] {
  if (!host || !token) return [];
  return [
    "-c",
    `http.https://${host}/.extraHeader=Authorization: Bearer ${token}`,
  ];
}
