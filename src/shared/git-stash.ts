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
