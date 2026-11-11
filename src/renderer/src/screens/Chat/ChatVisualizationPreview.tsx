import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  buildVisualizationDocument,
  type InlineVisualization,
} from "./visualizationPreview";

const THEME_VARIABLES = [
  "--bg-primary",
  "--bg-secondary",
  "--bg-tertiary",
  "--text-primary",
  "--text-secondary",
  "--border",
  "--accent",
  "--accent-text",
  "--success",
  "--warning",
  "--danger",
] as const;

function parseRgb(value: string): [number, number, number] | null {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((part) => part + part)
            .join("")
        : hex;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = value.trim().match(/^rgba?\(([^)]+)\)$/i)?.[1];
  if (!rgb) return null;
  const parts = rgb.split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return [parts[0], parts[1], parts[2]];
}

/** Theme id is not reliable (`data-theme` is absent on some custom themes). */
function isDarkColor(value: string): boolean | null {
  const rgb = parseRgb(value);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4;
}

function readThemeSnapshot(): {
  variables: Record<string, string>;
  dark: boolean;
} {
  const styles = getComputedStyle(document.documentElement);
  const variables: Record<string, string> = {};
  for (const name of THEME_VARIABLES) {
    const value = styles.getPropertyValue(name).trim();
    if (value) variables[name] = value;
  }
  const dark =
    isDarkColor(variables["--bg-primary"] ?? "") ??
    document.documentElement.dataset.theme !== "light";
  return { variables, dark };
}

/** Re-render the frame document when the app theme changes. */
function useThemeSnapshot(): {
  variables: Record<string, string>;
  dark: boolean;
} {
  const [snapshot, setSnapshot] = useState(readThemeSnapshot);
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setSnapshot(readThemeSnapshot()));
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });
    return () => observer.disconnect();
  }, []);
  return snapshot;
}

/**
 * Right-side sandbox for one agent-authored HTML visualization.
 *
 * The frame has an opaque origin (sandbox without allow-same-origin), so it
 * cannot reach the parent DOM, storage, or preload bridge. Its own CSP blocks
 * every network request, frame, form, and object.
 */
export function VisualizationPreview({
  visualization,
  onSwitchToFiles,
  onClose,
}: {
  visualization: InlineVisualization;
  onSwitchToFiles?: () => void;
  onClose?: () => void;
}): React.JSX.Element {
  const theme = useThemeSnapshot();
  const documentHtml = useMemo(
    () =>
      buildVisualizationDocument(
        visualization.html,
        theme.variables,
        theme.dark,
      ),
    [visualization.html, theme],
  );

  return (
    <aside
      className="tool-file-preview visualization-preview"
      aria-label="Visualization preview"
    >
      <div className="visualization-preview-header">
        <span className="visualization-preview-title" title={visualization.title}>
          {visualization.title}
        </span>
        {onSwitchToFiles ? (
          <button
            type="button"
            className="visualization-preview-switch"
            onClick={onSwitchToFiles}
          >
            Files
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            className="visualization-preview-close"
            aria-label="Close visualization preview"
            onClick={onClose}
          >
            <X size={14} aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="visualization-preview-body">
        <iframe
          className="visualization-preview-frame"
          title={visualization.title}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
          srcDoc={documentHtml}
        />
      </div>
    </aside>
  );
}
