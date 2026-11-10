# Settings modal shell

The global settings modal uses a quiet two-tone surface, a full-height nav rail and compact controls shared across every pane.

## Size and rail

`.settings-modal` fills `min(88vw, 1220px)` × `min(86vh, 880px)` with a `252px` nav rail, so grouped nav labels and the tabbed Advanced/Memory panes fit without truncation.

`min()` keeps the modal inside small windows where fixed pixel sizes used to overflow.

## Compact settings design

PI-Desktop inspires the visual hierarchy: quiet navigation, a clear page title, compact label-and-control rows, and explanations available on demand rather than permanent paragraphs.

The reference is `vastsa/PI-Desktop` at `4ad0094e87b3c9ab75653a770f67f0d09abd63a4`, specifically its settings stylesheet and row primitives. Hermes keeps its own theme colors, existing settings destinations, tabs, storage and confirmations.

[[src/renderer/src/components/settings/SettingsModal.tsx]] adds the active page heading and `aria-current` navigation. Its local `SettingsModal.css` gives every pane the same solid surfaces and row spacing without changing unrelated app screens or imposing a theme.

Static explanations use native expandable help, operable by pointer and keyboard. Help expands in normal flow so the modal cannot clip a floating tooltip. Live status, errors, privacy disclosures, destructive-action warnings and actual setting values stay visible.

[[src/renderer/src/components/settings/SettingsHint.tsx]] preserves description IDs on the help content rather than the trigger, keeping existing `aria-describedby` bindings meaningful. Small windows use a horizontal navigation strip rather than a cramped sidebar.

## Repaint stability

The modal used to flash for a frame — a "blink" the official desktop shares — because three things combined on one composited surface:

- [[src/renderer/src/components/modal/AppModal.tsx#AppModal]] animated `filter: blur(...)` on the same element that carries `backdrop-filter` (`.settings-modal`). Chromium re-rasterizes that pairing mid-animation. The content motion is now opacity/scale/offset only, with no filtered layer.
- [[src/renderer/src/components/settings/useSettingsData.ts#useSettingsData]] cleared `hermesHome` and `hermesVersion` *before* each refetch, so any `connection-config-changed` event blanked the summary rows. Loading is now non-destructive: the previous values stay until the new read resolves.
- The content column had no stable scrollbar lane, so a pane that grew while loading shifted layout on a blurred surface. `.settings-modal-content` reserves the gutter with `scrollbar-gutter: stable`.

The config panes keep their structure while loading: the tab strip and one `settings-group` card stay mounted and a single "Loading settings…" row fills the card, instead of swapping the entire pane (which re-flowed the modal and read as another blink).
