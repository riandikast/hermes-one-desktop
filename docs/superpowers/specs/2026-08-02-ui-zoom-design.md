# UI Zoom (Ctrl+± / Ctrl+0 / Shift+wheel) — Design

Date: 2026-08-02
Status: Proposed

## Context

Hermes Desktop (`C:\tmp\hd`, Electron app, Windows-first) currently has no
reliable way to scale the UI. The View menu declares the standard `resetZoom` /
`zoomIn` / `zoomOut` roles (`src/main/app/menu.ts:62-64`), but the menu bar is
hidden (`autoHideMenuBar: true` in `src/main/app/start.ts:176`), so the
accelerators are undiscoverable and the user reports scaling doesn't work.
There is no wheel-based zoom anywhere.

Goal: browser-style zoom (like Chrome) — `Ctrl+=` / `Ctrl+-` / `Ctrl+0` and
`Shift`+mouse-wheel, scaling the whole UI, with the zoom level persisted across
restarts.

## Approach

Use Electron's native **`webContents.setZoomLevel()`** — it scales everything
(including scrollbars), is GPU-composited, and matches Chrome's zoom semantics:
level `n` = factor `1.2^n` (level 1 ≈ 120%).

A small zoom controller lives in the **main process** (single owner of the zoom
state), with the renderer only forwarding wheel gestures and persisting the
level. Keyboard shortcuts are intercepted in main via
`webContents.on("before-input-event")` — this also lets us `preventDefault()`,
which suppresses the existing menu role accelerators so nothing double-fires.

### Why before-input-event in main (vs renderer keydown)

- Works on every screen (splash/welcome/setup/main) without touching each
  screen's keydown handlers.
- `event.preventDefault()` in `before-input-event` blocks both the page
  keydown AND the menu shortcut for the same key — we replace the menu zoom
  roles with custom items that route through the same controller, so keyboard,
  menu, and wheel all hit one code path.

## Zoom parameters

