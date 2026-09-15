import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from "fs";
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
    const width = 520;
    const height = 360;
    const preload = existsSync(join(__dirname, "../preload/approval.js"))
      ? join(__dirname, "../preload/approval.js")
      : join(__dirname, "../preload/askpass.js");

    const win = new BrowserWindow({
      width,
      height,
      show: false,
      parent: parent ?? undefined,
      modal: !!parent,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      title: "Hermes needs your approval",
      backgroundColor: "#09090b",
      webPreferences: {
        preload,
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

    win.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        finish("deny");
      }
    });

    if (parent && !parent.isDestroyed()) {
      const parentBounds = parent.getBounds();
      const x = Math.round(parentBounds.x + (parentBounds.width - width) / 2);
      const y = Math.round(parentBounds.y + (parentBounds.height - height) / 2);
      win.setPosition(x, y);
    } else {
      win.center();
    }

    const showFocused = (): void => {
      if (settled || win.isDestroyed()) return;
      win.setAlwaysOnTop(true, "floating");
      win.show();
      win.moveTop();
      win.focus();
      win.webContents.focus();
      win.setAlwaysOnTop(false);
    };
    win.webContents.once("did-finish-load", showFocused);
    win.webContents.once("did-fail-load", () => finish("deny"));

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
      let btnClass = "btn btn-secondary";
      if (choice === "deny") {
        btnClass = "btn btn-outline";
      } else if (choice === "once") {
        btnClass = "btn btn-primary";
      }
      return `<button class="${btnClass}" data-choice="${esc(choice)}" type="button">${label}</button>`;
    })
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
<style>
  :root {
    --bg: #09090b;
    --fg: #fafafa;
    --muted: #a1a1aa;
    --border: #27272a;
    --surface: #09090b;
    --primary: #fafafa;
    --primary-fg: #18181b;
    --secondary: #18181b;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff;
      --fg: #09090b;
      --muted: #71717a;
      --border: #e4e4e7;
      --surface: #ffffff;
      --primary: #18181b;
      --primary-fg: #fafafa;
      --secondary: #f4f4f5;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; user-select: none; overflow: hidden; }
  .dialog { display: flex; flex-direction: column; height: 100%; padding: 20px 22px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); position: relative; }
  .header { -webkit-app-region: drag; padding-right: 36px; margin-bottom: 12px; }
  .badge { display: inline-flex; align-items: center; border-radius: 9999px; border: 1px solid var(--border); background: var(--secondary); padding: 2px 8px; font-size: 11px; font-weight: 500; color: var(--muted); margin-bottom: 8px; }
  .title { font-size: 16px; font-weight: 600; line-height: 1.3; letter-spacing: -0.015em; color: var(--fg); margin-bottom: 4px; }
  .description { font-size: 13px; line-height: 1.4; color: var(--muted); }
  .command-wrap { flex: 1; display: flex; flex-direction: column; min-height: 0; margin-bottom: 16px; }
  .command-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 6px; }
  .command { flex: 1; -webkit-app-region: no-drag; background: #000; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; line-height: 1.45; color: #38bdf8; overflow-y: auto; white-space: pre-wrap; word-break: break-all; user-select: text; }
  .command::-webkit-scrollbar { width: 6px; }
  .command::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  .footer { -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .btn { -webkit-app-region: no-drag; height: 34px; padding: 0 14px; border-radius: 6px; font-size: 13px; font-weight: 500; font-family: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; outline: none; transition: background 0.15s, border-color 0.15s, color 0.15s; }
  .btn:focus-visible { outline: 2px solid #a1a1aa; outline-offset: 2px; }
  .btn-primary { background: var(--primary); color: var(--primary-fg); border: 1px solid var(--primary); font-weight: 600; }
  .btn-primary:hover { opacity: 0.9; }
  .btn-secondary { background: var(--secondary); color: var(--fg); border: 1px solid var(--border); }
  .btn-secondary:hover { opacity: 0.85; }
  .btn-outline { background: transparent; color: var(--fg); border: 1px solid var(--border); }
  .btn-outline:hover { background: var(--secondary); }
  .close-btn { -webkit-app-region: no-drag; position: absolute; top: 16px; right: 16px; width: 28px; height: 28px; border-radius: 6px; border: none; background: transparent; color: var(--muted); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.15s, color 0.15s; }
  .close-btn:hover { background: var(--border); color: var(--fg); }
</style></head>
<body>
  <div class="dialog">
    <button class="close-btn" id="approval-deny" aria-label="Close" type="button">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11.78 3.22a.75.75 0 0 0-1.06 0L7.5 6.44 4.28 3.22a.75.75 0 0 0-1.06 1.06L6.44 7.5l-3.22 3.28a.75.75 0 1 0 1.06 1.06L7.5 8.56l3.22 3.22a.75.75 0 0 0 1.06-1.06L8.56 7.5l3.22-3.22a.75.75 0 0 0 0-1.06Z" fill="currentColor"/>
      </svg>
    </button>
    <div class="header">
      <div class="badge">Security Prompt</div>
      <h2 class="title">${esc(opts.description)}</h2>
      <p class="description">Permission is requested to run this command.</p>
    </div>
    <div class="command-wrap">
      <div class="command-label">Command</div>
      <div class="command">${esc(opts.command || "(no command details)")}</div>
    </div>
    <div class="footer" id="approval-actions">
      ${buttons}
    </div>
  </div>
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
