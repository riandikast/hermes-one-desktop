import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", setLocale: () => {} }),
}));
vi.mock("../../components/AgentMarkdown", () => ({
  AgentMarkdown: ({ content }: { content: string }) => <pre>{content}</pre>,
}));
vi.mock("../../components/OrbLoader", () => ({
  OrbLoader: () => <div data-testid="orb-loader" />,
}));

import Capabilities from "./Capabilities";

const MOCK_SKILLS = [
  {
    name: "pdf",
    enabled: true,
    usage: 3,
    provenance: "bundled",
    category: "productivity",
    description: "Create and edit PDF files",
  },
  {
    name: "ocr-and-documents",
    enabled: false,
    usage: 0,
    provenance: "bundled",
    category: "productivity",
    description: "Extract text from PDFs and scans",
  },
];

const MOCK_TOOLSETS = [
  {
    name: "terminal",
    label: "Terminal",
    description: "Execute shell commands",
    platform: "cli",
    enabled: true,
    available: true,
    configured: true,
    tools: ["run_shell"],
  },
  {
    name: "vision",
    label: "Vision",
    description: "Analyze images",
    platform: "cli",
    enabled: false,
    available: true,
    configured: false,
    tools: ["read_image"],
  },
];

const MOCK_SOURCES = {
  sources: [
    { id: "hermes-index", label: "Official", available: true, searchable: false },
    { id: "skills-sh", label: "skills.sh", searchable: false },
  ],
  indexAvailable: true,
  featured: [
    {
      name: "pdf",
      identifier: "official/productivity/pdf",
      source: "official",
      trustLevel: "trusted",
      description: "Create PDFs",
    },
  ],
  installed: { "official/productivity/pdf": { name: "pdf" } },
};

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    getDashboardSkills: vi.fn().mockResolvedValue(MOCK_SKILLS),
    setDashboardSkillEnabled: vi.fn().mockResolvedValue(true),
    getDashboardToolsets: vi.fn().mockResolvedValue(MOCK_TOOLSETS),
    setDashboardToolsetEnabled: vi.fn().mockResolvedValue(true),
    getHubSources: vi.fn().mockResolvedValue(MOCK_SOURCES),
    searchHubSkills: vi.fn().mockResolvedValue({ results: [], installed: {}, timedOut: [] }),
    previewHubSkill: vi.fn().mockResolvedValue({
      name: "pdf",
      description: "Create PDFs",
      source: "official",
      identifier: "official/productivity/pdf",
      trustLevel: "trusted",
      skillMd: "# PDF\nCreate and edit.",
      files: ["SKILL.md"],
    }),
    scanHubSkill: vi.fn().mockResolvedValue({
      name: "pdf",
      identifier: "i",
      trustLevel: "trusted",
      verdict: "safe",
      summary: "",
      policy: "allow",
      policyReason: "",
      findings: [],
      severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
    }),
    installHubSkill: vi.fn().mockResolvedValue({ success: true }),
    uninstallHubSkill: vi.fn().mockResolvedValue({ success: true }),
    updateHubSkills: vi.fn().mockResolvedValue({ success: true }),
    listMcpServers: vi.fn().mockResolvedValue([]),
    listInstalledSkills: vi.fn().mockResolvedValue([
      { name: "pdf", category: "productivity", description: "Create PDFs", path: "/skills/productivity/pdf" },
    ]),
    fetchRegistry: vi.fn().mockResolvedValue({ skills: [], mcps: [], agents: [], workflows: [] }),
    getSkillContent: vi.fn().mockResolvedValue("# pdf\ncontent"),
    installSkill: vi.fn().mockResolvedValue({ success: true }),
    uninstallSkill: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

function mountWith(overrides: Record<string, unknown> = {}) {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: makeApi(overrides),
  });
  return render(<Capabilities profile="default" />);
}

describe("Capabilities — Skills tab", () => {
  it("renders skill rows with name, category, and provenance", async () => {
    const view = mountWith();
    await waitFor(() => expect(view.getByText("pdf")).toBeTruthy());
    expect(view.getByText("ocr-and-documents")).toBeTruthy();
    // Mock t() returns the key: "capabilities.provenance.bundled" (both
    // mock skills are bundled → appears once per row).
    expect(
      view.getAllByText("capabilities.provenance.bundled").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("toggles a skill via setDashboardSkillEnabled (optimistic)", async () => {
    const setEnabled = vi.fn().mockResolvedValue(true);
    const view = mountWith({ setDashboardSkillEnabled: setEnabled });
    await waitFor(() => expect(view.getByText("pdf")).toBeTruthy());
    const toggles = view.container.querySelectorAll(".cap-toggle input");
    await act(async () => {
      fireEvent.click(toggles[1] as HTMLInputElement);
    });
    expect(setEnabled).toHaveBeenCalledWith("ocr-and-documents", true, "default");
  });
});

describe("Capabilities — Toolsets tab", () => {
  it("renders toolsets and toggles them", async () => {
    const setToolset = vi.fn().mockResolvedValue(true);
    const view = mountWith({ setDashboardToolsetEnabled: setToolset });
    await waitFor(() => expect(view.getByText("pdf")).toBeTruthy());
    const tabs = view.container.querySelectorAll(".cap-tab");
    await act(async () => {
      fireEvent.click(tabs[1] as HTMLButtonElement);
    });
    await waitFor(() => expect(view.getByText("Terminal")).toBeTruthy());
    await waitFor(() => expect(view.getByText("Vision")).toBeTruthy());
    const toggles = view.container.querySelectorAll(".cap-toggle input");
    await act(async () => {
      fireEvent.click(toggles[1] as HTMLInputElement);
    });
    expect(setToolset).toHaveBeenCalledWith("vision", true, "default");
  });
});

const MOCK_MCP = [
  {
    name: "github",
    type: "http" as const,
    transport: "http" as const,
    enabled: true,
    detail: "https://example.com/mcp",
    url: "https://example.com/mcp",
    args: [],
    env: {},
  },
];

describe("Capabilities — MCP tab", () => {
  it("renders the MCP server table from listMcpServers", async () => {
    const view = mountWith({ listMcpServers: vi.fn().mockResolvedValue(MOCK_MCP) });
    await waitFor(() => expect(view.getByText("capabilities.title")).toBeTruthy());
    const tabs = view.container.querySelectorAll(".cap-tab");
    await act(async () => {
      fireEvent.click(tabs[2] as HTMLButtonElement);
    });
    await waitFor(() => expect(view.getByText("github")).toBeTruthy());
  });
});
