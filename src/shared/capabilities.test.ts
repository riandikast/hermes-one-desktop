import { describe, expect, it } from "vitest";
import { parseHubSkill, parseHubSources, parseHubPreview, parseHubScan } from "./capabilities";

describe("capabilities payload parsers", () => {
  it("parses a hub skill search result", () => {
    const raw = {
      name: "ocr",
      identifier: "skills-sh/mr-shaper/opencode-skills-paddle-ocr/ocr",
      source: "skills.sh",
      trust_level: "community",
      description: "Indexed by skills.sh",
    };
    expect(parseHubSkill(raw)).toEqual({
      name: "ocr",
      identifier: "skills-sh/mr-shaper/opencode-skills-paddle-ocr/ocr",
      source: "skills.sh",
      trustLevel: "community",
      description: "Indexed by skills.sh",
    });
  });

  it("defaults trust_level and missing fields", () => {
    const raw = { name: "x", identifier: "i" };
    expect(parseHubSkill(raw)).toEqual({
      name: "x",
      identifier: "i",
      source: "",
      trustLevel: "community",
      description: "",
    });
  });

  it("parses hub sources with flags", () => {
    const raw = {
      sources: [
        { id: "github", label: "GitHub", rate_limited: true },
        { id: "hermes-index", label: "Official", available: true, searchable: false },
      ],
      index_available: true,
      featured: [{ name: "pdf", identifier: "official/productivity/pdf", trust_level: "trusted" }],
      installed: { "official/productivity/pdf": { name: "pdf" } },
    };
    const parsed = parseHubSources(raw);
    expect(parsed.sources[0]).toMatchObject({ id: "github", rateLimited: true });
    expect(parsed.sources[1]).toMatchObject({ id: "hermes-index", searchable: false });
    expect(parsed.indexAvailable).toBe(true);
    expect(parsed.featured[0].trustLevel).toBe("trusted");
    expect(parsed.installed["official/productivity/pdf"].name).toBe("pdf");
  });

  it("parses a hub preview", () => {
    const raw = {
      name: "pdf",
      identifier: "official/productivity/pdf",
      description: "Create PDFs",
      source: "official",
      trust_level: "trusted",
      skill_md: "# PDF\nCreate and edit PDFs.",
      files: ["SKILL.md", "helper.py"],
    };
    expect(parseHubPreview(raw)).toMatchObject({
      name: "pdf",
      skillMd: "# PDF\nCreate and edit PDFs.",
      files: ["SKILL.md", "helper.py"],
    });
  });

  it("parses a hub scan result", () => {
    const raw = {
      name: "pdf",
      identifier: "i",
      trust_level: "community",
      verdict: "caution",
      summary: "Uses network",
      policy: "ask",
      severity_counts: { critical: 0, high: 1, medium: 0, low: 2 },
      findings: [{ severity: "high", file: "x.sh", line: 3, description: "curl" }],
    };
    const parsed = parseHubScan(raw);
    expect(parsed.policy).toBe("ask");
    expect(parsed.severityCounts.high).toBe(1);
    expect(parsed.findings[0].severity).toBe("high");
  });
});
