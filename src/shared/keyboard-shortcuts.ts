/** Shared by Electron accelerators and renderer key handlers. */
export const SHORTCUTS = [
  { id: "newChat", owner: "main", bindings: ["Mod+N"] },
  { id: "searchSessions", owner: "main", bindings: ["Mod+K"] },
  { id: "zoomIn", owner: "main", bindings: ["Mod+Plus", "Mod+="] },
  { id: "zoomOut", owner: "main", bindings: ["Mod+-"] },
  { id: "zoomReset", owner: "main", bindings: ["Mod+0"] },
  { id: "fullscreen", owner: "main", bindings: ["F11"], macBindings: ["Ctrl+Meta+F"] },
  { id: "minimize", owner: "main", bindings: [], macBindings: ["Meta+M"] },
  { id: "closeWindow", owner: "main", bindings: ["Alt+F4"], macBindings: ["Meta+Shift+W"] },
  { id: "reload", owner: "main", bindings: ["Mod+R"] },
  { id: "devTools", owner: "main", bindings: ["F12", "Ctrl+Shift+I"], macBindings: ["Alt+Meta+I"] },
  { id: "undo", owner: "main", bindings: ["Mod+Z"] },
  { id: "redo", owner: "main", bindings: ["Mod+Shift+Z", "Ctrl+Y"] },
  { id: "cut", owner: "main", bindings: ["Mod+X"] },
  { id: "copy", owner: "main", bindings: ["Mod+C"] },
  { id: "paste", owner: "main", bindings: ["Mod+V"] },
  { id: "selectAll", owner: "main", bindings: ["Mod+A"] },
  { id: "settings", owner: "renderer", bindings: ["Mod+,"] },
  { id: "searchFiles", owner: "renderer", bindings: ["Mod+F"] },
  { id: "searchContents", owner: "renderer", bindings: ["Mod+Shift+F"] },
  { id: "switchProfile", owner: "renderer", bindings: ["Mod+P"] },
  { id: "toggleTerminal", owner: "renderer", bindings: ["Mod+T"] },
  { id: "sendMessage", owner: "renderer", bindings: ["Enter"] },
  { id: "clarifySubmit", owner: "renderer", bindings: ["Mod+Enter"] },
  { id: "gitCommit", owner: "renderer", bindings: ["Mod+Enter"] },
  { id: "closeTab", owner: "renderer", bindings: ["Mod+W"] },
  { id: "nextTab", owner: "renderer", bindings: ["Ctrl+Tab", "Mod+Shift+]", "Mod+Alt+ArrowRight", "Mod+Shift+ArrowRight"] },
  { id: "previousTab", owner: "renderer", bindings: ["Ctrl+Shift+Tab", "Mod+Shift+[", "Mod+Alt+ArrowLeft", "Mod+Shift+ArrowLeft"] },
  { id: "tab1", owner: "renderer", bindings: ["Mod+1"] },
  { id: "tab2", owner: "renderer", bindings: ["Mod+2"] },
  { id: "tab3", owner: "renderer", bindings: ["Mod+3"] },
  { id: "tab4", owner: "renderer", bindings: ["Mod+4"] },
  { id: "tab5", owner: "renderer", bindings: ["Mod+5"] },
  { id: "tab6", owner: "renderer", bindings: ["Mod+6"] },
  { id: "tab7", owner: "renderer", bindings: ["Mod+7"] },
  { id: "tab8", owner: "renderer", bindings: ["Mod+8"] },
  { id: "tab9", owner: "renderer", bindings: ["Mod+9"] },
] as const;

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];
export type ShortcutOverrides = Partial<Record<ShortcutId, string[]>>;
interface KeyInput {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}
const modifiers = new Set(["Mod", "Ctrl", "Meta", "Shift", "Alt"]);
const validKey = /^(?:[a-z0-9,./;='[\]\\`-]|Plus|Enter|Tab|Escape|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|F(?:[1-9]|1[0-9]|2[0-4]))$/i;
function parse(binding: string): string[] | null {
  const parts = binding.split("+");
  const key = parts.at(-1) ?? "";
  const mods = parts.slice(0, -1);
  return validKey.test(key) && mods.every((mod) => modifiers.has(mod)) && new Set(mods).size === mods.length
    ? parts : null;
}

export function bindingsFor(id: ShortcutId, overrides: ShortcutOverrides, platform = "win32"): readonly string[] {
  if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id] ?? [];
  const shortcut = SHORTCUTS.find((item) => item.id === id);
  if (!shortcut) return [];
  return platform === "darwin" && "macBindings" in shortcut ? shortcut.macBindings : shortcut.bindings;
}

/** An error string means invalid; undefined means a valid partial override map. */
export function validateShortcutOverrides(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Keyboard shortcuts must be an object.";
  for (const [id, bindings] of Object.entries(value)) {
    if (!SHORTCUTS.some((item) => item.id === id)) return `Unknown shortcut: ${id}`;
    if (!Array.isArray(bindings) || bindings.length > 8 || bindings.some((binding) => typeof binding !== "string" || binding.length > 80 || !parse(binding))) return `Invalid bindings for ${id}`;
  }
  return undefined;
}

export function matchesBinding(event: KeyInput, binding: string, platform = "win32"): boolean {
  if (event.isComposing || event.keyCode === 229) return false;
  const parts = parse(binding);
  if (!parts) return false;
  const key = parts.at(-1)!;
  const mods = new Set(parts.slice(0, -1));
  const ctrl = mods.has("Ctrl") || (mods.has("Mod") && platform !== "darwin");
  const meta = mods.has("Meta") || (mods.has("Mod") && platform === "darwin");
  if (!!event.ctrlKey !== ctrl || !!event.metaKey !== meta || !!event.altKey !== mods.has("Alt")) return false;
  // Plus is produced with Shift on the main keyboard, without it on the numpad.
  const plus = key === "Plus" && (event.key === "+" || event.code === "NumpadAdd");
  if (!plus && !!event.shiftKey !== mods.has("Shift")) return false;
  if (plus) return true;
  const actual = key === "Space" ? " " : key;
  return event.key.toLowerCase() === actual.toLowerCase() ||
    (/^[1-9]$/.test(key) && event.code === `Numpad${key}`);
}
