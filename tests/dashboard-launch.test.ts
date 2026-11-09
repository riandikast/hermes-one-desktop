import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildLocalDashboardCliArgs, localDashboardEnvironment } from "../src/main/dashboard-launch";

describe("local dashboard launch args", () => {
  it("wires the renderer origin into the spawned backend and preserves local Legacy on updates", () => {
    const dashboard = readFileSync("src/main/dashboard.ts", "utf8");
    expect(dashboard).toContain("...localDashboardEnvironment(process.env, is.dev)");
    const chat = readFileSync("src/renderer/src/screens/Chat/Chat.tsx", "utf8");
    const localChoices = [...chat.matchAll(/conn\.mode === "local"\s*\?\s*([^\n]+)/g)];
    expect(localChoices).toHaveLength(2);
    for (const choice of localChoices) expect(choice[1]).toContain('conn.localChatTransport ?? "auto"');
  });
  it("declares only this desktop's actual dev renderer origin to the backend", () => {
    expect(localDashboardEnvironment({
      ELECTRON_RENDERER_URL: "http://localhost:5173",
      HERMES_DESKTOP_DEV_SERVER: "http://localhost:5174",
      PATH: "fixture",
    }, true)).toEqual({
      ELECTRON_RENDERER_URL: "http://localhost:5173",
      HERMES_DESKTOP_DEV_SERVER: "http://localhost:5173",
      PATH: "fixture",
    });
    expect(localDashboardEnvironment({ HERMES_DESKTOP_DEV_SERVER: "http://localhost:5174" }, true)
      .HERMES_DESKTOP_DEV_SERVER).toBeUndefined();
    expect(localDashboardEnvironment({
      ELECTRON_RENDERER_URL: "http://localhost:5173",
      HERMES_DESKTOP_DEV_SERVER: "http://localhost:5174",
    }, false).HERMES_DESKTOP_DEV_SERVER).toBeUndefined();
  });
  it("matches the current upstream desktop dashboard command shape", () => {
    expect(buildLocalDashboardCliArgs(undefined, 9123)).toEqual([
      "dashboard",
      "--isolated",
      "--no-open",
      "--host",
      "127.0.0.1",
      "--port",
      "9123",
    ]);
  });

  it("preserves profile and prebuilt web-dist support without the legacy --tui flag", () => {
    const args = buildLocalDashboardCliArgs("work", 9123, { skipBuild: true });

    expect(args).toEqual([
      "--profile",
      "work",
      "dashboard",
      "--isolated",
      "--no-open",
      "--host",
      "127.0.0.1",
      "--port",
      "9123",
      "--skip-build",
    ]);
    expect(args).not.toContain("--tui");
  });
});
