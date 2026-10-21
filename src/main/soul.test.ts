// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ home: "" }));
vi.mock("./utils", async () => {
  const fs = await import("fs");
  const path = await import("path");
  return {
    profileHome: (profile?: string) =>
      !profile || profile === "default"
        ? state.home
        : path.join(state.home, "profiles", profile),
    safeWriteFile: (file: string, content: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf-8");
    },
  };
});
import { readSoul, writeSoul } from "./soul";
beforeEach(() => {
  state.home = mkdtempSync(join(tmpdir(), "soul-settings-"));
});
afterEach(() => {
  rmSync(state.home, { recursive: true, force: true });
});

// @lat: [[lat.md/soul-settings#Soul settings#Filesystem isolation]]
it("round-trips exact markdown in isolated profiles without touching the real home", () => {
  const markdown =
    "\uFEFF# Persona\r\n\r\n- tiếng Việt  \r\n```js\nconst x = 1;\n```\r\n";
  expect(readSoul("coder")).toBe("");
  expect(writeSoul(markdown, "coder")).toBe(true);
  expect(readSoul("coder")).toBe(markdown);
  expect(
    readFileSync(join(state.home, "profiles", "coder", "SOUL.md"), "utf-8"),
  ).toBe(markdown);
  expect(readSoul("default")).toBe("");
});

it("propagates read failures instead of showing an empty writable editor", () => {
  mkdirSync(join(state.home, "SOUL.md"));
  expect(() => readSoul("default")).toThrow();
});
