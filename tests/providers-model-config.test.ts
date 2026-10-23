import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Exercise the actual registration without loading unrelated Electron IPC handlers.
const source = readFileSync(resolve("src/main/ipc/register.ts"), "utf8");
const file = ts.createSourceFile("register.ts", source, ts.ScriptTarget.Latest, true);
let registration = "";
function visit(node: ts.Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(file) === "ipcMain.handle" &&
      ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "set-model-config") {
    registration = node.getText(file);
  }
  ts.forEachChild(node, visit);
}
visit(file);
if (!registration) throw new Error("Missing set-model-config registration");

describe("Providers default-model save", () => {
  // @lat: [[provider-setup#Provider setup#Default model changes do not restart bots]]
  it("persists routing, context and protocol without stopping or spawning the local gateway", async () => {
    const setModelConfig = vi.fn();
    const restartGateway = vi.fn();
    let handler: (...args: unknown[]) => Promise<boolean>;
    runInNewContext(ts.transpile(registration), {
      ipcMain: { handle: (_: string, callback: typeof handler) => { handler = callback; } },
      getConnectionConfig: () => ({ mode: "local" }),
      getModelConfig: () => ({ provider: "old", model: "old", baseUrl: "https://old.test" }),
      resolveLibraryModelEntry: () => ({ contextLength: 128000, apiMode: "chat_completions" }),
      setModelConfig,
      isGatewayRunning: () => true,
      restartGateway,
    });
    expect(await handler!(null, "custom", "new-model", "https://new.test/v1", "work")).toBe(true);
    expect(setModelConfig).toHaveBeenCalledWith("custom", "new-model", "https://new.test/v1", "work", 128000, "chat_completions");
    expect(restartGateway).not.toHaveBeenCalled();
  });
});
