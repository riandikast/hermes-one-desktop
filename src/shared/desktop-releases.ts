export interface DesktopRelease {
  tag: string;
  version: string;
}
export interface DesktopReleasePage {
  available: boolean;
  reason: string;
  installed: string;
  latest?: string | null;
  releases: DesktopRelease[];
  nextPage: number | null;
}
export interface DesktopReleaseState {
  phase: "idle" | "downloading" | "ready";
  version: string | null;
}
