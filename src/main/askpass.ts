import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as net from "net";
import {
  APPROVAL_SUBMIT_CHANNEL,
  ASKPASS_SUBMIT_CHANNEL,
} from "../shared/askpass";

export interface AskpassHandle {
  env: Record<string, string>;
  pathPrepend: string;
  cleanup: () => void;
}

/**
 * Bridge sudo's password prompt to a GUI dialog.
 *
 * Writes two scripts into a temp dir:
 *   - askpass.sh: invoked by `sudo -A`. Talks to a unix socket we listen on,
 *     receives the password, prints it to stdout.
 *   - sudo: a PATH shim that forces real sudo to use `-A`, so install
 *     scripts that call plain `sudo` still trigger our askpass.
 *
 * Caller must invoke `cleanup()` when the install/update finishes.
 */
export async function setupAskpass(
  parent: BrowserWindow | null,
): Promise<AskpassHandle> {
  const dir = mkdtempSync(join(tmpdir(), "hermes-askpass-"));
  const sockPath = join(dir, "ipc.sock");
  const askpassPath = join(dir, "askpass.sh");
  const sudoShim = join(dir, "sudo");

  // The askpass program. sudo invokes this with a single arg (the prompt).
  // We pipe through python3 because it's available on every macOS/Linux box
  // that can run hermes-agent (which itself requires python).
  writeFileSync(
    askpassPath,
    `#!/bin/sh
exec /usr/bin/env python3 - "$@" <<'PY'
import socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(${JSON.stringify(sockPath)})
prompt = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "Password:"
s.sendall((prompt + "\\n").encode())
buf = b""
while True:
    chunk = s.recv(4096)
    if not chunk: break
    buf += chunk
if not buf:
    sys.exit(1)
sys.stdout.buffer.write(buf)
PY
`,
  );
  chmodSync(askpassPath, 0o755);

  // PATH shim: any plain `sudo` call gets rewritten to `sudo -A`.
  // /usr/bin/sudo is the standard location on macOS and ~all Linux distros.
  writeFileSync(
    sudoShim,
    `#!/bin/sh
for p in /usr/bin/sudo /bin/sudo /usr/local/bin/sudo; do
  if [ -x "$p" ]; then exec "$p" -A "$@"; fi
done
echo "sudo not found" >&2
exit 1
`,
  );
  chmodSync(sudoShim, 0o755);

  const server = net.createServer((conn) => {
    let buf = "";
    conn.on("data", async (chunk) => {
      buf += chunk.toString();
      if (!buf.includes("\n")) return;
      const prompt = buf.split("\n")[0];
      const pw = await showPasswordDialog(parent, prompt);
      if (pw === null) {
        conn.end();
      } else {
        conn.end(pw + "\n");
      }
    });
    conn.on("error", () => {
      /* connection errors are non-fatal */
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(sockPath, () => {
      try {
        chmodSync(sockPath, 0o600);
      } catch {
        /* non-fatal */
      }
      resolve();
    });
  });

  return {
    env: { SUDO_ASKPASS: askpassPath },
    pathPrepend: dir,
    cleanup: () => {
      try {
        server.close();
      } catch {
        /* non-fatal */
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* non-fatal */
      }
    },
  };
}

/**
 * Show a hardened, modal password/secret prompt and resolve with the entered
 * value (or null on cancel). CSP-locked (`default-src 'none'`), sandboxed,
 * ephemeral data-URL — the value is never persisted. Reused by both the
 * installer's sudo askpass bridge and the mid-turn gateway sudo/secret prompts
 * (see `gatewayPrompt.ts`). `title` / `heading` default to the installer's
 * wording so existing callers are unchanged.
 */
export async function showPasswordDialog(
  parent: BrowserWindow | null,
  prompt: string,
  opts: { title?: string; heading?: string } = {},
): Promise<string | null> {
  const title = opts.title ?? "Administrator Password Required";
  const heading = opts.heading ?? "The installer needs your password";
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 460,
      height: 240,
      parent: parent ?? undefined,
      modal: !!parent,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title,
      webPreferences: {
        preload: join(__dirname, "../preload/askpass.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
      },
    });

    let settled = false;
    function finish(value: string | null): void {
      if (settled) return;
      settled = true;
      ipcMain.removeListener(ASKPASS_SUBMIT_CHANNEL, onSubmit);
      try {
        if (!win.isDestroyed()) win.close();
      } catch {
        /* non-fatal */
      }
      resolve(value);
    }

    function onSubmit(event: IpcMainEvent, value: unknown): void {
      if (event.sender !== win.webContents) return;
      if (typeof value === "string") {
        finish(value);
      } else if (value === null) {
        finish(null);
      }
    }

    ipcMain.on(ASKPASS_SUBMIT_CHANNEL, onSubmit);
    win.on("closed", () => finish(null));
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );

    const html = buildDialogHtml(prompt, heading);
    win.loadURL(
      "data:text/html;charset=UTF-8;base64," +
        Buffer.from(html).toString("base64"),
    );
  });
}

export interface ApprovalDialogOptions {
  choices: string[];
  command: string;
  description: string;
  labels: Record<string, string>;
}

/** Show a themed, renderer-backed approval modal. Approval is not sensitive,
 * but it still uses the same isolated, ephemeral window boundary as askpass. */
