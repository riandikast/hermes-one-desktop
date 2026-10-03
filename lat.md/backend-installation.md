# Backend installation

The desktop detects the runtime belonging to its selected Hermes home. Reinstalling the backend must not strand an existing desktop on the setup screen.

## Managed runtime discovery

[[src/main/installer.ts#validateHermesHome]] uses the installation's `.hermes/bin/hermes` launcher with `--print-runtime-command`. Managed dependencies live outside the source checkout; neither `venv` nor `.venv` is required.

The published command supplies store Python and the isolated bootstrap arguments. Invalid discovery fails closed instead of borrowing another installation from PATH. Legacy `venv` and `.venv` remain supported when no managed launcher exists.

[[src/main/installer.ts#hermesCliArgs]] preserves the published bootstrap. [[src/main/installer.ts#hermesPythonArgs]] bootstraps direct Python snippets before importing backend packages. Profile arguments follow the complete bootstrap prefix, not a fixed offset.

Installer completion refreshes runtime paths before status checks, allowing an installation created during the current app session to be recognized. Regression coverage lives in `tests/installer-runtime.test.ts` and `src/main/skills.test.ts`.
