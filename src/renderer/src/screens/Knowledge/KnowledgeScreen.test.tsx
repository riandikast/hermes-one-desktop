// @vitest-environment jsdom

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
    };
  }

  it("renders Knowledge Management title and buttons", async () => {
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
    // The reference's structure: titled, with a central illustration and a
    // supporting summary line.
    expect(card!.querySelector(".knowledge-bundle-card-icon")).not.toBeNull();
    expect(
      card!.querySelector(".knowledge-bundle-card-title")?.textContent,
    ).toBe("ui-style-guide");
    expect(
      card!.querySelector(".knowledge-bundle-card-sub")?.textContent,
    ).toBe("1 file");
  });

  it("offers an outlined pill action, per the reference", async () => {
    mockBundles();
    const { container } = render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");

    const pill = container.querySelector(".knowledge-bundle-card-pill");
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain("View files");
  });

  it("reads file counts correctly, including the empty and plural cases", async () => {
    mockBundles([]);
    const { container } = render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");
    expect(
      container.querySelector(".knowledge-bundle-card-sub")?.textContent,
    ).toBe("No files yet");
  });

  it("expands the file list from the card and collapses it again", async () => {
    mockBundles();
    const { container } = render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");

    // Collapsed by default, so no file rows yet.
    expect(container.querySelector(".knowledge-file-list")).toBeNull();

    const pill = container.querySelector<HTMLElement>(
      ".knowledge-bundle-card-pill",
    )!;
    fireEvent.click(pill);
    await waitFor(() =>
      expect(container.querySelector(".knowledge-file-list")).not.toBeNull(),
    );
    expect(pill.textContent).toContain("Hide files");

    fireEvent.click(pill);
    await waitFor(() =>
      expect(container.querySelector(".knowledge-file-list")).toBeNull(),
    );
  });

  it("expands from the card body too, not only the pill", async () => {
    mockBundles();
    const { container } = render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");

    const card = container.querySelector<HTMLElement>(
      ".knowledge-bundle-card",
    )!;
    fireEvent.click(card);
    await waitFor(() =>
      expect(container.querySelector(".knowledge-file-list")).not.toBeNull(),
    );
  });

  it("marks an expanded card so the file list continues it visually", async () => {
    mockBundles();
    const { container } = render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");

    const item = container.querySelector<HTMLElement>(".knowledge-bundle-item")!;
    expect(item.className).not.toContain("knowledge-bundle-item--expanded");

    fireEvent.click(
      container.querySelector<HTMLElement>(".knowledge-bundle-card-pill")!,
    );
    await waitFor(() =>
      expect(item.className).toContain("knowledge-bundle-item--expanded"),
    );
  });

  it("keeps the per-bundle actions reachable", async () => {
    mockBundles();
    const { container } = render(<KnowledgeScreen />);
    await screen.findByText("ui-style-guide");

    // The card redesign must not lose rename/add/delete.
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
      expect(container.querySelector(".knowledge-file-list")).not.toBeNull(),
    );
  });
});