export async function showApprovalDialog(
  parent: BrowserWindow | null,
  opts: ApprovalDialogOptions,
): Promise<string> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 360,
      parent: parent ?? undefined,
      modal: !!parent,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      title: "Hermes needs your approval",
      backgroundColor: "#212121",
      webPreferences: {
        preload: join(__dirname, "../preload/approval.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
      },
    });

    let settled = false;
    function finish(value: string): void {
      if (settled) return;
      settled = true;
      ipcMain.removeListener(APPROVAL_SUBMIT_CHANNEL, onSubmit);
      try {
        if (!win.isDestroyed()) win.close();
      } catch {
        /* non-fatal */
      }
      resolve(opts.choices.includes(value) ? value : "deny");
    }

    function onSubmit(event: IpcMainEvent, value: unknown): void {
      if (event.sender !== win.webContents) return;
      if (typeof value === "string") finish(value);
    }

    ipcMain.on(APPROVAL_SUBMIT_CHANNEL, onSubmit);
    win.on("closed", () => finish("deny"));
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("will-attach-webview", (event) => event.preventDefault());

    const html = buildApprovalDialogHtml(opts);
    win.loadURL(
      "data:text/html;charset=UTF-8;base64," +
        Buffer.from(html).toString("base64"),
    );
  });
}

function buildApprovalDialogHtml(opts: ApprovalDialogOptions): string {
  const esc = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const buttons = opts.choices
    .map((choice) => {
      const label = esc(opts.labels[choice] ?? choice);
      const kind = choice === "deny" ? "secondary" : "primary";
      return `<button class="button ${kind}" data-choice="${esc(choice)}">${label}</button>`;
    })
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
<style>
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; }
  body { background: #212121; color: #f4f4f5; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .window { min-height: 100%; padding: 18px; display: flex; flex-direction: column; gap: 14px; }
  .titlebar { height: 22px; display: flex; align-items: center; justify-content: space-between; -webkit-app-region: drag; }
  .brand { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 650; letter-spacing: .01em; }
  .brand-mark { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 7px; background: #7c5cff; color: white; font-size: 11px; font-weight: 800; }
  .close { -webkit-app-region: no-drag; border: 0; background: transparent; color: #a1a1aa; font-size: 18px; line-height: 18px; cursor: pointer; padding: 0 3px; }
  .close:hover { color: #fff; }
  .card { flex: 1; padding: 18px; border: 1px solid #3f3f46; border-radius: 14px; background: #2a2a2d; box-shadow: 0 12px 30px rgb(0 0 0 / 24%); }
  .eyebrow { color: #a78bfa; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  h1 { margin: 7px 0 8px; font-size: 18px; line-height: 1.25; font-weight: 650; }
  .description { margin: 0 0 14px; color: #c4c4cc; line-height: 1.45; }
  .command { max-height: 92px; overflow: auto; padding: 11px 12px; border: 1px solid #45454d; border-radius: 9px; background: #1f1f22; color: #e4e4e7; font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .button { min-height: 34px; padding: 0 13px; border-radius: 8px; border: 1px solid transparent; font: 600 12px inherit; cursor: pointer; }
  .button.primary { background: #7c5cff; color: white; }
  .button.primary:hover, .button.primary:focus-visible { background: #8b70ff; }
  .button.secondary { border-color: #55555f; background: #35353a; color: #f4f4f5; }
  .button.secondary:hover, .button.secondary:focus-visible { background: #44444b; }
  button:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
  @media (prefers-color-scheme: light) {
    body { background: #f5f5f7; color: #202024; }
    .card { border-color: #dedee5; background: #fff; box-shadow: 0 12px 30px rgb(0 0 0 / 12%); }
    .description { color: #5d5d68; }
    .command { border-color: #dedee5; background: #f4f4f6; color: #303039; }
    .close { color: #777783; }
    .close:hover { color: #202024; }
    .button.secondary { border-color: #d0d0d8; background: #f0f0f3; color: #303039; }
    .button.secondary:hover { background: #e4e4e9; }
  }
</style></head>
<body>
  <main class="window">
    <header class="titlebar"><div class="brand"><span class="brand-mark">H</span><span>Hermes One</span></div><button class="close" id="approval-deny" aria-label="Close">×</button></header>
    <section class="card">
      <div class="eyebrow">Approval required</div>
      <h1>${esc(opts.description)}</h1>
      <div class="command">${esc(opts.command || "The agent requested permission to continue.")}</div>
      <div class="actions" id="approval-actions">${buttons}</div>
    </section>
  </main>
</body></html>`;
}

function buildDialogHtml(prompt: string, heading: string): string {
  const esc = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const safePrompt = esc(prompt);
  const safeHeading = esc(heading);
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
<style>
  html, body { margin:0; padding:0; height:100%; }
  body { font-family:-apple-system,system-ui,sans-serif; background:#1e1e1e; color:#eee; padding:20px; box-sizing:border-box; }
  .title { font-size:14px; font-weight:600; margin-bottom:6px; }
  .prompt { font-size:12px; line-height:1.5; margin-bottom:14px; color:#bbb; white-space:pre-wrap; word-break:break-word; }
  input { width:100%; padding:8px 10px; border-radius:6px; border:1px solid #444; background:#2a2a2a; color:#fff; font-size:14px; box-sizing:border-box; outline:none; }
  input:focus { border-color:#2563eb; }
  .row { display:flex; gap:8px; justify-content:flex-end; margin-top:18px; }
  button { padding:6px 14px; border-radius:6px; border:1px solid #444; background:#333; color:#fff; cursor:pointer; font-size:13px; font-family:inherit; }
  button.primary { background:#2563eb; border-color:#2563eb; }
  button:hover { opacity:0.9; }
</style></head>
<body>
<div class="title">${safeHeading}</div>
<div class="prompt">${safePrompt}</div>
<input id="pw" type="password" autofocus autocomplete="off" />
<div class="row">
  <button id="cancel">Cancel</button>
  <button id="ok" class="primary">OK</button>
</div>
</body></html>`;
}
