/**
 * Explorer-side SSH: saved hosts plus file operations executed over the system
 * OpenSSH client. Reuses the app's SSH key/discovery conventions, but is
 * independent of the gateway connection mode, so a remote tree can be browsed
 * with no local folder attached.
 */
import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { app } from "electron";
import { dirname, join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { shellQuote } from "./ssh-remote";
import { sshScriptSource, type SshScriptKind } from "./ssh-scripts";
import type { ExplorerSshConnection } from "../shared/remote-path";

export type { ExplorerSshConnection };

export interface SshEntry {
  name: string;
  isDirectory: boolean;
}

export type SshOpResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

interface StoredConnections {
  connections: ExplorerSshConnection[];
}

function storePath(): string {
  const base = app?.getPath?.("userData") ?? join(homedir(), ".hermes-desktop");
  return join(base, "explorer-ssh-connections.json");
}

export function listExplorerSshConnections(): ExplorerSshConnection[] {
  try {
    const raw = readFileSync(storePath(), "utf-8");
    const parsed = JSON.parse(raw) as StoredConnections;
    return Array.isArray(parsed?.connections) ? parsed.connections : [];
  } catch {
    return [];
  }
}

function persist(connections: ExplorerSshConnection[]): void {
  const file = storePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ connections }, null, 2), "utf-8");
}

export function findExplorerSshConnection(
  id: string,
): ExplorerSshConnection | null {
  return (
    listExplorerSshConnections().find((connection) => connection.id === id) ??
    null
  );
}

export function saveExplorerSshConnection(
  input: Partial<ExplorerSshConnection>,
): SshOpResult<{ connection: ExplorerSshConnection }> {
  const host = String(input.host ?? "").trim();
  const username = String(input.username ?? "").trim();
  const port = Number(input.port) || 22;
  if (!host) return { ok: false, error: "Host is required" };
  if (/\s/.test(host))
    return { ok: false, error: "Host cannot contain spaces" };
  if (!username) return { ok: false, error: "Username is required" };
  if (port < 1 || port > 65535)
    return { ok: false, error: "Port must be between 1 and 65535" };
  const keyPath = String(input.keyPath ?? "").trim();
  if (keyPath && !existsSync(keyPath))
    return { ok: false, error: "SSH key file not found" };
  const existing = input.id
    ? findExplorerSshConnection(String(input.id))
    : null;
  const connection: ExplorerSshConnection = {
    id: existing?.id ?? randomUUID().slice(0, 8),
    label: String(input.label ?? "").trim() || `${username}@${host}`,
    host,
    port,
    username,
    keyPath,
    rootPath: String(input.rootPath ?? existing?.rootPath ?? "").trim(),
  };
  const connections = listExplorerSshConnections().filter(
    (item) => item.id !== connection.id,
  );
  connections.push(connection);
  persist(connections);
  return { ok: true, connection };
}

export function updateExplorerSshRoot(id: string, rootPath: string): void {
  const connections = listExplorerSshConnections();
  const index = connections.findIndex((item) => item.id === id);
  if (index === -1) return;
  connections[index] = { ...connections[index], rootPath };
  persist(connections);
}

export function deleteExplorerSshConnection(id: string): SshOpResult {
  const before = listExplorerSshConnections();
  const after = before.filter((item) => item.id !== id);
  if (after.length === before.length)
    return { ok: false, error: "Connection not found" };
  persist(after);
  return { ok: true };
}

// ── Exec ─────────────────────────────────────────────────────────────────────

function execSsh(
  connection: ExplorerSshConnection,
  command: string,
  stdin: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const args = [
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=12",
      "-o",
      "ServerAliveInterval=30",
    ];
    if (connection.keyPath && existsSync(connection.keyPath)) {
      args.push("-i", connection.keyPath, "-o", "IdentitiesOnly=yes");
    }
    args.push(
      "-p",
      String(connection.port || 22),
      `${connection.username}@${connection.host}`,
      command,
    );
    const child = spawn("ssh", args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("SSH command timed out"));
    }, timeoutMs);
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new Error(
          error.code === "ENOENT"
            ? "System SSH client not found on PATH"
            : error.message,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
    child.stdin.end(stdin);
  });
}

