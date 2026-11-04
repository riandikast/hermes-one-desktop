import { clipboard } from "electron";
import { fileURLToPath } from "url";

function unique(paths: string[]): string[] {
  return [...new Set(paths.filter((path) => path && path.length > 0))];
}

/**
 * Files copied in Windows Explorer (or Finder/Nautilus) live in a platform
 * clipboard format that Electron only exposes as a raw buffer. Read the known
 * ones and ignore anything malformed.
 */
export function readClipboardFilePaths(): string[] {
  if (process.platform === "win32") {
    try {
      const buffer = clipboard.readBuffer("FileNameW");
      if (buffer && buffer.length > 4) {
        const paths = unique(
          buffer
            .toString("utf16le")
            .split("\u0000")
            .map((path) => path.trim()),
        );
        if (paths.length > 0) return paths;
      }
    } catch {
      // Fall through to the URI list formats.
    }
  }
  for (const format of ["text/uri-list", "public.file-url"]) {
    try {
      const raw = clipboard.read(format);
      if (!raw) continue;
      const paths = unique(
        raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.startsWith("file://"))
          .map((line) => {
            try {
              return fileURLToPath(line);
            } catch {
              return "";
            }
          }),
      );
      if (paths.length > 0) return paths;
    } catch {
      // Format unsupported on this platform.
    }
  }
  return [];
}

/** Publish copied paths so the app (and later Ctrl+V in the explorer) can read them. */
export function writeClipboardFilePaths(paths: string[]): void {
  const list = unique(paths);
  if (list.length === 0) return;
  let wroteBuffer = false;
  try {
    clipboard.writeBuffer("FileNameW", Buffer.from(`${list.join("\u0000")}\u0000\u0000`, "utf16le"));
    wroteBuffer = true;
  } catch {
    // Buffer formats are unavailable on some Linux sessions.
  }
  if (!wroteBuffer) {
    try {
      clipboard.writeText(list.join("\n"));
    } catch {
      // Ignore clipboard write failures; the in-app clipboard still works.
    }
  }
}
