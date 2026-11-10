# Settings modal shell

The global settings modal is a frosted-glass surface with a full-height nav rail; its size and repaint behavior are shared by every pane.

## Size and rail

`.settings-modal` fills `min(88vw, 1220px)` × `min(86vh, 880px)` with a `252px` nav rail, so grouped nav labels and the tabbed Advanced/Memory panes fit without truncation.

`min()` keeps the modal inside small windows where fixed pixel sizes used to overflow.

## Repaint stability

The modal used to flash for a frame — a "blink" the official desktop shares — because three things combined on one composited surface:

- [[src/renderer/src/components/modal/AppModal.tsx#AppModal]] animated `filter: blur(...)` on the same element that carries `backdrop-filter` (`.settings-modal`). Chromium re-rasterizes that pairing mid-animation. The content motion is now opacity/scale/offset only, with no filtered layer.
- [[src/renderer/src/components/settings/useSettingsData.ts#useSettingsData]] cleared `hermesHome` and `hermesVersion` *before* each refetch, so any `connection-config-changed` event blanked the summary rows. Loading is now non-destructive: the previous values stay until the new read resolves.
- The content column had no stable scrollbar lane, so a pane that grew while loading shifted layout on a blurred surface. `.settings-modal-content` reserves the gutter with `scrollbar-gutter: stable`.

The config panes keep their structure while loading: the tab strip and one `settings-group` card stay mounted and a single "Loading settings…" row fills the card, instead of swapping the entire pane (which re-flowed the modal and read as another blink).
