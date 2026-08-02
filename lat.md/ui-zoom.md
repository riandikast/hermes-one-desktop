# UI zoom (Ctrl+± / Ctrl+0 / Shift+wheel)

Browser-style zoom for the whole desktop UI: `Ctrl+=`/`Ctrl+-`/`Ctrl+0` and `Shift`+mouse-wheel scale everything via Electron's native `webContents.setZoomLevel` (level n = factor 1.2^n), with the level persisted in localStorage across restarts.

The main process owns the zoom state so keyboard, menu, and wheel all hit one code path. [[src/main/zoom.ts]] is a pure module: `nextZoomLevel`/`clampZoomLevel` provide the clamped math (`ZOOM_MIN=-3.5` ≈50%, `ZOOM_MAX=3.5` ≈300%, `ZOOM_STEP=0.5` ≈20%/notch), and the `ZoomTarget` controller (`zoomBy`/`zoomReset`/`zoomApply`) applies the level and broadcasts it on `ui-zoom-changed`. `BrowserWindow` structurally satisfies `ZoomTarget`, so the module needs no Electron import and is unit-testable (`tests/zoom.test.ts`).

## Keyboard and menu

`createWindow` in [[src/main/app/start.ts#createWindow]] intercepts Ctrl+=/-/0 via `before-input-event` (`control || meta`), and the View menu items (Zoom In/Out/Actual Size) in [[src/main/app/menu.ts#buildMenu]] route through the same controller — one code path for keyboard, menu, and wheel.

## Renderer: persistence and wheel

[[src/renderer/src/hooks/useUiZoom.ts#useUiZoom]], mounted at the root of [[src/renderer/src/App.tsx]], restores the persisted level (`localStorage["hermes.ui.zoomLevel"]`) on mount, persists every `ui-zoom-changed` broadcast, and zooms on Shift+wheel via the accumulator in [[src/renderer/src/hooks/zoomWheel.ts#stepWheelDelta]] (one step per 100px, so trackpads feel natural).

## IPC surface

Three channels registered in [[src/main/ipc/register.ts#registerIpcHandlers]]: `zoom-by` and `zoom-apply` (handle, returning the applied level or null), plus the main→renderer `ui-zoom-changed` broadcast. The bridge is exposed on `hermesAPI` in [[src/preload/index.ts]] and mirrored in `src/preload/index.d.ts`.
