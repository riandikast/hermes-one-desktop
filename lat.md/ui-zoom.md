# UI zoom (Ctrl+± / Ctrl+0 / Shift+wheel)

Browser-style zoom for the whole desktop UI: `Ctrl+=`/`Ctrl+-`/`Ctrl+0` and `Shift`+mouse-wheel scale everything via Electron's native `webContents.setZoomLevel` (level n = factor 1.2^n), with the level persisted in localStorage across restarts.

The main process owns the zoom state so keyboard, menu, and wheel all hit one code path. [[src/main/zoom.ts]] is a pure module: `nextZoomLevel`/`clampZoomLevel` provide the clamped math (`ZOOM_MIN=-3.5` ≈50%, `ZOOM_MAX=3.5` ≈300%, `ZOOM_STEP=0.5` ≈20%/notch), and the `ZoomTarget` controller (`zoomBy`/`zoomReset`/`zoomApply`) applies the level and broadcasts it on `ui-zoom-changed`. `BrowserWindow` structurally satisfies `ZoomTarget`, so the module needs no Electron import and is unit-testable (`tests/zoom.test.ts`).

## Keyboard and menu

`createWindow` in [[src/main/app/start.ts#createWindow]] intercepts Ctrl+=/-/0 via `before-input-event` (`control || meta`), and the View menu items (Zoom In/Out/Actual Size) in [[src/main/app/menu.ts#buildMenu]] route through the same controller — one code path for keyboard, menu, and wheel.

Menu template changes must retain the initialized array in `buildMenu`; esbuild rejects a bare `const template` before any application bundle is produced.

[[src/shared/keyboard-shortcuts.ts#SHORTCUTS]] supplies the shared command IDs and default bindings used by Electron and renderer handlers. [[src/shared/keyboard-shortcuts.ts#bindingsFor]] preserves explicit empty overrides and platform-specific defaults; [[src/shared/keyboard-shortcuts.ts#matchesBinding]] checks exact modifiers and suppresses IME composition. [[src/shared/keyboard-shortcuts.ts#validateShortcutOverrides]] validates persisted/IPC input. Regressions: [[src/shared/keyboard-shortcuts.test.ts]]. The shared source must ship alongside shortcut consumers or both main and renderer imports fail.

## Keyboard shortcuts settings

Settings → Keyboard Shortcuts lists every command with its current chord, records a replacement, and restores defaults.

The pane lives in [[src/renderer/src/components/settings/ShortcutsPane.tsx#ShortcutsPane]] and is registered after Appearance in [[src/renderer/src/components/settings/SettingsModal.tsx#SettingsModal]]. Capture uses a capture-phase `keydown` listener, so the composer never consumes the chord. `bindingFromEvent` stores the primary modifier as `Mod`, rejects bare typing keys, and blocks any chord already assigned to another command. Escape cancels, Backspace clears a binding, and a failed write keeps the row in capture mode rather than showing an unsaved chord.

While recording, `keyboard-shortcuts:recording` sets the main-process flag and rebuilds the menu without accelerators, so a pressed chord cannot also fire its command; ending capture rebuilds with the saved chords. [[src/renderer/src/App.tsx]] calls `loadKeyboardShortcuts` at startup — without it, persisted overrides never reached the renderer. Regressions: [[src/renderer/src/components/settings/ShortcutsPane.test.tsx]], [[src/renderer/src/components/settings/SettingsModal.nav.test.tsx]].

## Renderer: persistence and wheel

[[src/renderer/src/hooks/useUiZoom.ts#useUiZoom]], mounted at the root of [[src/renderer/src/App.tsx]], restores the persisted level (`localStorage["hermes.ui.zoomLevel"]`) on mount, persists every `ui-zoom-changed` broadcast, and zooms on Shift+wheel via the accumulator in [[src/renderer/src/hooks/zoomWheel.ts#stepWheelDelta]] (one step per 100px, so trackpads feel natural).

## IPC surface

Three channels registered in [[src/main/ipc/register.ts#registerIpcHandlers]]: `zoom-by` and `zoom-apply` (handle, returning the applied level or null), plus the main→renderer `ui-zoom-changed` broadcast. The bridge is exposed on `hermesAPI` in [[src/preload/index.ts]] and mirrored in `src/preload/index.d.ts`.

## Font size (text-only scale)

Appearance › Font size scales text without scaling the window — the counterpart to the whole-UI zoom above.

`--font-scale` (default `1`) multiplies the app's type scale: every `font-size` in the app CSS is written `calc(Npx * var(--font-scale))`, and the Tailwind `--text-*` theme variables are scaled the same way so `text-sm`/`text-xs` utilities follow. Picking a step sets the factor on `:root`; padding, icons, and the layout grid keep their size, so this can never reflow the window the way zoom does.

[[src/renderer/src/components/settings/fontSize.ts#FONT_SIZE_STEPS]] holds the four steps (0.9 / 1 / 1.15 / 1.3) and persists the choice under `localStorage["hermes.fontSize"]`. [[src/renderer/src/components/settings/fontSize.ts#applyStoredFontScale]] runs from [[src/renderer/src/main.tsx]] before the first paint, so a restart never flashes the default size; [[src/renderer/src/components/settings/fontSize.ts#useFontSize]] is the store the Appearance row binds to, and the row sits directly above the interface-font row.

xterm paints into its own canvas, so CSS cannot scale it: [[src/renderer/src/screens/Command/TerminalDock.tsx#terminalFontSize]] applies the same multiplier when a terminal is created (a terminal opened earlier keeps its size until reopened).

The last-prompt and pinned-message readers use the app's reading size (13.5px mono via `.chat-hl-text`, `.chat-last-prompt-item-body`, `.chat-last-prompt-dialog-body`). They shipped at 12.5px, which stayed visibly smaller than chat text at any zoom level — the base value, not the zoom, was the bug.
