// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualizationPreview } from "./ChatVisualizationPreview";

const visualization = {
  html: "<h1>Sales</h1><p>42</p>",
  title: "Sales",
  complete: true,
};

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("--bg-primary");
});

describe("VisualizationPreview", () => {
  it("renders an opaque-origin sandbox with a network-free document", () => {
    document.documentElement.style.setProperty("--bg-primary", "#123456");
    const { container } = render(
      <VisualizationPreview visualization={visualization} />,
    );
    const frame = container.querySelector("iframe") as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("srcdoc")).toContain("connect-src 'none'");
    expect(frame.getAttribute("srcdoc")).toContain("--bg-primary:#123456");
    expect(frame.getAttribute("srcdoc")).toContain("<h1>Sales</h1>");
  });

  it("derives the color scheme from the actual surface color", () => {
    document.documentElement.style.setProperty("--bg-primary", "#ffffff");
    const { container } = render(
      <VisualizationPreview visualization={visualization} />,
    );
    const srcdoc = (container.querySelector("iframe") as HTMLIFrameElement).getAttribute(
      "srcdoc",
    );
    expect(srcdoc).toContain('<meta name="color-scheme" content="light">');
    expect(srcdoc).toContain("color-scheme:light");
  });

  it("switches back to files and closes", () => {
    const onSwitchToFiles = vi.fn();
    const onClose = vi.fn();
    render(
      <VisualizationPreview
        visualization={visualization}
        onSwitchToFiles={onSwitchToFiles}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(onSwitchToFiles).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Close visualization preview" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not offer a switch when files are unavailable", () => {
    render(<VisualizationPreview visualization={visualization} />);
    expect(screen.queryByRole("button", { name: "Files" })).toBeNull();
  });
});
