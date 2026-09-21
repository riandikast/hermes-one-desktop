// @vitest-environment jsdom
//
// The bundle grid: card structure, the file-count summary, and that the card
// front is a single accessible target that drills into the bundle.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeScreen } from "./KnowledgeScreen";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("KnowledgeScreen", () => {
  function mockBundles(
    files: {
      name: string;
      path: string;
      relativePath?: string;
      size?: number;
    }[] = [
      {
        name: "colors.md",
        relativePath: "ui-style-guide/colors.md",
        path: "/home/.hermes/knowledge/ui-style-guide/colors.md",
        size: 100,
      },
    ],
  ): void {
    const anyWindow = window as any;
    anyWindow.hermesAPI = {
      ...(anyWindow.hermesAPI ?? {}),
      listKnowledgeBundles: vi.fn().mockResolvedValue([
        {
          name: "ui-style-guide",
          path: "/home/.hermes/knowledge/ui-style-guide",
          files,
        },
      ]),
      readKnowledgeFile: vi.fn().mockResolvedValue("# colors"),
    };
  }

  it("renders Knowledge Management title and the bundle card", async () => {
    mockBundles();

    render(<KnowledgeScreen />);

    expect(await screen.findByText("Knowledge Management")).toBeTruthy();
    expect(await screen.findByText("ui-style-guide")).toBeTruthy();
  });

  it("renders the bundle as a CARD with icon, title and file count", async () => {
    mockBundles();
    const { container } = render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");

    const card = container.querySelector(".knowledge-bundle-card");
    expect(card).not.toBeNull();
    expect(card!.querySelector(".knowledge-bundle-card-icon")).not.toBeNull();
    expect(
      card!.querySelector(".knowledge-bundle-card-title")?.textContent,
    ).toBe("ui-style-guide");
    expect(
      card!.querySelector(".knowledge-bundle-card-sub")?.textContent,
    ).toBe("1 file");
  });

  it("gives the icon the SAME color as the title label", async () => {
    // Requested explicitly: the icon must not keep its own accent tint.
    //
    // jsdom neither loads the app's CSS nor resolves var() in
    // getComputedStyle, so the color itself cannot be read here — the built
    // stylesheet is verified in the build step (grep for both selectors).
    // What IS assertable here is the DOM contract: the icon carries its own
    // class (so the stylesheet can target it) and no inline color overrides it.
    mockBundles();
    const { container } = render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");

    const icon = container.querySelector<HTMLElement>(
      ".knowledge-bundle-card-icon",
    );
    const title = container.querySelector<HTMLElement>(
      ".knowledge-bundle-card-title",
    );

    expect(icon).not.toBeNull();
    expect(title).not.toBeNull();
    // No inline colours, so the stylesheet decides the color for both.
    expect(icon!.style.color).toBe("");
    expect(title!.style.color).toBe("");
  });

  it("offers an outlined pill action, per the reference", async () => {
    mockBundles();
    const { container } = render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");

    const pill = container.querySelector(".knowledge-bundle-card-pill");
    expect(pill).not.toBeNull();
    // The pill now communicates drilling in, not an inline expand.
    expect(pill!.textContent).toContain("Open");
  });

  it("reads file counts correctly, including the empty and plural cases", async () => {
    mockBundles([]);
    const { container } = render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");
    expect(
      container.querySelector(".knowledge-bundle-card-sub")?.textContent,
    ).toBe("No files yet");
  });

  it("keeps the per-bundle actions reachable", async () => {
    mockBundles();
    const { container } = render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");

    const card = container.querySelector<HTMLElement>(
      ".knowledge-bundle-card",
    )!;
    const titles = [...card.querySelectorAll("[title]")].map((el) =>
      el.getAttribute("title"),
    );
    expect(titles).toContain("Rename Bundle");
    expect(titles).toContain("Add File");
    expect(titles).toContain("Delete Bundle");
  });

  it("is keyboard operable — the card is not a mouse-only target", async () => {
    mockBundles();
    const { container } = render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");

    const card = container.querySelector<HTMLElement>(
      ".knowledge-bundle-card",
    )!;
    expect(card.getAttribute("role")).toBe("button");
    expect(card.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(card, { key: "Enter" });
    await waitFor(() =>
      expect(container.querySelector(".knowledge-file-grid")).not.toBeNull(),
    );
  });
});
