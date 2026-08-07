import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("child_process", () => {
  const execFileSync = vi.fn();
  return { execFileSync, default: { execFileSync } };
});
vi.mock("./installer", () => ({
  HERMES_HOME: "/tmp/h",
  HERMES_REPO: "/tmp/r",
  HERMES_PYTHON: "python3",
  hermesCliArgs: (args: string[]) => args,
  getEnhancedPath: () => "",
}));
vi.mock("./utils", () => ({
  profileHome: vi.fn(() => "/tmp/h"),
  isValidNamedProfileName: () => true,
}));

import { execFileSync } from "child_process";
import { installHubSkill, uninstallHubSkill, updateHubSkills } from "./skills";

const mockedExec = vi.mocked(execFileSync);

describe("skill hub CLI wrappers", () => {
  beforeEach(() => {
    mockedExec.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("installHubSkill runs hermes skills install <id> --yes", () => {
    mockedExec.mockReturnValue(Buffer.from("Installed ok"));
    const result = installHubSkill("skills-sh/x/y");
    expect(mockedExec).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining(["skills", "install", "skills-sh/x/y", "--yes"]),
      expect.anything(),
    );
    expect(result.success).toBe(true);
  });

  it("uninstallHubSkill runs hermes skills uninstall <name> --yes", () => {
    mockedExec.mockReturnValue(Buffer.from("ok"));
    const result = uninstallHubSkill("pdf");
    expect(mockedExec).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining(["skills", "uninstall", "pdf", "--yes"]),
      expect.anything(),
    );
    expect(result.success).toBe(true);
  });

  it("updateHubSkills runs hermes skills update and classifies failures", () => {
    mockedExec.mockReturnValue(Buffer.from("No skill named bogus"));
    const result = updateHubSkills();
    expect(mockedExec).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining(["skills", "update"]),
      expect.anything(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("No skill named");
  });
});
