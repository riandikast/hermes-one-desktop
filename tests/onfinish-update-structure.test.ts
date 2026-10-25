import { readFileSync } from "fs";
import { expect, it } from "vitest";

it("keeps popup and queue/list independently bounded and scrollable", () => {
  const css = readFileSync("src/renderer/src/assets/main.css", "utf8");
  expect(css.length).toBeGreaterThan(1000);
  for (const selector of ["chat-onfinish-dropdown", "chat-onfinish-scroll", "chat-onfinish-queue"]) {
    const rule = css.match(new RegExp(`\\.${selector} \\{([^}]+)`))?.[1];
    expect(rule).toMatch(/max-height:/);
    expect(rule).toMatch(/overflow-y: auto/);
  }
});

it("keeps Send key inside the renderer instead of a native popup", () => {
  const source = readFileSync("src/renderer/src/screens/Chat/OnFinishChip.tsx", "utf8");
  expect(source).toContain('size={5} aria-label="On-Finish key"');
  const css = readFileSync("src/renderer/src/assets/main.css", "utf8");
  const rule = css.match(/select\.chat-onfinish-keys \{([^}]+)/)?.[1];
  expect(rule).toContain("100dvh");
  expect(rule).toContain("overflow-y: auto");
});

it("wires a distinct backend check across IPC and both preload contracts", () => {
  for (const file of ["src/main/ipc/register.ts", "src/preload/index.ts"]) {
    expect(readFileSync(file, "utf8")).toContain('"check-backend-update"');
  }
  expect(readFileSync("src/preload/index.d.ts", "utf8")).toContain("checkBackendUpdate:");
  const installer = readFileSync("src/main/installer.ts", "utf8");
  expect(installer).toContain("await assertOfficialBackendUpdateTarget(HERMES_REPO)");
});
