import { execFileSync } from "child_process";
import { BrowserWindow } from "electron";

/**
 * Installed-font enumeration for the Settings appearance pane.
 *
 * Chromium exposes no font-list API in this Electron build (`queryLocalFonts`
 * is absent), so candidate family names are harvested from the OS font registry
 * and then VERIFIED by measurement in a hidden renderer: a family is only
 * reported if rendering a sample string with it actually produces different
 * metrics than the generic fallback. That keeps the settings list honest —
 * every entry offered can really be rendered, rather than being a name that
 * exists in a registry but resolves to nothing.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; fonts: string[] } | null = null;
let inFlight: Promise<string[]> | null = null;

/** Style words that trail a registry font description ("Arial Bold Italic"). */
const STYLE_SUFFIX =
  /\s+(Bold Italic|Bold Oblique|Italic|Oblique|Bold|Light|Semibold|SemiBold|Black|Thin|Medium|Regular|Condensed|Narrow Bold|Narrow|Extralight|ExtraLight|Heavy|Book|Roman)\b.*$/i;

function readRegistryFontDescriptions(): string[] {
  if (process.platform !== "win32") return [];
  const keys = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
    "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
  ];
  const names = new Set<string>();
  for (const key of keys) {
    let out = "";
    try {
      out = execFileSync("reg", ["query", key], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
    } catch {
      continue; // key missing (no per-user fonts) is normal
    }
    for (const line of out.split(/\r?\n/)) {
      const match = line.match(/^\s{2,}(.+?)\s{2,}REG_SZ\s/);
      if (!match) continue;
      let name = match[1]
        .trim()
        .replace(/\s*\((TrueType|OpenType|All res)\)\s*$/i, "")
        .replace(STYLE_SUFFIX, "")
        .trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

/**
 * Non-Windows fallback: `fc-list` (fontconfig) on Linux/macOS, or
 * `system_profiler` when fontconfig is absent. Kept best-effort — a platform
 * we cannot enumerate returns an empty list and the UI shows only the built-in
 * presets instead of inventing names.
 */
function readNativeFontDescriptions(): string[] {
  const names = new Set<string>();
  try {
    const out = execFileSync("fc-list", ["--format", "%{family}\n"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    for (const line of out.split("\n")) {
      // fc-list separates alternates with commas; the first is the primary.
      const primary = line.split(",")[0]?.trim();
      if (primary) names.add(primary);
    }
    if (names.size > 0) return [...names];
  } catch {
    /* fontconfig absent */
  }
  if (process.platform === "darwin") {
    try {
      const out = execFileSync(
        "system_profiler",
        ["-json", "SPFontsDataType"],
        { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
      );
      const parsed = JSON.parse(out) as {
        SPFontsDataType?: Array<{ typefaces?: Array<{ family?: string }> }>;
      };
      for (const font of parsed.SPFontsDataType ?? []) {
        for (const face of font.typefaces ?? []) {
          if (face.family) names.add(face.family);
        }
      }
    } catch {
      /* best effort */
    }
  }
  return [...names];
}

function candidateFamilyNames(): string[] {
  const names =
    process.platform === "win32"
      ? readRegistryFontDescriptions()
      : readNativeFontDescriptions();
  return names
    .map((n) => n.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * Keep only the candidates that actually resolve when rendered. Measurement is
 * done in a hidden BrowserWindow so it uses the same font stack as the app.
 */
async function verifyRenderableFamilies(
  candidates: string[],
): Promise<string[]> {
  if (candidates.length === 0) return [];
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  try {
    await win.loadURL("data:text/html,<html><body></body></html>");
    const resolved = (await win.webContents.executeJavaScript(
      `(() => {
        const candidates = ${JSON.stringify(candidates)};
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return [];
        const SAMPLE = "mmmmmmmmmmlliWM@#123";
        const FALLBACKS = ["monospace", "sans-serif", "serif"];
        const base = FALLBACKS.map((fb) => {
          ctx.font = "72px " + fb;
          return ctx.measureText(SAMPLE).width;
        });
        const out = [];
        for (const name of candidates) {
          const quoted = '"' + name.replace(/"/g, '\\\\"') + '"';
          for (let i = 0; i < FALLBACKS.length; i++) {
            ctx.font = "72px " + quoted + ", " + FALLBACKS[i];
            const w = ctx.measureText(SAMPLE).width;
            // Any metric change vs the pure fallback == the family resolved.
            if (Math.abs(w - base[i]) > 0.01) {
              out.push(name);
              break;
            }
          }
        }
        return out;
      })()`,
    )) as string[];
    return Array.isArray(resolved) ? resolved : [];
  } catch {
    return [];
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/**
 * List installed, renderable font families. Cached briefly and de-duplicated
 * across concurrent callers (the settings pane can remount while the first
 * query is still running).
 */
export async function listInstalledFonts(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.fonts;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const fonts = await verifyRenderableFamilies(candidateFamilyNames());
      cache = { at: Date.now(), fonts };
      return fonts;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Test seam: clear the memoised result. */
export function resetInstalledFontCache(): void {
  cache = null;
}
