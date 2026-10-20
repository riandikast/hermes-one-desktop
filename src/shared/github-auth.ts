export interface GitHubAuthStatus {
  git: boolean;
  manager: boolean;
  helper: boolean;
  auth: "authenticated" | "unauthenticated" | "unknown";
  account?: string;
  error?: "unavailable" | "failed" | "cancelled" | "timeout" | "busy";
}
