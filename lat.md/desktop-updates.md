# Desktop Updates

Desktop updates use GitHub releases and expose both a startup upgrade action and a Settings auto-upgrade preference.

The Electron main process configures `electron-updater` against the repository publisher metadata from `electron-builder.yml`, which points at the Rian Fork — `riandikast/hermes-one-desktop` (the fork's `publish` block and `package.json` homepage; upstream is `fathah/hermes-desktop`). This deliberately prevents the fork build from auto-updating to upstream releases. The About pane's desktop version row carries a "Rian Fork" badge so it is obvious which channel a build tracks. [[src/main/app/updater.ts#setupUpdater]] registers update IPC handlers, persists the auto-upgrade preference under Electron `userData`, and applies that preference to `autoUpdater.autoDownload`.

When GitHub reports a newer release, [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] shows an upgrade button in the sidebar footer as soon as the app reaches the main layout. The button downloads the update when needed, shows download progress, and changes into a restart action after the update is ready.

[[src/renderer/src/components/settings/AboutPane.tsx#AboutPane]] (the About & Updates pane of the settings modal) presents the desktop app as its own card, separate from the Hermes Agent engine card — the two update on independent channels. The card shows the app version, the auto-upgrade toggle, and an explicit update action: [[src/renderer/src/components/settings/useSettingsData.ts#useSettingsData]] subscribes to the same `onUpdateAvailable`/`onUpdateDownloadProgress`/`onUpdateDownloaded`/`onUpdateError` events as the footer button and adds a manual `checkDesktopUpdate` (via `checkForUpdates`) plus a `handleDesktopUpdate` that downloads, then restarts via `installUpdate`. When auto-upgrade is enabled the startup release check downloads automatically; when disabled, downloading waits for the user's click (footer button or this card's action).

## Stable and beta release channels

Two GitHub Actions workflows publish builds; only the stable channel reaches end users' auto-update, so a beta can be tested without risking their devices.

`release.yml` (stable) runs on a push to the `release` branch: it tags `v<version>` from `package.json`, builds all platforms, and publishes a normal GitHub Release carrying the `latest*.yml` update feed. `beta-release.yml` runs on a push to `beta` (or manual dispatch): it stamps a prerelease version `v<version>-beta.<run>` via `scripts/set-version.mjs`, builds the same signed/notarized artifacts, and publishes a **GitHub prerelease** carrying a `beta*.yml` feed.

The isolation is structural: the updater ([[src/main/app/updater.ts#setupUpdater]]) leaves `allowPrerelease` off, so electron-updater's GitHub provider only ever resolves the latest **non-prerelease** release's `latest.yml`. A beta prerelease is therefore invisible to stable clients — testers download the beta installer manually from the prerelease. The beta workflow skips winget + the landing-page rebuild and uses a separate `beta-release` concurrency group so it never cancels a stable release. Cutting a beta for the _next_ version requires bumping `package.json` first (a beta of an already-released version sorts lower than its stable tag).

## Custom-fork builds from the `custom` branch

Pushing `custom` builds a Windows installer and portable exe and publishes them as a GitHub Release on this fork, which the About pane names as the update source.

`.github/workflows/custom-release.yml` runs on every push to `custom` (or manual dispatch). It computes the next version as **`max(package.json patch, highest published `custom-v*` tag patch) + 1`** — a strict single increment that can never reuse a published tag, and cannot be dragged backwards by a stale `package.json`. It then runs `electron-vite build` (not `npm run build`, whose web typecheck currently has unrelated failures), packages `nsis` + `portable` for x64 unsigned, and publishes tag `custom-v<version>` as a normal (non-prerelease) release marked latest, with `latest.yml` attached.

**The released version is written back to `package.json`.** A final `stamp_version` job runs only after a successful publish, calls `scripts/set-version.mjs`, and pushes `chore(release): <version> [skip ci]` to `custom`. Settings → About & Updates reads `app.getVersion()`, which comes from `package.json` at package time, so before this write-back the pane could show `0.7.4` while releases were already at `0.7.13`. Two guards keep the bump from looping: the `[skip ci]` marker, and the fact that a `GITHUB_TOKEN` push does not retrigger workflows. Regressions: [[tests/scripts/custom-release-version.test.ts]] pins the bump arithmetic (stale package.json, tag-ahead, no-tag, other-major tags, no tag reuse) and that `set-version.mjs` writes the exact version and rejects malformed input.

The client side needs no branch awareness: `electron-builder.yml` already declares `publish.owner: riandikast` / `repo: hermes-one-desktop`, which becomes `app-update.yml` at package time, and [[src/main/app/updater.ts#setupUpdater]] reads the latest non-prerelease feed with `allowPrerelease` off. [[src/renderer/src/components/settings/AboutPane.tsx#AboutPane]] shows the update source next to the version so a build can be traced to the fork rather than upstream.

Portable builds cannot self-update: `setupUpdater` returns early when `PORTABLE_EXECUTABLE_DIR` is set, so the update action is inert there and the portable exe must be replaced manually. Auto-update applies to the NSIS-installed build only.


## Manual release selection

Settings About offers exact fork versions for Windows x64 setup installations, with explicit download and restart actions and separate downgrade consent.

[[src/main/app/desktop-releases.ts#setupDesktopReleases]] paginates the public fork releases API without credentials. Only stable `custom-vX.Y.Z` releases with exact fork-origin setup assets and matching SHA-512 metadata are offered. Metadata is revalidated before download. Portable, development, and non-x64 Windows builds report unavailability.

A separate `NsisUpdater` uses the selected tag's generic feed, `allowDowngrade=true`, `autoDownload=false`, `autoInstallOnAppQuit=false`, and full installer download. It cannot fall back to latest. Normal checks/download/install are blocked while a selection is active; an existing normal download/ready update blocks selection. Discard, failure, and explicit installation clear selection. Download cancellation is deliberately unavailable in flight; discard is available once ready. No backend or data rollback is promised.

[[src/renderer/src/components/settings/DesktopReleasePicker.tsx#DesktopReleasePicker]] shows installed/latest, paginated choices, error feedback, downgrade consent, and separate download, restart, and discard buttons. Tests mock IPC, network, and installer lifecycle; no real installer is executed. The Providers Active model heading no longer duplicates Browse models; its Change selector and the library's own controls remain.
