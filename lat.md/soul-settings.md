# Soul settings

Settings includes a local-profile SOUL.md editor with explicit save, reload, draft protection, and failure reporting.

The page is [[src/renderer/src/components/settings/SoulPane.tsx#SoulPane]], mounted by [[src/renderer/src/components/settings/SettingsModal.tsx#SettingsModal]]. It reuses the existing Soul preload API; no arbitrary renderer file access is added.

Official personality and profile docs specify `$HERMES_HOME/SOUL.md`. Installed backend `agent/prompt_builder.py` resolves that home using `get_hermes_home()`. The editor uses the selected profile or resolves the active profile before reading.

Remote and SSH editing is deliberately disabled: existing remote IPC falls through to local files, while SSH helpers assume `~/.hermes`. Supporting them requires authoritative remote-home resolution and strict read failures first. The older profile Persona screen remains unchanged.

## Exact markdown and profile

Mocked renderer tests verify active-profile resolution, explicit save, whitespace and CRLF preservation, dirty state, and readback verification.

## Failures retain drafts

Save failures and disk conflicts keep unsaved edits. Reload requires confirmation, and Settings navigation or close confirms discarding dirty Soul edits.

## Remote isolation

Remote and SSH modes never invoke Soul file APIs. Save rechecks connection mode before writing so a loaded local draft cannot silently target a remote connection.

## Filesystem isolation

Temporary fixtures round-trip BOM, mixed line endings, Unicode, and trailing spaces through profile-specific Soul functions without touching user files. Read failures propagate rather than becoming an empty writable editor.
