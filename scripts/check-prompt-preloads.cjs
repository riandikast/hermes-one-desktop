// Run after building: node scripts/check-prompt-preloads.cjs
const { _electron: electron } = require('playwright');
const { writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hermes-preload-check-'));
  let app;
  try {
    const main = path.join(dir, 'main.cjs');
    // Electron provides its built-in module inside the launched main process.
    writeFileSync(main, `const {app,BrowserWindow,ipcMain}=require('electron');
      global.received=[]; global.preloadErrors=[];
      ipcMain.on('approval-submit',(_,v)=>global.received.push(['approval-submit',v]));
      ipcMain.on('askpass-submit',(_,v)=>global.received.push(['askpass-submit',v]));
      app.whenReady().then(()=>{const w=new BrowserWindow({show:false});w.loadURL('about:blank')});`);
    app = await electron.launch({args:[main]});
    for (const name of ['approval', 'askpass']) {
      await app.evaluate(async ({BrowserWindow}, {preload}) => {
        const win = new BrowserWindow({show:true,width:520,height:360,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});
        win.webContents.on('preload-error',(_,p,e)=>global.preloadErrors.push(e.message));
        await win.loadURL('data:text/html,' + encodeURIComponent(`<div id="approval-actions"><button data-choice="deny">Deny test request</button></div>`));
      }, {preload:path.resolve('out/preload/'+name+'.js')});
      const win = app.windows().at(-1);
      await win.getByRole('button', {name:'Deny test request'}).click();
      await new Promise(r=>setTimeout(r,150));
      const state = await app.evaluate(()=>({received:global.received,errors:global.preloadErrors}));
      assert.deepEqual(state.errors, [], name+' preload must load');
      assert.deepEqual(state.received.at(-1), ['approval-submit','deny'], name+' click must deliver IPC');
      await win.close();
      await app.evaluate(()=>{global.received=[]});
      console.log(name+': real sandboxed Electron click delivered denial IPC');
    }
  } finally { if(app) await app.close(); rmSync(dir,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1});
