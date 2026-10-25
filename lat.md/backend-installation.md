# Backend installation

The desktop detects the runtime belonging to its selected Hermes home. Reinstalling the backend must not strand an existing desktop on the setup screen.

## Managed runtime discovery

[[src/main/installer.ts#validateHermesHome]] uses the installation's `.hermes/bin/hermes` launcher with `--print-runtime-command`. Managed dependencies live outside the source checkout; neither `venv` nor `.venv` is required.

The published command supplies store Python and the isolated bootstrap arguments. Invalid discovery fails closed instead of borrowing another installation from PATH. Legacy `venv` and `.venv` remain supported when no managed launcher exists.

[[src/main/installer.ts#hermesCliArgs]] preserves the published bootstrap. [[src/main/installer.ts#hermesPythonArgs]] bootstraps direct Python snippets before importing backend packages. Profile arguments follow the complete bootstrap prefix, not a fixed offset.

Installer completion refreshes runtime paths and clears verification/version caches before status checks, allowing a new installation to be recognized without restarting. Failed CLI probes are not cached. Regression coverage lives in `tests/installer-runtime.test.ts` and `src/main/skills.test.ts`.

[[src/main/installer.ts#checkInstallStatus]] retries discovery when the selected interpreter or launcher is missing. Recheck can recover from a transient cold-launch failure without changing the selected home or borrowing PATH dependencies.

## Startup runtime diagnostics

Startup records selected-home provenance and runtime discovery results in the existing desktop diagnostic log, without subprocess output, bootstrap arguments or environment dumps.

`runtime-home` reports `environment`, `stored-override` or `default`, normalized home and cwd. `runtime-discovery` reports installation paths and fixed validation reasons. Records use `<userData>/logs/updater.log` through [[src/main/updater-log.ts#updaterLogger]]. Compare these events after a normal-terminal launch and an exported `-NoProfile` launch; successful isolated discovery probes do not prove the reported desktop failure is fixed.

Failure records include integer exit status/errno, allowlisted signals and stdout/stderr byte counts, never content. Boundary flags record Electron, `ELECTRON_RUN_AS_NODE=1`, npm/init-cwd and PowerShell environment presence plus `windowsHide`; no environment values are dumped.

`tests/installer-runtime.test.ts` verifies source reporting, typed failure metadata and exclusion of arbitrary exception codes, signals, messages and subprocess output. Existing exports are unchanged; no backend configuration is logged. Re-exporting scripts is unnecessary; new main-process diagnostics require a later rebuild/restart.

Node, Electron-as-Node and `-NoProfile` probes of the installed launcher succeeded with hidden/visible consoles and `ELECTRON_RUN_AS_NODE` toggled. These do not reproduce the GUI main-process failure. Chromium cache permission errors remain unlinked; no runtime behavior fix is claimed.

## Existing checkout selection

[[src/main/installer.ts#normalizeHermesHome]] accepts the Hermes data home or its `hermes-agent` checkout. A checkout must contain `hermes_cli/main.py`; selecting it never appends a second `hermes-agent` directory.

Environment roots, saved overrides and manual validation share this normalization. Saved selections persist the data home. Neither installed application resources nor portable extraction directories define the backend home.

`tests/installer-runtime.test.ts` covers shell-free Windows discovery, portable and installed layouts, explicit checkout roots and manual selection. Discovery and Python verification failures log paths and error codes, never arbitrary subprocess output; missing Python modules are identified separately.

## Fresh Windows bootstrap

[[src/main/installer.ts#runInstall]] treats official Windows installer exit zero as completion. Runtime validation is best effort; unresolved validation emits an honest warning and allows setup to continue.

After the installer process closes, desktop retries discovery and CLI `--version` at most three times, separated by 250 ms. Each attempt refreshes selected-home runtime paths and clears stale verification/version caches. Child PATH changes never require switching homes or borrowing system Python. Nonzero or signaled installer exits remain errors even when old binaries exist. An unresolved warning never marks the runtime verified or installed; normal status checks retain their actual result.

The official [installation guide](https://hermes-agent.nousresearch.com/docs/getting-started/installation) and [native Windows guide](https://hermes-agent.nousresearch.com/docs/user-guide/windows-native) define the bootstrap contract: Windows 10/11, PowerShell, internet access, no administrator rights required. Native installs default to `%LOCALAPPDATA%\hermes`; `HERMES_HOME`, `-HermesHome` and `-InstallDir` select explicit roots. User PATH changes require a new terminal.

The upstream PowerShell installer supplies pinned portable Git and uv when absent, downloads managed Python, installs the runtime and invokes PM for heavy tool dependencies. Desktop does not require preinstalled Git, uv, Python or Node. `-NonInteractive` suppresses interactive setup; `-SkipSetup` is a deprecated compatible alias. The copied Windows fallback command uses the official endpoint and upstream home selection, not a forced `~/.hermes` root.

`tests/installer-runtime.test.ts` uses temporary homes and mocked child processes: empty PATH, missing backend, bootstrap failure then retry, same-process cold discovery/import recovery, uncached failed probes, successful installer warnings and nonzero rejection with existing binaries. These isolated tests do not prove an actual clean Windows end-to-end installation; a disposable Windows VM still needs download, bootstrap, provider setup and first-chat verification.

## Context folder display names

[[src/renderer/src/screens/Chat/ContextFolderChip.tsx#ContextFolderChip]] subscribes to the shared sidebar alias store. Selected and recent labels update on rename; callbacks and tooltips retain actual paths. `ContextFolderChip.test.tsx` covers rename, removal, selection and basename fallback.
