import { app, type BrowserWindow, Menu } from "electron";
import { is } from "@electron-toolkit/utils";
import { zoomBy, zoomReset } from "../zoom";
import { bindingsFor, type ShortcutId } from "../../shared/keyboard-shortcuts";
import { getKeyboardShortcuts, shortcutRecording } from "../keyboard-shortcut-settings";

interface MenuDeps {
  getMainWindow: () => BrowserWindow | null;
  openExternalUrl: (rawUrl: unknown) => void;
}

export function buildMenu({ getMainWindow, openExternalUrl }: MenuDeps): void {
  const isMac = process.platform === "darwin";
  const overrides = getKeyboardShortcuts();
  const accelerator = (id: ShortcutId): string | undefined =>
    shortcutRecording ? undefined : bindingsFor(id, overrides, process.platform)[0]?.replace(/Mod/g, "CommandOrControl").replace(/Meta/g, "Command");
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Chat",
      submenu: [
        {
          label: "New Chat",
          accelerator: accelerator("newChat"),
          click: () => getMainWindow()?.webContents.send("menu-new-chat"),
        },
        { type: "separator" },
        {
          label: "Search Sessions",
          accelerator: accelerator("searchSessions"),
          click: () =>
            getMainWindow()?.webContents.send("menu-search-sessions"),
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const, accelerator: accelerator("undo") || "" },
        { role: "redo" as const, accelerator: accelerator("redo") || "" },
        { type: "separator" },
        { role: "cut" as const, accelerator: accelerator("cut") || "" },
        { role: "copy" as const, accelerator: accelerator("copy") || "" },
        { role: "paste" as const, accelerator: accelerator("paste") || "" },
        { role: "selectAll" as const, accelerator: accelerator("selectAll") || "" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Zoom In",
          accelerator: accelerator("zoomIn"),
          click: () => {
            const win = getMainWindow();
            if (win) zoomBy(win, 1);
          },
        },
        {
          label: "Zoom Out",
          accelerator: accelerator("zoomOut"),
          click: () => {
            const win = getMainWindow();
            if (win) zoomBy(win, -1);
          },
        },
        {
          label: "Actual Size",
          accelerator: accelerator("zoomReset"),
          click: () => {
            const win = getMainWindow();
            if (win) zoomReset(win);
          },
        },
        { type: "separator" },
        { role: "togglefullscreen" as const, accelerator: accelerator("fullscreen") || "" },
        ...(is.dev
          ? [
              { type: "separator" as const },
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
            ]
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
    {
      label: "Help",
      submenu: [
        ...(!is.dev
          ? [
              {
                label: "Toggle Developer Tools",
                accelerator: accelerator("devTools"),
                click: () => getMainWindow()?.webContents.toggleDevTools(),
              },
              { type: "separator" as const },
            ]
          : []),
        {
          label: "Hermes Agent on GitHub",
          click: () =>
            openExternalUrl("https://github.com/NousResearch/hermes-agent/"),
        },
        {
          label: "Report an Issue",
          click: () =>
            openExternalUrl(
              "https://github.com/riandikast/hermes-one-desktop/issues",
            ),
        },
      ],
    },
  ] as Electron.MenuItemConstructorOptions[];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
