import { describe, expect, it } from "vitest";
import { delimiter } from "path";
import {
  getEnhancedPath,
  hermesCliArgs,
  HERMES_PYTHON,
  HERMES_SCRIPT,
} from "../src/main/installer";

describe("installer platform wiring", () => {
  it("uses the platform path delimiter in the enhanced PATH", () => {
    const enhancedPath = getEnhancedPath();

    expect(enhancedPath).toContain(process.env.PATH || "");
    expect(enhancedPath.split(delimiter).length).toBeGreaterThan(1);
  });

  it("builds platform-specific Hermes CLI invocation args", () => {
    const args = hermesCliArgs(["--version"]);

    expect(args).toEqual([...hermesCliArgs(), "--version"]);
    if (process.platform === "win32") {
      expect(HERMES_PYTHON).toMatch(/[\\/]python\.exe$/);
      expect(HERMES_SCRIPT).toMatch(/[\\/]hermes\.exe$/);
    } else {
      expect(HERMES_PYTHON).toMatch(/[\\/]python$/);
    }
  });
});
