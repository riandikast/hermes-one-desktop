// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeScreen } from "./KnowledgeScreen";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve("src/renderer/src/assets/main.css"), "utf8");

function setup(count = 1): void {
  window.hermesAPI = {
    listKnowledgeBundles: vi.fn().mockResolvedValue([
      {
        name: "guide",
        path: "/k/guide",
        files: Array.from({ length: count }, (_, i) => ({
          name: `note${i}.md`,
          path: `/k/guide/note${i}.md`,
          relativePath: `note${i}.md`,
          size: 100,
        })),
      },
    ]),
    readKnowledgeFile: vi.fn().mockResolvedValue("# Notes"),
    renameKnowledgeBundle: vi.fn().mockResolvedValue(true),
    renameKnowledgeFile: vi.fn().mockResolvedValue(true),
  } as unknown as typeof window.hermesAPI;
}

describe("Knowledge list rows", () => {
  it("shares flat full-width list styles instead of stretched tile styles", () => {
    expect(css.length).toBeGreaterThan(1000);
    const rows = css.slice(css.indexOf("/* Shared rows"), css.indexOf(".knowledge-add-file-bar {"));
    expect(rows).toContain(".knowledge-bundle-list,");
    expect(rows).toContain(".knowledge-file-list {");
    expect(rows).toContain(".knowledge-row-open,");
    expect(rows).toContain("var(--text-primary)");
    expect(rows).toContain("var(--text-secondary)");
    expect(rows).not.toMatch(/box-shadow|max-width: 900px|display: grid|card-pill/);
  });
  // @lat: [[knowledge-editor#List row controls]]
  it("uses semantic lists and separate native open and action buttons", async () => {
    setup();
    render(<KnowledgeScreen />);
    const bundle = await screen.findByRole("button", { name: "guide 1 file" });
    expect(
      screen.getByRole("list", { name: "Knowledge bundles" }).tagName,
    ).toBe("UL");
    const row = bundle.closest("li")!;
    expect(row.querySelectorAll("button")).toHaveLength(3);
    expect(
      row.querySelector("button button, button input, [role=button]"),
    ).toBeNull();
    expect(screen.queryByText("Open")).toBeNull();
    fireEvent.click(bundle);
    const file = screen.getByRole("button", { name: "note0.md 100 B" });
    expect(screen.getByRole("list", { name: "guide files" }).tagName).toBe(
      "UL",
    );
    expect(file.closest("li")!.querySelectorAll("button")).toHaveLength(4);
    expect(file.closest("li")!.draggable).toBe(true);
    fireEvent.click(file);
    await screen.findByRole("button", { name: "Back to file list" });
    expect(window.hermesAPI.readKnowledgeFile).toHaveBeenCalledWith(
      "guide",
      "note0.md",
    );
  });

  it.each([0, 1, 2])("shows real counts for %i files", async (count) => {
    setup(count);
    render(<KnowledgeScreen />);
    const summary = count
      ? `${count} file${count === 1 ? "" : "s"}`
      : "No files yet";
    expect(
      await screen.findByRole("button", { name: `guide ${summary}` }),
    ).toBeTruthy();
  });

  // @lat: [[knowledge-editor#Keyboard rename isolation]]
  it.each(["Bundle", "File"])(
    "submits and cancels %s rename without navigation",
    async (kind) => {
      setup();
      render(<KnowledgeScreen />);
      const bundle = await screen.findByRole("button", {
        name: "guide 1 file",
      });
      if (kind === "File") fireEvent.click(bundle);
      fireEvent.click(screen.getByTitle(`Rename ${kind}`));
      let input = screen.getByRole("textbox", { name: `${kind} name` });
      expect(document.activeElement).toBe(input);
      expect(input.closest("button, [role=button]")).toBeNull();
      fireEvent.change(input, { target: { value: "Team notes" } });
      fireEvent.keyDown(input, { key: " " });
      fireEvent.keyDown(input, { key: "Enter" });
      const api = window.hermesAPI;
      await waitFor(() =>
        expect(
          kind === "Bundle"
            ? api.renameKnowledgeBundle
            : api.renameKnowledgeFile,
        ).toHaveBeenCalledTimes(1),
      );
      if (kind === "Bundle")
        expect(api.renameKnowledgeBundle).toHaveBeenCalledWith(
          "guide",
          "Team notes",
        );
      else
        expect(api.renameKnowledgeFile).toHaveBeenCalledWith(
          "guide",
          "note0.md",
          "Team notes.md",
        );
      await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
      fireEvent.click(screen.getByTitle(`Rename ${kind}`));
      input = screen.getByRole("textbox", { name: `${kind} name` });
      fireEvent.change(input, { target: { value: "Cancelled" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(
        kind === "Bundle" ? api.renameKnowledgeBundle : api.renameKnowledgeFile,
      ).toHaveBeenCalledTimes(1);
      expect(api.readKnowledgeFile).not.toHaveBeenCalled();
      expect(
        screen.getByRole("list", {
          name: kind === "Bundle" ? "Knowledge bundles" : "guide files",
        }),
      ).toBeTruthy();
    },
  );

  it("offers Add File only at the top right of the bundle file list", async () => {
    setup();
    render(<KnowledgeScreen />);
    const bundle = await screen.findByRole("button", { name: "guide 1 file" });
    expect(screen.queryByRole("button", { name: "Add File" })).toBeNull();
    fireEvent.click(bundle);
    const add = screen.getByRole("button", { name: "Add File" });
    expect(add.closest(".knowledge-drill-head")).not.toBeNull();
    fireEvent.click(add);
    const input = screen.getByPlaceholderText("File name (e.g. style.md)...");
    expect(document.activeElement).toBe(input);
    expect(
      screen.getByRole("list", { name: "guide files" }),
    ).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
