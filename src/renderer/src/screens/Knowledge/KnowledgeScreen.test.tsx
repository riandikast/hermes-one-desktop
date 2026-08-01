// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeScreen } from "./KnowledgeScreen";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("KnowledgeScreen", () => {
  it("renders Knowledge Management title and buttons", async () => {
    (window as any).hermesAPI = {
      listKnowledgeBundles: vi.fn().mockResolvedValue([
        {
          name: "ui-style-guide",
          path: "/home/.hermes/knowledge/ui-style-guide",
          files: [
            {
              name: "colors.md",
              relativePath: "ui-style-guide/colors.md",
              path: "/home/.hermes/knowledge/ui-style-guide/colors.md",
              size: 100,
            },
          ],
        },
      ]),
    };

    render(<KnowledgeScreen />);

    expect(await screen.findByText("Knowledge Management")).toBeTruthy();
    expect(await screen.findByText("ui-style-guide")).toBeTruthy();
  });
});
