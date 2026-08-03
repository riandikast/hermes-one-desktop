// @vitest-environment node

import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scriptExtensionFor, writeTempScript } from "./run-command";

describe("run-command script writer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hermes-run-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes a multi-line command preserving content per shell kind", async () => {
    const multi = "cd src\nnpm run build\necho done";
    for (const [kind, ext] of [
      ["pwsh", "ps1"],
      ["cmd", "cmd"],
      ["sh", "sh"],
    ] as const) {
      const scriptPath = await writeTempScript(
        multi,
        kind,
        tempDir,
      );
      expect(scriptPath.endsWith(`.${ext}`)).toBe(true);
      const content = await readFile(scriptPath, "utf8");
      expect(content.replace(/^\ufeff/, "")).toBe(multi);
    }
  });

  it("maps shell kind to script extension", () => {
    expect(scriptExtensionFor("pwsh")).toBe("ps1");
    expect(scriptExtensionFor("cmd")).toBe("cmd");
    expect(scriptExtensionFor("sh")).toBe("sh");
  });

  it("writes a UTF-8 BOM for pwsh scripts so Windows PowerShell 5.1 reads UTF-8", async () => {
    const scriptPath = await writeTempScript("Write-Output 'héllo'", "pwsh", tempDir);
    const raw = await readFile(scriptPath);
    // BOM: EF BB BF
    expect(raw[0]).toBe(0xef);
    expect(raw[1]).toBe(0xbb);
    expect(raw[2]).toBe(0xbf);
  });
});
