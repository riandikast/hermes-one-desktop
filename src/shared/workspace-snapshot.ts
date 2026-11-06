export interface WorkspaceSnapshotFile {
  /** Absolute path; fingerprint hashes the actual working-tree bytes. */
  path: string;
  fingerprint: string;
  /** Exact UTF-8 text (including CRLF), or null for binary/invalid UTF-8. */
  content: string | null;
}

export interface WorkspaceSnapshot {
  /** Canonical attached directory, not necessarily the repository root. Null disables comparison. */
  root: string | null;
  files: WorkspaceSnapshotFile[];
  /** Ignore these absolute paths in BOTH snapshots; exclusion is not deletion. */
  excludedPaths?: string[];
  warning?: string;
}
