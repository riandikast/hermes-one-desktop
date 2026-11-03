export interface GitLocalBranch {
  name: string;
  current: boolean;
  checkedOut: boolean;
  upstream?: string | null;
}

export interface GitBranchListResult {
  ok: boolean;
  branches: GitLocalBranch[];
  current: string | null;
  remotes?: { name: string; fetchUrls: string[]; pushUrls: string[]; pushFingerprint?: string }[];
  remoteBranches?: { remote: string; name: string }[];
  error?: string;
}

export type GitBranchAction = "checkout" | "merge" | "create" | "delete" | "add-remote";
