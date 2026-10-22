export interface IgnoreRule { line: number; pattern: string }
export interface GitIgnoreResult {
  ok: boolean;
  rules: IgnoreRule[];
  files: string[];
  version: string;
  hasMore: boolean;
  error?: string;
}
