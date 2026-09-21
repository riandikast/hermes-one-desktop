// A do-nothing Electron main: exists only so Playwright can launch a real
// Chromium and load a local HTML file for DOM/layout diagnostics.
const { app, BrowserWindow } = require("electron");
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 900, height: 700, show: true });
  win.loadURL("about:blank");
});
