# Theme persistence

Theme customizations are stored separately from bundled CSS so updates can refresh defaults without discarding user colors.

[[src/renderer/src/theme/themeEditor.ts#loadCustomThemes]] reads `hermes-custom-themes` from localStorage. [[src/renderer/src/components/ThemeProvider.tsx#ThemeProvider]] persists changes and injects theme-scoped overrides after the main stylesheet. No `main.css` mutation or storage migration is needed.

## Repeated built-in saves

Built-in saves compare the complete effective palette against pristine bundled defaults, never against the already-customized editor baseline.

[[src/renderer/src/components/settings/ThemeEditor.tsx]] saves sparse differences, retaining earlier overrides while leaving untouched defaults free to follow updates. Returning a value to its bundled default removes that override. The integration regression saves two colors, remounts, then restores defaults without affecting another theme.

## Custom palette saves

Custom themes have no bundled base, so saves retain their complete palette, including unchanged colors and copied source values.

Editing or renaming a copy must not replace its palette with only the latest changes. The integration regression edits and renames a copied palette, remounts the provider, and verifies persisted colors and injected CSS.

## Per-theme reset

Reset removes only the selected built-in theme's overrides and restores its bundled defaults; unrelated themes remain saved.

Custom themes expose the existing confirmed Delete action instead of Reset, because they have no original bundled palette. The integration regression verifies targeted storage removal and CSS refresh. Coverage lives in [[src/renderer/src/components/settings/ThemeEditor.integration.test.tsx]].
