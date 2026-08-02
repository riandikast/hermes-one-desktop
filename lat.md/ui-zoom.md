# UI zoom (Ctrl+± / Ctrl+0 / Shift+wheel)

Browser-style zoom for the whole desktop UI: `Ctrl+=`/`Ctrl+-`/`Ctrl+0` and `Shift`+mouse-wheel scale everything via Electron's native `webContents.setZoomLevel` (level n = factor 1.2^n), with the level persisted in localStorage across restarts.

The main process owns the zoom state so keyboard, menu, and wheel all hit one code path. [[src/main/zoom.ts]] is a pure module: `nextZoomLevel`/`clampZoomLevel` provide the clamped math (`ZOOM_MIN=-3.5` ≈50%, `ZOOM_MAX=3.5` ≈300%, `ZOOM_STEP=0.5` ≈20%/notch), and the `ZoomTarget` controller (`zoomBy`/`zoomReset`/`zoomApply`) applies the level and broadcasts it on `ui-zoom-changed`. `BrowserWindow` structurally satisfies `ZoomTarget`, so the module needs no Electron import and is unit-testable (`tests/zoom.test.ts`).

## Keyboard and menu

`createWindow` in [[src/main/app/start.ts#createWindow]] intercepts the three chords via `webContents.on("before-input-event")` (`input.key` `"="`/`"+"`/`"-"`/`"0"`, `input.code` `NumpadAdd`/`NumpadSubtract`, requiring `control || meta`); `event.preventDefault()` also suppresses the menu accelerators for the same chords, so nothing double-fires. [[src/main/app/menu.ts#buildMenu]]'s View menu items (Zoom In/Out/Actual Size) are custom `click` handlers through the same controller instead of the old `role` zoom items, so menu clicks and keyboard stay in sync.

## Renderer: persistence and wheel

[[src/renderer/src/hooks/useUiZoom.ts#useUiZoom]], mounted once at the root of [[src/renderer/src/App.tsx]], restores the persisted level (`localStorage["hermes.ui.zoomLevel"]`) via the `zoom-apply` IPC on mount, persists every `ui-zoom-changed` broadcast, and adds a capture-phase `wheel` listener (`{ passive: false }`) that zooms when `event.shiftKey` is held — deltas feed [[src/renderer/src/hooks/zoomWheel.ts#stepWheelDelta]], which accumulates to one step per 100 pixels so trackpads feel natural. Wheel/keyboard events inside the web-preview webview never reach the window listeners (separate webContents), so embedded pages are unaffected.

## IPC surface

Three channels, all registered in [[src/main/ipc/register.ts#registerIpcHandlers]]: `zoom-by` (renderer wheel gesture → delta) and `zoom-apply` (restore persisted level) are `handle` calls returning the applied level (or `null` when no window); `ui-zoom-changed` is a main→renderer broadcast carrying the new level. The renderer-facing bridge lives on `hermesAPI` in [[src/preload/index.ts]] (`zoomBy`/`zoomApply`/`onUiZoomChanged`), mirrored in `src/preload/index.d.ts`.
