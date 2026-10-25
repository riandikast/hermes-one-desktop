export const TERMINAL_INPUT_PREFIX = "terminal-input:v1:";
export const MAX_TERMINAL_TEXT = 256;

export const TERMINAL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(Array.from({ length: 26 }, (_, i) => [
    `Ctrl+${String.fromCharCode(65 + i)}`, String.fromCharCode(i + 1),
  ])),
  Enter: "\r", Tab: "\t", Escape: "\x1b", Backspace: "\x7f",
  // Persisted v1 shortcuts remain valid; new literal input uses text instead.
  r: "r", "r + Enter": "r\r",
});

export type OnFinishTerminalInput = {
  terminalId: string;
  title: string;
  enter?: boolean;
} & ({ key: string; text?: never } | { text: string; key?: never });

/** Store inputs in the existing ordered queue so scope migration and handoff work unchanged. */
export function encodeTerminalInput(input: OnFinishTerminalInput): string {
  const id = TERMINAL_INPUT_PREFIX + encodeURIComponent(JSON.stringify(input));
  if (!decodeTerminalInput(id)) throw new Error("Invalid terminal input action");
  return id;
}

export function decodeTerminalInput(id: string): OnFinishTerminalInput | null {
  if (!id.startsWith(TERMINAL_INPUT_PREFIX) || id.length > 16384) return null;
  try {
    const value = JSON.parse(decodeURIComponent(id.slice(TERMINAL_INPUT_PREFIX.length)));
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).some((key) => !["terminalId", "title", "key", "text", "enter"].includes(key)) ||
        typeof value.terminalId !== "string" || !value.terminalId.trim() ||
        value.terminalId.length > 256 || typeof value.title !== "string" ||
        value.title.length > 256 ||
        (Object.hasOwn(value, "enter") && typeof value.enter !== "boolean")) return null;
    if (Object.hasOwn(value, "key")) {
      if (Object.hasOwn(value, "text") || typeof value.key !== "string" || !Object.hasOwn(TERMINAL_KEYS, value.key)) return null;
    } else if (typeof value.text !== "string" || !value.text.length ||
               value.text.length > MAX_TERMINAL_TEXT || /[\x00-\x1f\x7f-\x9f]/.test(value.text)) return null;
    return value as OnFinishTerminalInput;
  } catch {
    return null;
  }
}

export function terminalInputBytes(input: OnFinishTerminalInput): string {
  return (input.key !== undefined ? TERMINAL_KEYS[input.key] : input.text) + (input.enter ? "\r" : "");
}
