/**
 * Explorer-side SSH: saved hosts plus file operations executed over the system
 * OpenSSH client. Reuses the app's SSH key/discovery conventions, but is
 * independent of the gateway connection mode, so a remote tree can be browsed
 * with no local folder attached.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { app } from "electron";
import { dirname, join } from "path";
import { homedir } from "os";
import { createHmac, randomUUID } from "crypto";
import { Client, type ConnectConfig } from "ssh2";
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
  | { ok: false; error: string; needsPassword?: boolean };

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
  closeSshClient(id);
  sessionSecrets.delete(id);
  return { ok: true };
}

// ── Connection pool (passwords stay in memory for this app run) ─────────────

const sessionSecrets = new Map<string, string>();
const clients = new Map<string, Client>();

class SshAuthRequiredError extends Error {
  constructor() {
    super("SSH password required");
    this.name = "SshAuthRequiredError";
  }
}

export function hasExplorerSshSecret(id: string): boolean {
  return sessionSecrets.has(id);
}

function sessionKey(connection: ExplorerSshConnection): string {
  return `${connection.id}:${connection.host}:${connection.port}:${connection.username}`;
}

function closeSshClient(connectionId: string): void {
  for (const [key, client] of clients) {
    if (!key.startsWith(`${connectionId}:`)) continue;
    try {
      client.end();
    } catch {
      // Already closed.
    }
    clients.delete(key);
  }
}

function isAuthenticationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const level = (error as { level?: string }).level;
  const message = String((error as { message?: string }).message ?? "");
  return (
    level === "client-authentication" ||
    /authentication methods failed|authentication failed|permission denied/i.test(
      message,
    )
  );
}

// ── TOFU host keys (mirrors OpenSSH accept-new, never silently trusts) ──────

function keyTypeOf(blob: Buffer): string {
  if (blob.length < 4) return "";
  const length = blob.readUInt32BE(0);
  if (length <= 0 || length > blob.length - 4) return "";
  return blob.subarray(4, 4 + length).toString("ascii");
}

function knownHostTokens(host: string, port: number): string[] {
  return port === 22 ? [host] : [`[${host}]:${port}`];
}

function hashedHostMatches(
  pattern: string,
  host: string,
  port: number,
): boolean {
  const parts = pattern.split("|");
  if (parts.length !== 4 || parts[1] !== "1") return false;
  const salt = Buffer.from(parts[2], "base64");
  for (const token of knownHostTokens(host, port)) {
    if (createHmac("sha1", salt).update(token).digest("base64") === parts[3])
      return true;
  }
  return false;
}

type HostKeyState = "match" | "mismatch" | "unknown";

function verifyHostKey(host: string, port: number, blob: Buffer): HostKeyState {
  const file = join(homedir(), ".ssh", "known_hosts");
  let content = "";
  try {
    content = readFileSync(file, "utf-8");
  } catch {
    return "unknown";
  }
  const presentedType = keyTypeOf(blob);
  const presented = blob.toString("base64");
  let sawType = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("@")) continue;
    const [hostsField, keyType, keyData] = line.split(/\s+/);
    if (!hostsField || !keyType || !keyData || keyType !== presentedType)
      continue;
    const matchesHost = hostsField
      .split(",")
      .some((pattern) =>
        pattern.startsWith("|1|")
          ? hashedHostMatches(pattern, host, port)
          : knownHostTokens(host, port).includes(pattern),
      );
    if (!matchesHost) continue;
    sawType = true;
    if (keyData === presented) return "match";
    return "mismatch";
  }
  return sawType ? "mismatch" : "unknown";
}

function rememberHostKey(host: string, port: number, blob: Buffer): void {
  const directory = join(homedir(), ".ssh");
  const file = join(directory, "known_hosts");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const existing = existsSync(file) ? readFileSync(file, "utf-8") : "";
  const line = `${knownHostTokens(host, port)[0]} ${keyTypeOf(blob)} ${blob.toString("base64")}\n`;
  const separator = existing && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(file, `${existing}${separator}${line}`, { mode: 0o600 });
}

// ── Client + exec ───────────────────────────────────────────────────────────

function defaultKeyPaths(): string[] {
  return ["id_ed25519", "id_rsa", "id_ecdsa"].map((name) =>
    join(homedir(), ".ssh", name),
  );
}

function connectClient(connection: ExplorerSshConnection): Promise<Client> {
  const cacheKey = sessionKey(connection);
  const cached = clients.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  const password = sessionSecrets.get(connection.id);
  const config: ConnectConfig = {
    host: connection.host,
    port: connection.port || 22,
    username: connection.username,
    readyTimeout: 20000,
    keepaliveInterval: 15000,
    keepaliveCountMax: 3,
    tryKeyboard: Boolean(password),
    hostVerifier: (blob: Buffer) => {
      const state = verifyHostKey(connection.host, connection.port || 22, blob);
      if (state === "match") return true;
      if (state === "unknown") {
        rememberHostKey(connection.host, connection.port || 22, blob);
        return true;
      }
      return false;
    },
  };
  if (password) {
    config.password = password;
  } else if (connection.keyPath) {
    try {
      config.privateKey = readFileSync(connection.keyPath);
    } catch {
      return Promise.reject(new Error("SSH key file could not be read"));
    }
  } else {
    const defaultKey = defaultKeyPaths().find((path) => existsSync(path));
    if (defaultKey) config.privateKey = readFileSync(defaultKey);
    else if (process.platform === "win32")
      config.agent = "\\\\.\\pipe\\openssh-ssh-agent";
    else if (process.env.SSH_AUTH_SOCK)
      config.agent = process.env.SSH_AUTH_SOCK;
  }
  return new Promise((resolve, reject) => {
    const client = new Client();
    if (password) {
      client.on(
        "keyboard-interactive",
        (_name, _instructions, _language, prompts, finish) => {
          finish(prompts.map(() => password));
        },
      );
    }
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
        // Never connected.
      }
      if (isAuthenticationError(error)) {
        reject(
          password
            ? new Error("SSH authentication failed. Check the password.")
            : new SshAuthRequiredError(),
        );
        return;
      }
      reject(error);
    };
    client.once("ready", () => {
      settled = true;
      clients.set(cacheKey, client);
      const drop = (): void => {
        clients.delete(cacheKey);
      };
      client.on("error", drop);
      client.on("close", drop);
      resolve(client);
    });
    client.once("error", (error: Error) => fail(error));
    try {
      client.connect(config);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function execSsh(
  connection: ExplorerSshConnection,
  command: string,
  stdin: string,
  timeoutMs: number,
  attempt = 0,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const client = await connectClient(connection);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("SSH command timed out"));
      }, timeoutMs);
      client.exec(command, (error, stream) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }
        let stdout = "";
        let stderr = "";
        stream.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf-8");
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf-8");
        });
        stream.on("close", (code: number) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code: code ?? -1 });
        });
        stream.end(stdin);
      });
    });
  } catch (error) {
    closeSshClient(connection.id);
    if (attempt === 0)
      return execSsh(connection, command, stdin, timeoutMs, attempt + 1);
    throw error;
  }
}

function cleanError(message: string): string {
  const cleaned = message.trim();
  if (
    /authentication methods failed|authentication failed|permission denied/i.test(
      cleaned,
    )
  )
    return "SSH authentication failed. Check the password or key.";
  if (/Host key verification failed|host key/i.test(cleaned))
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
    if (error instanceof SshAuthRequiredError) {
      return { ok: false, error: "SSH password required", needsPassword: true };
    }
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
  password?: string,
): Promise<SshOpResult<{ home: string }>> {
  if (password) sessionSecrets.set(connection.id, password);
  const result = (await runScript(
    connection,
    "test",
    {},
    25000,
  )) as SshOpResult<{
    home: string;
  }>;
  if (!result.ok && password && /authentication/i.test(result.error)) {
    // A rejected password must not stick around for the next attempt.
    sessionSecrets.delete(connection.id);
    closeSshClient(connection.id);
  }
  return result;
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
