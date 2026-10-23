export interface GitHubAuthStatus {
  git: boolean;
  manager: boolean;
  helper: boolean;
  auth: "authenticated" | "unauthenticated" | "unknown";
  account?: string;
  accounts?: string[];
  selectedAccount?: string;
  error?: "unavailable" | "failed" | "cancelled" | "timeout" | "busy" | "selectAccount" | "invalidToken";
}
