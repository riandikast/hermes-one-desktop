import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  getConnectionConfig: vi.fn(() => ({
    mode: "local",
    remoteUrl: "",
    apiKey: "",
    remoteAuthMode: "auto",
    ssh: {},
  })),
}));

vi.mock("./dashboard", () => ({
  getDashboardConnection: vi.fn(() => ({
    baseUrl: "http://127.0.0.1:9123",
    token: "test-token",
  })),
  dashboardRequestJson: vi.fn(),
  startDashboard: vi.fn(),
}));

vi.mock("./remote-api", () => ({
  remoteDashboardRequestJson: vi.fn(),
}));

import { getConnectionConfig } from "./config";
import {
  dashboardRequestJson,
  getDashboardConnection,
  startDashboard,
} from "./dashboard";
import { remoteDashboardRequestJson } from "./remote-api";
import {
  getDashboardSkills,
  setDashboardSkillEnabled,
  getDashboardToolsets,
  setDashboardToolsetEnabled,
  getHubSources,
  searchHubSkills,
  previewHubSkill,
  scanHubSkill,
} from "./dashboard-capabilities";

const mockedGetConnection = vi.mocked(getConnectionConfig);
const mockedGetDashboardConnection = vi.mocked(getDashboardConnection);
const mockedDashboardRequest = vi.mocked(dashboardRequestJson);
const mockedRemoteRequest = vi.mocked(remoteDashboardRequestJson);
const mockedStartDashboard = vi.mocked(startDashboard);

function testConnection(
  fields: Partial<ReturnType<typeof getConnectionConfig>> = {},
): ReturnType<typeof getConnectionConfig> {
  return {
    mode: "local",
    remoteUrl: "",
    apiKey: "",
    remoteAuthMode: "auto",
    remoteChatTransport: "auto",
    sshChatTransport: "auto",
    localChatTransport: "auto",
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 0,
      localPort: 0,
    },
    ...fields,
  };
}

