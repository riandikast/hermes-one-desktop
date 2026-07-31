# Search, Terminal, Project Alias Design

## Scope

Fix file search quality in the sidebar and `@`/`@/` picker, fix terminal launch for nested folders, and add frontend-only project-name aliases.

## Search

Create one shared search pipeline for both search UIs. Index each selected context folder recursively once, retaining `{ name, path, isDirectory }` entries.

Exclude generated/vendor directories during indexing: `.git`, `.hg`, `.svn`, `.gradle`, `.idea`, `node_modules`, `build`, `out`, `dist`, `target`, `generated`, `coverage`, `.next`, caches, and virtual environments.

Rank matches in this order:

1. Exact basename, case-insensitive, including extension.
2. Exact normalized relative path.
3. Basename token/prefix matches.
4. Basename substring matches.
5. Path-segment fuzzy matches.

Use separator/camelCase tokenization. Penalize deeper paths and generated-like names. Preserve deterministic path ordering for ties. Exact filename remains first even when many generated files contain similar text.

The sidebar and mention picker consume the same ranked result function and exclusion rules. Folder mode filters directories; file mode filters files.

## Terminal

Keep terminal selection/probing. Replace the Windows `cmd.exe /c start /D ...` launch wrapper with direct process spawning:

- Windows Terminal: executable with `-d <directory>`.
- PowerShell 7/System PowerShell: executable with `-NoExit -NoLogo`, using `cwd: <directory>`.

Validate the target directory before launch. Preserve existing boolean success/failure IPC behavior.

## Project Aliases

Add right-click handling to each sidebar project header. Selecting `Rename` changes only the displayed label. Store aliases in `localStorage`, keyed by normalized folder path. Empty names restore the folder basename. Never rename folders, sessions, or persisted session records.

Alias lookup applies wherever the sidebar groups sessions by project path. Existing sessions and newly loaded sessions use the alias immediately.

## Error Handling

- Search failures return no results without breaking the picker.
- Terminal invalid paths return `false`.
- Storage failures fall back to folder basenames.
- Rename input trims whitespace and rejects empty values as a reset.

## Tests

- Search: exact filename/extension, case-insensitivity, generated-directory exclusion, nested path ranking, deterministic ties, file/folder filtering.
- Terminal: nested directories, spaces, drive roots, invalid directories, direct command arguments.
- Project aliases: set, read, reset, malformed storage, normalized keys.

## Deliberate Simplifications

- No persistent backend schema for aliases.
- No file-content search.
- No fuzzy-index dependency; use the existing TypeScript/runtime primitives.
- No separate search implementations for sidebar and mentions.
