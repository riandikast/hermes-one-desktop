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

  it("deletes through the agent's bulk-delete for the active profile, then cleans desktop rows", async () => {
    dashboard.getDashboardConnection.mockReturnValue({ baseUrl: "http://127.0.0.1:9", token: "t" });
    dashboard.dashboardRequestJson.mockResolvedValue({ ok: true, deleted: 2 });
    await deleteLocalSessions(["a", "b", "a"]);
    expect(dashboard.getDashboardConnection).toHaveBeenCalledWith("work");
    expect(dashboard.dashboardRequestJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9", "t", "/api/sessions/bulk-delete",
      expect.objectContaining({ method: "POST", body: { ids: ["a", "b"], profile: "work" } }),
    );
    // Subtree ids are read BEFORE the agent deletes them.
    expect(sessions.sessionSubtreeIds.mock.invocationCallOrder[0])
      .toBeLessThan(dashboard.dashboardRequestJson.mock.invocationCallOrder[0]);
    expect(sessions.finishAgentSessionDelete).toHaveBeenCalledWith(["a", "b"], ["a", "b", "child-of-a"]);
    expect(sessions.deleteSessions).not.toHaveBeenCalled();
  });

  it("falls back to the direct delete when no local dashboard is running", async () => {
    dashboard.getDashboardConnection.mockReturnValue(null);
    await deleteLocalSessions(["a"]);
    expect(sessions.deleteSessions).toHaveBeenCalledWith(["a"]);
    expect(dashboard.dashboardRequestJson).not.toHaveBeenCalled();
  });

  it("falls back to the direct delete when the agent lacks the bulk-delete route", async () => {
    dashboard.getDashboardConnection.mockReturnValue({ baseUrl: "http://127.0.0.1:9", token: "t" });
    dashboard.dashboardRequestJson.mockRejectedValue(new Error("404: Not Found"));
    await deleteLocalSessions(["a"]);
    expect(sessions.deleteSessions).toHaveBeenCalledWith(["a"]);
  });

  it("ignores malformed input", async () => {
    expect(await deleteLocalSessions("a")).toEqual({ requested: 0, deleted: 0 });
    expect(dashboard.getDashboardConnection).not.toHaveBeenCalled();
  });
});