describe("dashboard-capabilities", () => {
  beforeEach(() => {
    mockedGetConnection.mockReturnValue(testConnection());
    mockedGetDashboardConnection.mockReturnValue({
      baseUrl: "http://127.0.0.1:9123",
      token: "test-token",
    });
    mockedDashboardRequest.mockReset();
    mockedRemoteRequest.mockReset();
    mockedStartDashboard.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /api/skills passes the session token and maps rows", async () => {
    mockedDashboardRequest.mockResolvedValue([
      { name: "pdf", enabled: true, usage: 3, provenance: "bundled", category: "productivity", description: "PDF" },
    ]);
    const skills = await getDashboardSkills();
    expect(mockedDashboardRequest).toHaveBeenCalledWith(
      "http://127.0.0.1:9123",
      "test-token",
      "/api/skills",
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
    expect(skills[0]).toMatchObject({ name: "pdf", enabled: true, usage: 3, provenance: "bundled" });
  });

  it("PUT /api/skills/toggle sends name + enabled", async () => {
    mockedDashboardRequest.mockResolvedValue({ ok: true, name: "pdf", enabled: false });
    await setDashboardSkillEnabled("pdf", false);
    expect(mockedDashboardRequest).toHaveBeenCalledWith(
      "http://127.0.0.1:9123",
      "test-token",
      "/api/skills/toggle",
      expect.objectContaining({ method: "PUT", body: { name: "pdf", enabled: false } }),
    );
  });

  it("GET /api/tools/toolsets maps rows", async () => {
    mockedDashboardRequest.mockResolvedValue([
      { name: "terminal", label: "Terminal", description: "Shell", platform: "cli", enabled: true, available: true, configured: true, tools: ["run_shell"] },
    ]);
    const toolsets = await getDashboardToolsets();
    expect(mockedDashboardRequest).toHaveBeenCalledWith(
      "http://127.0.0.1:9123",
      "test-token",
      "/api/tools/toolsets",
      expect.anything(),
    );
    expect(toolsets[0]).toMatchObject({ name: "terminal", enabled: true, tools: ["run_shell"], configured: true });
  });

  it("PUT /api/tools/toolsets/{name} sends enabled", async () => {
    mockedDashboardRequest.mockResolvedValue({ ok: true, name: "terminal", platform: "cli", enabled: false });
    await setDashboardToolsetEnabled("terminal", false);
    expect(mockedDashboardRequest).toHaveBeenCalledWith(
      "http://127.0.0.1:9123",
      "test-token",
      "/api/tools/toolsets/terminal",
      expect.objectContaining({ method: "PUT", body: { enabled: false } }),
    );
  });

  it("hub sources, search, preview, scan hit the right paths", async () => {
    mockedDashboardRequest.mockResolvedValueOnce({ sources: [], index_available: false, featured: [], installed: {} });
    await getHubSources();
    expect(mockedDashboardRequest).toHaveBeenNthCalledWith(
      1, "http://127.0.0.1:9123", "test-token", "/api/skills/hub/sources", expect.anything(),
    );

    mockedDashboardRequest.mockResolvedValueOnce({ results: [], source_counts: {}, timed_out: [], installed: {} });
    await searchHubSkills("ocr", "all", 20);
    const searchCall = mockedDashboardRequest.mock.calls[1][2] as string;
    expect(searchCall).toContain("/api/skills/hub/search");
    expect(searchCall).toContain("q=ocr");

    mockedDashboardRequest.mockResolvedValueOnce({ name: "pdf", identifier: "i", trust_level: "trusted", skill_md: "# PDF", files: [] });
    await previewHubSkill("i");
    const previewCall = mockedDashboardRequest.mock.calls[2][2] as string;
    expect(previewCall).toContain("/api/skills/hub/preview");
    expect(previewCall).toContain("identifier=i");

    mockedDashboardRequest.mockResolvedValueOnce({ name: "pdf", identifier: "i", verdict: "safe", policy: "allow", findings: [], severity_counts: {} });
    await scanHubSkill("i");
    const scanCall = mockedDashboardRequest.mock.calls[3][2] as string;
    expect(scanCall).toContain("/api/skills/hub/scan");
  });

  it("parses a hub search result with installed map and timedOut", async () => {
    mockedDashboardRequest.mockResolvedValue({
      results: [{ name: "ocr", identifier: "i", trust_level: "community", description: "OCR" }],
      timed_out: ["github"],
      installed: { i: { name: "ocr" } },
    });
    const out = await searchHubSkills("ocr");
    expect(out.results[0].trustLevel).toBe("community");
    expect(out.timedOut).toEqual(["github"]);
    expect(out.installed.i.name).toBe("ocr");
  });

  it("throws a readable error when the dashboard is not running and cannot start", async () => {
    mockedGetDashboardConnection.mockReturnValue(null);
    mockedStartDashboard.mockResolvedValue({
      supported: true,
      running: false,
      error: "Timed out waiting for Hermes dashboard",
    });
    await expect(getDashboardSkills()).rejects.toThrow(/Timed out/);
    expect(mockedStartDashboard).toHaveBeenCalledWith(undefined);
  });

  it("starts the dashboard when no connection exists yet", async () => {
    mockedGetDashboardConnection.mockReturnValue(null);
    mockedStartDashboard.mockResolvedValue({
      supported: true,
      running: true,
      connection: {
        baseUrl: "http://127.0.0.1:9123",
        wsUrl: "ws://127.0.0.1:9123/api/ws?token=test-token",
        token: "test-token",
        mode: "local",
      },
    });
    mockedDashboardRequest.mockResolvedValue([]);
    await getDashboardSkills();
    expect(mockedDashboardRequest).toHaveBeenCalledWith(
      "http://127.0.0.1:9123",
      "test-token",
      "/api/skills",
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
  });

  it("throws when the backend returns a non-ok status", async () => {
    mockedDashboardRequest.mockRejectedValue(new Error("500: boom"));
    await expect(getDashboardSkills()).rejects.toThrow(/500/);
  });

  it("routes through the remote API in remote mode", async () => {
    mockedGetConnection.mockReturnValue(
      testConnection({
        mode: "remote",
        remoteUrl: "https://remote.example",
        apiKey: "k",
        remoteAuthMode: "token",
      }),
    );
    mockedRemoteRequest.mockResolvedValue([{ name: "pdf", enabled: true, usage: 0, provenance: "bundled", category: "c", description: "d" }]);
    const skills = await getDashboardSkills("p");
    expect(mockedRemoteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "remote" }),
      "/api/skills",
      expect.anything(),
      "p",
    );
    expect(skills[0].name).toBe("pdf");
  });
});
