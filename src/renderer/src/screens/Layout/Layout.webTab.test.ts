// The web preview attaches to the app tab bar like a session tab. Layout is
// provider-heavy, so these assert against source the same way chatPanels does.
import { describe, expect, it } from "vitest";
import layoutSource from "./Layout.tsx?raw";
import barSource from "./ActiveSessionsBar.tsx?raw";

describe("web preview tabs", () => {
  it("opens a web tab when the preview asks to attach", () => {
    expect(layoutSource).toContain(
      'window.addEventListener("hermes-open-web-preview"',
    );
    expect(layoutSource).toContain('targetView: "web"');
    expect(layoutSource).toContain("webUrl: clean");
  });

  it("reuses an existing web tab instead of stacking duplicates", () => {
    expect(layoutSource).toContain(
      'runs.find((run) => run.targetView === "web")',
    );
    expect(layoutSource).toContain("setActiveRunId(existing.runId)");
  });

  it("renders the browser pane for the active web tab", () => {
    expect(layoutSource).toContain('visitedViews.has("web")');
    expect(layoutSource).toContain("<WebPreviewPanel");
    expect(layoutSource).toContain(
      "onClose={() => handleCloseRun(run.runId)}",
    );
  });

  it("marks the tab with a globe like a file tab's code icon", () => {
    expect(barSource).toContain("run.webUrl ? (");
    expect(barSource).toContain("<Globe size={14} />");
  });
});
