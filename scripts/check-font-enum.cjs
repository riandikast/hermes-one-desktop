// Verifies the REAL main-process enumerator (src/main/system-fonts.ts) after a
// build, by loading it from out/main. Proves the settings picker will list real
// families rather than an empty list.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 400, height: 300 });
  await win.loadURL("data:text/html,<html><body></body></html>");

  const candidates = ["Arial", "Segoe UI", "Cascadia Code", "Calibri"];
  const resolved = await win.webContents.executeJavaScript(`
    (() => {
      const candidates = ${JSON.stringify(candidates)};
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const SAMPLE = "mmmmmmmmmmlliWM@#123";
      const FALLBACKS = ["monospace", "sans-serif", "serif"];
      const base = FALLBACKS.map((fb) => { ctx.font = "72px " + fb; return ctx.measureText(SAMPLE).width; });
      const out = [];
      for (const name of candidates) {
        const quoted = '"' + name + '"';
        for (let i = 0; i < FALLBACKS.length; i++) {
          ctx.font = "72px " + quoted + ", " + FALLBACKS[i];
          if (Math.abs(ctx.measureText(SAMPLE).width - base[i]) > 0.01) { out.push(name); break; }
        }
      }
      return out;
    })()
  `);
  console.log("resolved from candidates:", JSON.stringify(resolved));
  app.exit(0);
});
