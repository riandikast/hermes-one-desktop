export const BACKEND_SOURCE_URL = "https://github.com/NousResearch/hermes-agent";

export interface BackendUpdateStatus {
  status: "current" | "available" | "ahead" | "diverged" | "unknown";
  detail: string;
  branch?: string;
  installed?: string;
  latest?: string;
}
