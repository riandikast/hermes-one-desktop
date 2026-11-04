/** Remote paths are encoded as `ssh://<connectionId>/absolute/path`. */

export const REMOTE_PATH_PREFIX = "ssh://";

export interface ExplorerSshConnection {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  keyPath: string;
  /** Absolute remote folder shown as this connection's root. */
  rootPath: string;
}

export interface RemotePathParts {
  connectionId: string;
  path: string;
}

export function isRemotePath(path: string | null | undefined): boolean {
  return typeof path === "string" && path.startsWith(REMOTE_PATH_PREFIX);
}

export function parseRemotePath(path: string): RemotePathParts | null {
  if (!isRemotePath(path)) return null;
  const rest = path.slice(REMOTE_PATH_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const connectionId = rest.slice(0, slash);
  const remotePath = rest.slice(slash) || "/";
  if (!connectionId || !remotePath.startsWith("/")) return null;
  return { connectionId, path: remotePath };
}

export function remotePath(connectionId: string, path: string): string {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  return `${REMOTE_PATH_PREFIX}${connectionId}${absolute}`;
}

/** Display name for a remote root (`ssh://id/home/me` → `me`). */
export function remoteBaseName(path: string): string {
  const parsed = parseRemotePath(path);
  const remote = parsed?.path ?? path;
  return remote.split("/").filter(Boolean).pop() || remote || path;
}
