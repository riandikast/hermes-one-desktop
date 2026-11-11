# Inline visualizations

Agent-authored HTML shown beside the transcript in a sandboxed right rail. Opt-in; off until the user turns it on in Appearance.

The feature follows the PI-Desktop idea (a fenced, self-contained visualization the assistant writes for the conversation) without a file protocol or a bundled chart library. The renderer executes only a complete `html` fence from the newest assistant messages.

## Appearance toggle

One settings row controls the surface; it is stored locally and broadcast to every mounted consumer.

`hermes.inlineVisualizations` is read by [[src/renderer/src/components/settings/inlineVisualizations.ts#readInlineVisualizations]] and exposed through `useInlineVisualizations`. The row sits directly below Tool calls animation in [[src/renderer/src/components/settings/AppearancePane.tsx#AppearancePane]], so both preview surfaces are configured together. A failed `localStorage` write leaves the checkbox unchanged and shows an inline error.

## Extraction contract

Only a fenced block whose language is `html`, `htm`, or `xhtml` becomes a visualization; the last fence in a reply wins.

[[src/renderer/src/screens/Chat/visualizationPreview.ts#extractInlineVisualization]] scans fences with three or more backticks or tildes. An unterminated fence is returned with `complete: false`; the Chat rail waits for the closing fence before mounting the frame, so a half-written document never executes. Fragments over 2 MiB are ignored. The title comes from `<title>`, then the first `h1`/`h2`, then a generic label.

## Sandbox

The frame is opaque-origin and network-free; generated markup never runs with the app's privileges.

[[src/renderer/src/screens/Chat/ChatVisualizationPreview.tsx#VisualizationPreview]] renders an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`, so it cannot read the parent DOM, storage, or preload bridge. [[src/renderer/src/screens/Chat/visualizationPreview.ts#buildVisualizationDocument]] adds a document CSP (`default-src 'none'`, inline scripts/styles only, `connect-src 'none'`, no frames/forms/objects) and a Permissions-Policy that denies camera, microphone, geolocation and clipboard. Theme colors are copied as `--` variables so the fragment follows light/dark without reaching the app.

## Right rail and switcher

The visualization and the live file preview share one right rail; a compact switch appears only when both have content.

[[src/renderer/src/screens/Chat/Chat.tsx#Chat]] computes the newest complete visualization, lets an explicit Files/Visualization choice win while that surface exists, and otherwise prefers files during a running turn and the visualization afterwards ([[src/renderer/src/screens/Chat/visualizationPreview.ts#chooseSidePreview]]). [[src/renderer/src/screens/Chat/ToolFilePreview.tsx#ToolFilePreview]] gains a Visualization button in its tab strip; the visualization panel offers Files back. Closing the panel suppresses that exact visualization until a different one appears.

## Agent instruction

New sessions receive the fenced-HTML contract; existing sessions keep their original system context.

When the toggle is on, [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] appends [[src/renderer/src/components/settings/inlineVisualizations.ts#INLINE_VISUALIZATION_PROMPT]] to the session-create system parts. The instruction asks for one self-contained HTML fragment with inline SVG/canvas/JS/CSS and no external assets or network access. No chart library is preloaded.

## Tests

Unit coverage pins extraction, sizing, title fallback, the sandbox document, the switch policy and the settings hook.

[[src/renderer/src/screens/Chat/visualizationPreview.test.ts]] covers last-fence selection, unterminated fences, size caps, non-HTML fences and both theme schemes. [[src/renderer/src/screens/Chat/ChatVisualizationPreview.test.tsx]] asserts the iframe sandbox, CSP, theme variable injection, switch and close. [[src/renderer/src/components/settings/inlineVisualizations.test.ts]] covers defaults, persistence and broadcast; the Appearance row is covered by its existing pane test.
