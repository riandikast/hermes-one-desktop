import { beforeEach, describe, expect, it, vi } from "vitest";

const dashboard = vi.hoisted(() => ({
  getDashboardConnection: vi.fn(),
  dashboardRequestJson: vi.fn(),
}));
const sessions = vi.hoisted(() => ({
  deleteSessions: vi.fn((ids: string[]) => ({ requested: ids.length, deleted: ids.length })),
  finishAgentSessionDelete: vi.fn((ids: string[]) => ({ requested: ids.length, deleted: ids.length })),
  sessionSubtreeIds: vi.fn((ids: string[]) => [...ids, "child-of-a"]),
  normalizeSessionIds: (ids: unknown[]) => [...new Set(ids.filter((id): id is string => typeof id === "string" && !!id.trim()))],
}));
vi.mock("./dashboard", () => dashboard);
vi.mock("./sessions", () => sessions);
vi.mock("./utils", () => ({ getActiveProfileNameSync: () => "work" }));

import { deleteLocalSessions } from "./session-delete";

describe("deleteLocalSessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes each session through the agent for the active profile, then cleans desktop rows", async () => {
    dashboard.getDashboardConnection.mockReturnValue({ baseUrl: "http://127.0.0.1:9", token: "t" });
    dashboard.dashboardRequestJson.mockImplementation(async (_base: string, _token: string, path: string) =>
      path.includes("mutation-snapshot") ? { exists: true, runtime_revision: 2, runtime_generation: null } : { ok: true });
    await deleteLocalSessions(["a", "b", "a"]);
    expect(dashboard.getDashboardConnection).toHaveBeenCalledWith("work");
    const paths = dashboard.dashboardRequestJson.mock.calls.map((call) => call[2] as string);
    expect(paths).toHaveLength(4);
    for (const path of paths) expect(new URL(path, "http://x").searchParams.get("profile")).toBe("work");
    expect(paths.filter((p) => p.startsWith("/api/sessions/a?")).length).toBe(1);
    // Subtree ids are read BEFORE the agent deletes them.
    expect(sessions.sessionSubtreeIds.mock.invocationCallOrder[0])
      .toBeLessThan(dashboard.dashboardRequestJson.mock.invocationCallOrder[0]);
    expect(sessions.finishAgentSessionDelete).toHaveBeenCalledWith(["a", "b"], ["a", "b", "child-of-a"]);
    expect(sessions.deleteSessions).not.toHaveBeenCalled();
  });

  it("keeps going after one refusal and never falls back to raw SQL while the agent runs", async () => {
    dashboard.getDashboardConnection.mockReturnValue({ baseUrl: "http://127.0.0.1:9", token: "t" });
    dashboard.dashboardRequestJson.mockImplementation(async (_base: string, _token: string, path: string) => {
      if (path.includes("mutation-snapshot")) return { exists: true, runtime_revision: 1, runtime_generation: null };
      if (path.startsWith("/api/sessions/a?")) throw new Error('409: {"detail":"session_busy"}');
      return { ok: true };
    });
    await deleteLocalSessions(["a", "b"]);
    expect(dashboard.dashboardRequestJson.mock.calls.some((call) => String(call[2]).startsWith("/api/sessions/b?"))).toBe(true);
    expect(sessions.deleteSessions).not.toHaveBeenCalled();
    // Which ids survived is decided by state.db afterwards, not by the error.
    expect(sessions.finishAgentSessionDelete).toHaveBeenCalledWith(["a", "b"], expect.any(Array));
  });

  it("uses the direct delete when no local dashboard is running", async () => {
    dashboard.getDashboardConnection.mockReturnValue(null);
    await deleteLocalSessions(["a"]);
    expect(sessions.deleteSessions).toHaveBeenCalledWith(["a"]);
    expect(dashboard.dashboardRequestJson).not.toHaveBeenCalled();
  });

  it("ignores malformed input", async () => {
    expect(await deleteLocalSessions("a")).toEqual({ requested: 0, deleted: 0 });
    expect(dashboard.getDashboardConnection).not.toHaveBeenCalled();
  });
});