| Constant | Value | Meaning |
|---|---|---|
| `ZOOM_MIN` | -3.5 | ≈ 50% |
| `ZOOM_MAX` | 3.5 | ≈ 300% |
| `ZOOM_STEP` | 0.5 | one notch ≈ 20% (matches Electron's 1.2^n) |

`nextZoomLevel(current, delta)` is a pure clamp — unit-testable without Electron.

## Architecture

### New file: `src/main/zoom.ts`

Pure logic + a tiny controller:

```ts
export const ZOOM_MIN = -3.5;
export const ZOOM_MAX = 3.5;
export const ZOOM_STEP = 0.5;

export function nextZoomLevel(current: number, delta: number): number;
export function clampZoomLevel(level: number): number;

// Controller (Electron types)
export function zoomBy(win: BrowserWindow, delta: number): number;   // applies, broadcasts, returns new level
export function zoomReset(win: BrowserWindow): void;
export function zoomApply(win: BrowserWindow, level: number): number; // clamped set + broadcast
```

All three controller functions clamp, call `win.webContents.setZoomLevel(...)`,
then broadcast the new level to the renderer via `webContents.send("ui-zoom-changed", level)`.
`zoomApply` is used by the renderer to restore the persisted level on launch.

### `src/main/app/start.ts` — keyboard interception

In `createWindow()`, after the window exists:

```ts
mainWindow.webContents.on("before-input-event", (event, input) => {
  if (input.type !== "keyDown") return;
  const zoomMod = input.control || input.meta;
  if (!zoomMod) return;
  const key = input.key;
  const code = input.code;
  if (key === "+" || key === "=" || code === "NumpadAdd") {
    event.preventDefault();
    zoomBy(mainWindow, 1);
  } else if (key === "-" || code === "NumpadSubtract") {
    event.preventDefault();
    zoomBy(mainWindow, -1);
  } else if (key === "0") {
    event.preventDefault();
    zoomReset(mainWindow);
  }
});
```

(Key = `"="` for `Ctrl+=`, `"+"` for `Ctrl+Shift+=`; numpad reports
`NumpadAdd`/`NumpadSubtract` — all covered. `Ctrl+0` resets.)

### `src/main/app/menu.ts` — replace zoom roles

Replace the three role items with custom items routed through the controller so
menu clicks and keyboard shortcuts stay in sync:

```ts
{ label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: () => zoomBy(getMainWindow()!, 1) },
{ label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => zoomBy(getMainWindow()!, -1) },
{ label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => zoomReset(getMainWindow()!) },
```

The `before-input-event` handler calls `preventDefault()` for these keys, which
also suppresses the menu accelerators — no double-zoom. `getMainWindow()` is
guarded (non-null when the menu is usable).

### IPC — `src/main/ipc/register.ts`

`registerIpcHandlers` already receives `getMainWindow` in its deps; add three
handlers:

| Channel | Kind | Payload | Purpose |
|---|---|---|---|
| `zoom-by` | handle | `delta: number` | renderer wheel gesture → zoom |
| `zoom-apply` | handle | `level: number` | renderer restores persisted level on mount |
| `ui-zoom-changed` | send (main→renderer) | `level: number` | broadcast after every zoom change |

`zoom-by` / `zoom-apply` clamp internally and return the applied level.

### `src/preload/index.ts` + `src/preload/index.d.ts`

Add to the `hermesAPI` bridge (and the ambient `index.d.ts` mirror):

```ts
zoomBy: (delta: number) => Promise<number | null>,
zoomApply: (level: number) => Promise<number | null>,
onUiZoomChanged: (callback: (level: number) => void) => () => void,
```

### New renderer hook: `src/renderer/src/hooks/useUiZoom.ts`

Mounted once at the App root (covers every screen):

1. **Restore + persist**: on mount, read `localStorage["hermes.ui.zoomLevel"]`
   (numeric), call `zoomApply`. Subscribe to `onUiZoomChanged` → write level
   back to localStorage.
2. **Shift+wheel**: capture-phase `wheel` listener with `{ passive: false }`.
   When `e.shiftKey` → `e.preventDefault()`, feed `e.deltaY` through a small
   accumulator; every 100 accumulated pixels = one zoom step
   (`zoomBy(±1)`). Accumulation makes trackpads feel natural (Chrome-like)
   instead of one notch per event burst.

Pure accumulator helper `stepWheelDelta(acc, deltaY): { steps, remaining }`
exported for unit tests.

### `src/renderer/src/App.tsx`

Call `useUiZoom()` at the top of `App` (inside providers). Wheel handler must
be active on all screens, so it lives at the root, not in Layout.

## Edge cases / decisions

- **Webview (web-preview)**: separate webContents — wheel/keyboard events there
  never reach our window listeners; unaffected.
- **Text inputs / editable areas**: zoom works everywhere (native zoom);
  Ctrl+wheel is left alone (Chromium native behavior), only Shift+wheel and the
  three keyboard chords are customized.
- **Ctrl+0**: careful — `input.key === "0"` only when no shift; `Ctrl+Shift+0`
  stays a no-op.
- **Clamping**: `setZoomLevel` outside our range is prevented by
  `nextZoomLevel`/`clampZoomLevel` — no runaway zoom.
- **macOS**: `input.meta` covers Cmd; menu accelerators use `CmdOrCtrl`.
  Behavior identical.
- **Persistence is renderer-side localStorage** (survives restarts; no new
  config-file plumbing). First launch with no stored value = level 0 (100%).

## Files changed

| File | Change |
|---|---|
| `src/main/zoom.ts` | NEW — constants, pure clamp/step, controller |
| `src/main/app/start.ts` | before-input-event keyboard interception |
| `src/main/app/menu.ts` | zoom roles → custom items |
| `src/main/ipc/register.ts` | 3 zoom IPC handlers |
| `src/preload/index.ts` | bridge: zoomBy / zoomApply / onUiZoomChanged |
| `src/preload/index.d.ts` | ambient type mirror |
| `src/renderer/src/hooks/useUiZoom.ts` | NEW — restore/persist + Shift+wheel |
| `src/renderer/src/App.tsx` | mount hook at root |
| `tests/zoom.test.ts` | NEW — nextZoomLevel clamp/step, wheel accumulator |
| `docs/AGENTS.md` | one-line feature note (repo convention) |

## Test plan

- `tests/zoom.test.ts` (vitest, no Electron needed — pure functions):
  - `nextZoomLevel` clamps at both ends; steps by `ZOOM_STEP`; delta 0 = identity.
  - `clampZoomLevel` clamps valid/edge values.
  - `stepWheelDelta` produces 0 steps under threshold, 1 step at/above, N steps
    for large deltas, correct remainder, handles negative (zoom-out) direction.
- Manual smoke: build portable, verify Ctrl+=/-/0 on every screen, Shift+wheel
  zoom + no page scroll while shifting, persistence across relaunch, web-preview
  webview unaffected, zoom clamps at 50%/300%.

## Out of scope

- Per-screen zoom, custom zoom % picker, pinch-to-zoom on touchpads, changing
  the persisted storage location (localStorage key `hermes.ui.zoomLevel`).
