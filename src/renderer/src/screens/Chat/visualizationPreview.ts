/**
 * Extracts one self-contained HTML visualization from an assistant reply.
 *
 * The agent emits a fenced ```html block (the PI-Desktop contract, adapted to
 * a chat message instead of a data-dir file). The right-side preview renders
 * that fragment inside an opaque-origin iframe; the transcript keeps the
 * original markdown.
 */

export const VISUALIZATION_MAX_BYTES = 2 * 1024 * 1024;

const HTML_LANGUAGES = new Set(["html", "htm", "xhtml"]);

export interface InlineVisualization {
  /** Fragment body without the fences. */
  html: string;
  /** `<title>`, first heading, or a generic label. */
  title: string;
  /** False while the closing fence has not streamed in yet. */
  complete: boolean;
}

const FENCE_RE = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+#.-]*)\s*$/;

function cleanTitle(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function visualizationTitle(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title && cleanTitle(title)) return cleanTitle(title);
  const heading = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i)?.[1];
  if (heading && cleanTitle(heading)) return cleanTitle(heading);
  return "Visualization";
}

/**
 * The last HTML fence wins: a reply may revise an earlier chart. An
 * unterminated fence is still returned with `complete: false` so the caller
 * can decide whether to wait for the turn to settle.
 */
export function extractInlineVisualization(
  content: string,
): InlineVisualization | null {
  if (!content) return null;
  const lines = content.split(/\r?\n/);
  let found: { start: number; end: number; complete: boolean } | null = null;

  for (let index = 0; index < lines.length; index++) {
    const opening = lines[index].match(FENCE_RE);
    if (!opening) continue;
    const marker = opening[1];
    const language = opening[2].toLowerCase();
    if (!HTML_LANGUAGES.has(language)) continue;

    let end = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const closing = lines[cursor].match(FENCE_RE);
      if (
        closing &&
        closing[1][0] === marker[0] &&
        closing[1].length >= marker.length
      ) {
        end = cursor;
        break;
      }
    }
    found = {
      start: index + 1,
      end: end === -1 ? lines.length : end,
      complete: end !== -1,
    };
    if (end === -1) break;
    index = end;
  }

  if (!found) return null;
  const html = lines.slice(found.start, found.end).join("\n").trim();
  if (!html) return null;
  if (new TextEncoder().encode(html).length > VISUALIZATION_MAX_BYTES) {
    return null;
  }
  return {
    html,
    title: visualizationTitle(html),
    complete: found.complete,
  };
}

export function chooseSidePreview(
  choice: "files" | "visualization" | null,
  filesAvailable: boolean,
  visualizationAvailable: boolean,
): "files" | "visualization" | null {
  // An explicit pick wins while its surface still exists.
  if (choice === "visualization" && visualizationAvailable) return "visualization";
  if (choice === "files" && filesAvailable) return "files";
  // Defaults: the live file animation while a turn runs, the finished
  // visualization afterwards.
  if (filesAvailable) return "files";
  if (visualizationAvailable) return "visualization";
  return null;
}

/**
 * A full document for the iframe. The frame is `sandbox="allow-scripts"` with
 * no `allow-same-origin`, so it has an opaque origin and cannot touch the
 * parent DOM, storage, or preload bridge. This CSP is the second lock: no
 * network, frames, forms, or objects; inline styles/scripts only.
 */
export function buildVisualizationDocument(
  html: string,
  variables: Record<string, string> = {},
  dark = true,
): string {
  const theme = Object.entries(variables)
    .filter(([name]) => /^--[a-z0-9-]+$/i.test(name))
    .map(([name, value]) => `${name}:${value};`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="${dark ? "dark" : "light"}"><style>:root{color-scheme:${dark ? "dark" : "light"};${theme}}html,body{margin:0;min-height:100%;background:var(--bg-primary,${dark ? "#181818" : "#f8fafc"});color:var(--text-primary,${dark ? "#ffffff" : "#182230"});font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}body{padding:16px;overflow:auto}*,*::before,*::after{box-sizing:border-box}img,svg,canvas{max-width:100%}</style></head><body>${html}</body></html>`;
}
