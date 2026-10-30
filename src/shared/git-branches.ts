export interface GitLocalBranch {
  name: string;
  current: boolean;
  checkedOut: boolean;
}

export interface GitBranchListResult {
  ok: boolean;
  branches: GitLocalBranch[];
  current: string | null;
  error?: string;
}

export type GitBranchAction = "checkout" | "merge" | "create" | "delete";
