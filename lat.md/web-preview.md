# Web preview webview

The chat screen can open a split-screen [[src/renderer/src/screens/Chat/WebPreviewPanel.tsx#WebPreviewPanel]] — an embedded Electron `<webview>` with a browser toolbar and an inspect-element mode — so the agent's links and locally served apps render in-app instead of an external browser.

It auto-opens when an in-app link is clicked or a web tool reports a URL, via the `web-preview:navigate` `CustomEvent` that [[src/renderer/src/screens/Chat/Chat.tsx]] listens for. Inspect mode injects a hover/click overlay into the page and feeds the picked element's pretty-printed HTML back into the chat input.

The panel's width is free-resizable: a drag handle on its left edge sets a `width` clamped between `MIN_PANEL_WIDTH` and `window.innerWidth - 360`, persisted to `localStorage` under `hermes:webPreviewWidth`. During a drag the webview's `pointer-events` are disabled so it doesn't swallow the move stream.

## Private-network HTTP

The sandboxed browser preview permits HTTP on exact RFC1918 IPv4 hosts and loopback, including standard ports. Other webviews retain their loopback high-port restriction; public HTTP stays blocked.

[[src/shared/private-web-host.ts#isPrivateWebHost]] validates canonical dotted quads before URL coercion. [[src/renderer/src/screens/Chat/browserTabs.ts#normaliseUrlInput]] defaults bare private hosts to HTTP, preserving explicit HTTPS. [[src/main/security.ts#isAllowedWebviewUrl]] checks the original host rather than allowing shortened/octal IPv4 to become a different private address; credentials and invalid ports do not gain LAN access. Existing attach/navigation gates, sandbox, web security and certificate validation remain enabled. Main-process policy changes require the user's rebuild/restart. [[tests/private-web-host.test.ts]] covers private boundaries, malformed input, public HTTP denial, standard ports and non-preview isolation without accessing a real LAN.

## Floating dialog sizing

The chat browser is hosted in the shared resizable working dialog, preserving its webviews and tab history while resized or hidden.

Use either bottom-corner resize handle or its arrow keys; outside clicks do not close it. See [[commands-terminal#Commands store + built-in terminal#Floating working dialogs]]. Standalone panel-width resizing remains unchanged.

## Attached to the chat tab

The preview header has an attach toggle. Attached, it becomes a right-side pane owned by the chat tab instead of a floating window.

[[src/renderer/src/screens/Chat/FloatingDialog.tsx#FloatingDialog]] gains optional `placementDocked` / `onTogglePlacement` props and renders the header button only when a caller opts in; the sidebar placement keeps the panel mounted, so attaching never reloads a webview or loses its tab history. [[src/renderer/src/screens/Chat/Chat.tsx]] stores the choice under `hermes.webPreview.docked.<sessionId>` and restores it per session. CSS reserves `min(440px, 46vw)` on the chat body and composer, so the pane sits beside them instead of covering input; below 640px it overlays without reserving space. Regression: [[src/renderer/src/screens/Chat/FloatingDialog.dock.test.tsx]] and the source wiring check in [[src/renderer/src/screens/Chat/chatPanels.test.ts]].


## Webview identification and HTTPS policy

The preview is the only webview allowed to load remote HTTPS; all others stay restricted to loopback HTTP. It is identified by its `partition="web-preview"` attribute, which Electron forwards to both security gates (unlike `name`).

[[src/main/security.ts#isAllowedWebviewUrl]] gains an `allowHttps` flag: HTTPS and `about:blank` are permitted only when the caller passes it. Two gates set that flag for the preview, each identifying it by a signal Electron actually exposes at that point:

- **Attach gate** — [[src/main/app/start.ts#startMainProcess]]'s `will-attach-webview` handler reads `params.partition === "web-preview"` (attributes are forwarded as a `Record<string, string>`) and, when true, calls `isAllowedWebviewUrl(src, true)`.
- **Navigation gate** — in `web-contents-created`, [[src/main/app/start.ts#startMainProcess]] calls [[src/main/security.ts#hardenAttachedWebContents]], which applies the `allowHttps` flag to web-preview navigations.

The session comparison is deliberate: `getLastWebPreferences()` is not a public Electron API (returns `undefined`), so reading attributes back from the attached webContents is unreliable — the partition session is the only signal available in `web-contents-created`. Without it, redirects (e.g. `google.com` → `www.google.com`) and subsequent navigations are wrongly blocked even though the initial attach succeeded.

Remote pages still run fully sandboxed: `hardenWebviewPreferences` forces `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true` and deletes any preload, so loading arbitrary HTTPS grants the page no host or Node access.
