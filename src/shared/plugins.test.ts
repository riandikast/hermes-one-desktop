import { describe, expect, it } from "vitest";
import {
  canRemovePlugin,
  isPluginEnabled,
  parseDashboardPlugins,
  parsePluginManageResult,
  pluginUpdateLabel,
} from "./plugins";

describe("plugin rows", () => {
  it("maps the gateway row and derives counts when they are absent", () => {
    const list = parseDashboardPlugins({
      plugins: [
        {
          name: "acme",
          key: "acme",
          version: "1.0.0",
          description: "Tools",
          source: "git",
          status: "enabled",
          portable: true,
          install_dir: "/p/acme",
          has_desktop_half: true,
          servers: [{ name: "srv", state: "connected", sentence: "Connected" }],
          update_available: true,
          update_target: "0".repeat(40),
          tools: ["acme_search"],
        },
        { name: "core", version: "2.0.0", source: "bundled", status: "not enabled" },
      ],
    });

    expect(list.userCount).toBe(1);
    expect(list.bundledCount).toBe(1);
    expect(list.plugins[0]).toMatchObject({
      key: "acme",
      installDir: "/p/acme",
      hasDesktopHalf: true,
      updateAvailable: true,
      tools: ["acme_search"],
    });
    expect(list.plugins[0].servers[0].state).toBe("connected");
    // A row without a key falls back to its name, and missing arrays stay empty.
    expect(list.plugins[1]).toMatchObject({ key: "core", servers: [], tools: [], portable: false });
  });

  it("treats only the enabled status as on", () => {
    const list = parseDashboardPlugins({
      plugins: [
        { name: "a", status: "enabled" },
        { name: "b", status: "not enabled" },
        { name: "c", status: "disabled" },
      ],
    });
    expect(list.plugins.map(isPluginEnabled)).toEqual([true, false, false]);
  });

  it("separates removable user installs from bundled plugins", () => {
    const list = parseDashboardPlugins({
      plugins: [{ name: "a", source: "git" }, { name: "b", source: "bundled" }],
    });
    expect(list.plugins.map(canRemovePlugin)).toEqual([true, false]);
  });

  it("labels the update target, shortening a full commit", () => {
    const [row] = parseDashboardPlugins({
      plugins: [{ name: "a", update_available: true, update_target: "0123456789abcdef0123456789abcdef01234567" }],
    }).plugins;
    expect(pluginUpdateLabel(row)).toBe("01234567");
    const [feed] = parseDashboardPlugins({
      plugins: [{ name: "b", update_available: true, update_target: "1.4.0" }],
    }).plugins;
    expect(pluginUpdateLabel(feed)).toBe("1.4.0");
  });

  it("keeps a write answer's flags but omits rows when the gateway sends none", () => {
    expect(parsePluginManageResult({ ok: true, restart_required: true, name: "acme" })).toMatchObject({
      ok: true,
      restartRequired: true,
      name: "acme",
      plugins: undefined,
    });
    const withRows = parsePluginManageResult({ plugins: [{ name: "acme" }], user_count: 1, bundled_count: 0 });
    expect(withRows.plugins).toHaveLength(1);
    expect(withRows.userCount).toBe(1);
  });

  it("tolerates junk payloads instead of throwing", () => {
    expect(parseDashboardPlugins(null).plugins).toEqual([]);
    expect(parseDashboardPlugins({ plugins: [null, 3, "x"] }).plugins).toHaveLength(3);
  });
});
