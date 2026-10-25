export const TERMINAL_INPUT_PREFIX = "terminal-input:v1:";

export const TERMINAL_KEYS = {
  "Ctrl+C": "\x03",
  "Ctrl+Y": "\x19",
  r: "r",
  Enter: "\r",
  "r + Enter": "r\r",
} as const;

export interface OnFinishTerminalInput {
  terminalId: string;
  title: string;
  key: keyof typeof TERMINAL_KEYS;
}

/** Store inputs in the existing ordered queue so scope migration and handoff work unchanged. */
export function encodeTerminalInput(input: OnFinishTerminalInput): string {
  return TERMINAL_INPUT_PREFIX + encodeURIComponent(JSON.stringify(input));
}

export function decodeTerminalInput(id: string): OnFinishTerminalInput | null {
  if (!id.startsWith(TERMINAL_INPUT_PREFIX) || id.length > 4096) return null;
  try {
    const value = JSON.parse(decodeURIComponent(id.slice(TERMINAL_INPUT_PREFIX.length)));
    if (!value || typeof value.terminalId !== "string" || !value.terminalId ||
        value.terminalId.length > 256 || typeof value.title !== "string" ||
        value.title.length > 256 || !Object.hasOwn(TERMINAL_KEYS, value.key)) return null;
    return { terminalId: value.terminalId, title: value.title, key: value.key };
  } catch {
    return null;
  }
}
