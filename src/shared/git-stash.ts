export interface GitStashFile {
  path: string;
  status: string;
}

export interface GitStashFileSelection {
  hash: string;
  paths: string[];
}

export interface GitStashFilesResult {
  ok: boolean;
  files: GitStashFile[];
  error?: string;
}

export interface GitStashEntry {
  hash: string;
  ref: string;
  subject: string;
}

export interface GitStashListResult {
  ok: boolean;
  entries: GitStashEntry[];
  error?: string;
}
