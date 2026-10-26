# Portable knowledge packages

Knowledge exports and imports a ZIP directly, preserving registered references and source checkbox settings. External file contents are never bundled; device-specific roots are mapped during import or later.

## Package format and safety

Version 1 ZIPs contain `manifest.json` and regular files under `files/<bundle>/<file>`. The manifest names bundles, source IDs, relative targets, registered text spans and source settings, not executable actions.

[[src/main/knowledge-package.ts#exportKnowledgePackage]] exports all bundles. [[src/main/knowledge-package.ts#previewKnowledgePackage]] validates before issuing an in-memory import ticket. [[src/main/knowledge-package.ts#importKnowledgePackage]] stages validated files, refuses existing destination names, rolls back newly created bundles on failure and commits local metadata. Limits are 32 MB and 1000 files; traversal, unsafe names, duplicate paths and linked source files are rejected. Flat bundles only: nested folders require flattening before export. `fflate` supplies ZIP encoding/decoding rather than a custom archive parser.

## Relocation and unresolved sources

Only explicitly registered references are relocated. Existing prose and code containing identical path strings remain unchanged. Bundled targets use bundle-relative paths; external targets use a named source plus relative path.

[[src/main/knowledge-package.ts#saveKnowledgeDocument]] stores registered spans in local `.portable.json`. Autocomplete selection registers a reference; editing maps its span and drops it when its text changes. A pasted legacy path is registered only after selecting it and confirming **Register selected path**. Imported internal targets become local absolute paths. Missing external roots become visible `knowledge-source:` references until [[src/main/knowledge-package.ts#locateKnowledgeSource]] updates the registered spans. Local mappings stay off the portable manifest. Source checkbox settings survive unresolved import and are restored after mapping.

[[src/main/knowledge-package.test.ts]] covers a real ZIP round trip between isolated homes, exact-span-only replacement, bundled relocation through bundle/file rename and move, deferred mapping, checkbox restoration, conflict preservation and unsafe archive rejection. Knowledge mutations share one per-home operation queue; internal metadata helpers bypass only that already-held queue, preventing self-deadlock.

## Import preview controls

Knowledge keeps its compact existing list layout. Import Package opens a preview of bundles, conflicts and external folder mappings; unresolved sources are allowed and no existing bundle is silently overwritten.

[[src/renderer/src/screens/Knowledge/KnowledgePackages.tsx#KnowledgePackages]] uses the shared Radix-backed AppModal for focus, Escape, chrome-clearing layering and bounded scrolling. Import requires confirmation; Export saves the open document first. Portable Sources offers Locate folder later. Native folder dialogs do not discard unsaved editor text. [[src/renderer/src/screens/Knowledge/KnowledgePackages.test.tsx]] checks preview, mapping, confirmation, cancellation, export ordering and failure display.

[[src/main/ipc/knowledge-packages.ts#registerKnowledgePackageHandlers]] owns native open/save dialogs and file I/O; preload declarations and implementation expose the same methods. Existing Knowledge storage scope is retained. Design direction: existing theme tokens and compact rows, ENERGY 1 / RHYTHM 1 / MOTION 1. No decorative assets or new navigation.