function cleanError(stderr: string): string {
  const cleaned = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^Warning: Permanently added /.test(line))
    .join("\n");
  if (/Permission denied \(publickey\)|no such identity/i.test(cleaned))
    return "SSH authentication failed. Add a key for this host and try again.";
  if (
    /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(
      cleaned,
    )
  )
    return "SSH host key verification failed. Check the host key before reconnecting.";
  return cleaned.slice(0, 800) || "SSH command failed";
}

async function runScript(
  connection: ExplorerSshConnection,
  kind: SshScriptKind,
  payload: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<SshOpResult> {
  const command = `python3 -c ${shellQuote(sshScriptSource(kind))}`;
  let result: { stdout: string; stderr: string; code: number };
  try {
    result = await execSsh(
      connection,
      command,
      JSON.stringify(payload),
      timeoutMs,
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (result.code !== 0) return { ok: false, error: cleanError(result.stderr) };
  try {
    const parsed = JSON.parse(result.stdout.trim()) as SshOpResult;
    if (!parsed || typeof parsed !== "object")
      return { ok: false, error: "Unexpected SSH response" };
    return parsed;
  } catch {
    return {
      ok: false,
      error: cleanError(result.stderr) || "Unexpected SSH response",
    };
  }
}

// ── Operations ───────────────────────────────────────────────────────────────

export async function sshExplorerTest(
  connection: ExplorerSshConnection,
): Promise<SshOpResult<{ home: string }>> {
  return runScript(connection, "test", {}) as Promise<
    SshOpResult<{ home: string }>
  >;
}

export async function sshExplorerList(
  connection: ExplorerSshConnection,
  path: string,
): Promise<SshOpResult<{ entries: SshEntry[]; path: string }>> {
  return runScript(connection, "list", { path }) as Promise<
    SshOpResult<{ entries: SshEntry[]; path: string }>
  >;
}

export async function sshExplorerRead(
  connection: ExplorerSshConnection,
  path: string,
  maxBytes = 0,
): Promise<SshOpResult<{ content: string; truncated: boolean }>> {
  const result = (await runScript(
    connection,
    "read",
    { path, maxBytes },
    60000,
  )) as SshOpResult<{ content: string; truncated: boolean }>;
  if (!result.ok) return result;
  return {
    ok: true,
    content: Buffer.from(result.content, "base64").toString("utf-8"),
    truncated: result.truncated,
  };
}

export async function sshExplorerWrite(
  connection: ExplorerSshConnection,
  path: string,
  content: string,
): Promise<SshOpResult> {
  return runScript(connection, "write", { path, content }, 60000);
}

export async function sshExplorerCreate(
  connection: ExplorerSshConnection,
  root: string,
  parent: string,
  name: string,
  kind: "file" | "directory",
): Promise<SshOpResult<{ path: string }>> {
  return runScript(connection, "create", {
    root,
    parent,
    name,
    kind,
  }) as Promise<SshOpResult<{ path: string }>>;
}

export async function sshExplorerRename(
  connection: ExplorerSshConnection,
  root: string,
  path: string,
  name: string,
): Promise<SshOpResult<{ path: string }>> {
  return runScript(connection, "rename", { root, path, name }) as Promise<
    SshOpResult<{ path: string }>
  >;
}

export async function sshExplorerDelete(
  connection: ExplorerSshConnection,
  root: string,
  path: string,
): Promise<SshOpResult> {
  return runScript(connection, "delete", { root, path }, 120000);
}

export async function sshExplorerCopy(
  connection: ExplorerSshConnection,
  root: string,
  source: string,
  destinationDir: string,
): Promise<SshOpResult<{ path: string }>> {
  return runScript(
    connection,
    "copy",
    { root, source, destination: destinationDir },
    120000,
  ) as Promise<SshOpResult<{ path: string }>>;
}
