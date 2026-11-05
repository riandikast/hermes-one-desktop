import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { officialProvider } from "../shared/official-providers";

/** Source-only capability check: never imports the backend or reads profile state. */
export function providerSetupError(repo: string, provider: string, oauth = false): string | null {
  const p = officialProvider(provider);
  if (!p) {
    return oauth ? `The installed Hermes backend cannot verify OAuth support for ${provider}. Use hermes auth on the backend host.` : null;
  } // Preserve user-defined and legacy configurations.
  try {
    const source = readFileSync(join(repo, "hermes_cli", "auth.py"), "utf8");
    const registry = source.split("_REGISTRY_ROWS")[1]?.split("from hermes_cli.auth_plugin_providers")[0] ?? source.split("PROVIDER_REGISTRY")[1] ?? "";
    const pluginFile = join(repo, "plugins", "model-providers", p.plugin, "__init__.py");
    const pluginSource = existsSync(pluginFile) ? readFileSync(pluginFile, "utf8") : "";
    const registered = [registry, pluginSource].some(text => text.includes(`"${p.id}"`) || text.includes(`'${p.id}'`));
    if (!registered) return `The installed Hermes backend does not support ${p.name}. Update the backend before connecting.`;
    if (oauth) {
      const commands = readFileSync(join(repo, "hermes_cli", "auth_commands.py"), "utf8");
      const builtins = commands.match(/_OAUTH_CAPABLE_PROVIDERS\s*=\s*\{([^}]+)\}/)?.[1] ?? "";
      if (!builtins.includes(`"${p.id}"`) && !builtins.includes(`'${p.id}'`)) {
        return `The installed Hermes backend does not support OAuth for ${p.name}. Update the backend or use an API key.`;
      }
    }
    return null;
  } catch {
    return "Cannot verify the installed Hermes backend's provider support. Install or update Hermes before connecting.";
  }
}
