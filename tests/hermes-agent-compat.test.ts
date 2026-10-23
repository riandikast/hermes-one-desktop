import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  inspectLocalDashboardCompatibility,
  patchDashboardCompatibilitySource,
  patchDashboardEmbeddedChatSource,
  patchDashboardModelLibrarySource,
  writeCompatFileAtomically,
} from "../src/main/hermes-agent-compat";

describe("Hermes Agent dashboard compatibility patcher", () => {
  // @lat: [[backend-compatibility#Read-only audit]]
  it("audits current modular upstream without changing source or creating backups", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-audit-"));
    try {
      mkdirSync(join(dir, "hermes_cli"));
      const target = join(dir, "hermes_cli", "web_server.py");
      const source = "_DASHBOARD_EMBEDDED_CHAT_ENABLED = True\napp.include_router(_models_routes.router)\n";
      writeFileSync(target, source);
      const result = inspectLocalDashboardCompatibility(dir);
      expect(result).toMatchObject({ ok: true, compatible: true, applied: false });
      expect(result.detail).toContain("Remote saved-library CRUD requires a separate extension");
      expect(readFileSync(target, "utf-8")).toBe(source);
      expect(readdirSync(dir)).toEqual(["hermes_cli"]);
      expect(readdirSync(join(dir, "hermes_cli"))).toEqual(["web_server.py"]);
      expect(patchDashboardCompatibilitySource(source)).toMatchObject({ compatible: true, changed: false, source });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("does not claim a missing backend is compatible", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-audit-"));
    try {
      expect(inspectLocalDashboardCompatibility(dir)).toMatchObject({ ok: false, compatible: false, applied: false });
      expect(readdirSync(dir)).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("reports legacy changes as required rather than applied", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-audit-"));
    try {
      mkdirSync(join(dir, "hermes_cli"));
      const target = join(dir, "hermes_cli", "web_server.py");
      const source = 'embedded_chat: bool = False\n@app.post("/api/model/set")\nmount_spa(app)\n';
      writeFileSync(target, source);
      expect(inspectLocalDashboardCompatibility(dir)).toMatchObject({ ok: false, compatible: false, applied: false });
      expect(readFileSync(target, "utf-8")).toBe(source);
      expect(readdirSync(join(dir, "hermes_cli"))).toEqual(["web_server.py"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("keeps the About IPC read-only for local, SSH and HTTP connections", () => {
    const source = readFileSync(join(process.cwd(), "src/main/ipc/register.ts"), "utf-8");
    const handler = source.slice(source.indexOf('ipcMain.handle("check-backend-compat"'), source.indexOf("// MCP servers", source.indexOf('ipcMain.handle("check-backend-compat"')));
    expect(handler.length).toBeGreaterThan(100);
    expect(handler).toContain('conn.mode !== "local"');
    expect(handler).toContain("inspectLocalDashboardCompatibility()");
    expect(handler).not.toContain("ensureLocalDashboardCompatibility");
    expect(handler).not.toContain("ensureSshDashboardCompatibility");
  });

  it("leaves already-compatible embedded chat defaults unchanged", () => {
    const source = `
async def start_server(
    host: str = "127.0.0.1",
    embedded_chat: bool = True,
):
    pass
`;

    const result = patchDashboardEmbeddedChatSource(source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(source);
  });

  it("recognizes current upstream always-on dashboard chat as compatible", () => {
    const source = `
# In-browser Chat tab (/chat, /api/pty, /api/ws, ...). Always enabled.
_DASHBOARD_EMBEDDED_CHAT_ENABLED = True

def start_server(
    host: str = "127.0.0.1",
    port: int = 9119,
    open_browser: bool = True,
    allow_public: bool = False,
):
    pass
`;

    const result = patchDashboardEmbeddedChatSource(source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(source);
  });

  it("patches older embedded chat defaults", () => {
    const source = `
async def start_server(
    host: str = "127.0.0.1",
    embedded_chat: bool = False,
):
    pass
`;

    const result = patchDashboardEmbeddedChatSource(source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.source).toContain("embedded_chat: bool = True");
    expect(result.source).not.toContain("embedded_chat: bool = False");
  });

  it("reports incompatible source instead of making an unsafe edit", () => {
    const source = "async def start_server(): pass";

    const result = patchDashboardEmbeddedChatSource(source);

    expect(result.compatible).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(source);
  });

  it("installs the Hermes One configured model library endpoint when model REST exists", () => {
    const source = `
@app.post("/api/model/set")
async def set_model_assignment(body):
    return {"ok": True}

mount_spa(app)
`;

    const result = patchDashboardModelLibrarySource(source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.source).toContain("HERMES_ONE_MODEL_LIBRARY_COMPAT_V1");
    expect(result.source).toContain('@app.get("/api/model/library")');
    expect(result.source).toContain('@app.post("/api/model/library")');
    expect(result.source).toContain(
      '@app.patch("/api/model/library/{model_id:path}")',
    );
    expect(result.source).toContain(
      '@app.delete("/api/model/library/{model_id:path}")',
    );
    expect(
      result.source.indexOf('@app.get("/api/model/library")'),
    ).toBeLessThan(result.source.indexOf("mount_spa(app)"));
  });

  it("does not install the model library endpoint twice", () => {
    const source = `
@app.post("/api/model/set")
async def set_model_assignment(body):
    return {"ok": True}

mount_spa(app)
`;

    const installed = patchDashboardModelLibrarySource(source);
    const result = patchDashboardModelLibrarySource(installed.source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(installed.source);
  });

  it("moves a previously appended model library endpoint before the dashboard catch-all", () => {
    const source = `
@app.post("/api/model/set")
async def set_model_assignment(body):
    return {"ok": True}

mount_spa(app)

# --- HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 -------------------------------------
@app.get("/api/model/library")
def hermes_one_get_model_library():
    return {"models": []}
# --- /HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 ------------------------------------
`;

    const result = patchDashboardModelLibrarySource(source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(true);
    expect(
      result.source.indexOf('@app.get("/api/model/library")'),
    ).toBeLessThan(result.source.indexOf("mount_spa(app)"));
    expect(result.detail).toContain("Moved");
  });

  it("applies all safe dashboard compatibility patches together", () => {
    const source = `
async def start_server(
    host: str = "127.0.0.1",
    embedded_chat: bool = False,
):
    pass

@app.post("/api/model/set")
async def set_model_assignment(body):
    return {"ok": True}

mount_spa(app)
`;

    const result = patchDashboardCompatibilitySource(source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.source).toContain("embedded_chat: bool = True");
    expect(result.source).toContain("HERMES_ONE_MODEL_LIBRARY_COMPAT_V1");
  });

  it("writes patched local source through a temp file and keeps a first-run backup", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-compat-"));
    try {
      const target = join(dir, "web_server.py");
      writeFileSync(target, "original", "utf-8");

      writeCompatFileAtomically(target, "patched");

      expect(readFileSync(target, "utf-8")).toBe("patched");
      expect(readFileSync(`${target}.orig`, "utf-8")).toBe("original");
      expect(
        readdirSync(dir).filter((name) => name.includes(".hermes-one-")),
      ).toEqual([]);

      writeCompatFileAtomically(target, "patched-again");

      expect(readFileSync(target, "utf-8")).toBe("patched-again");
      expect(readFileSync(`${target}.orig`, "utf-8")).toBe("original");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
