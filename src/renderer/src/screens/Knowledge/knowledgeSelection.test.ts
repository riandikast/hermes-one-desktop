import { beforeEach, expect, it, vi } from "vitest";
import { KNOWLEDGE_RENAMED, renameKnowledgeSelections, renameSelectedKnowledge } from "./knowledgeSelection";
import { readDefaultKnowledge, writeDefaultKnowledge } from "../../components/settings/defaultKnowledge";

beforeEach(() => localStorage.clear());

it("migrates every saved session and defaults in order, notifying mounted chats", () => {
  localStorage.setItem("hermes.session.knowledge.one", JSON.stringify(["first", "old", "last"]));
  localStorage.setItem("hermes.session.knowledge.two", JSON.stringify(["old", "new"]));
  localStorage.setItem("hermes.session.knowledge.bad", "{bad");
  localStorage.setItem("unrelated", JSON.stringify(["old"]));
  writeDefaultKnowledge(["old", "other"]);
  const listener = vi.fn();
  window.addEventListener(KNOWLEDGE_RENAMED, listener);
  try {
    renameKnowledgeSelections("old", "new");
    expect(JSON.parse(localStorage.getItem("hermes.session.knowledge.one")!)).toEqual(["first", "new", "last"]);
    expect(JSON.parse(localStorage.getItem("hermes.session.knowledge.two")!)).toEqual(["new"]);
    expect(readDefaultKnowledge()).toEqual(["new", "other"]);
    expect(localStorage.getItem("hermes.session.knowledge.bad")).toBe("{bad");
    expect(localStorage.getItem("unrelated")).toBe('["old"]');
    expect(listener.mock.calls[0][0].detail).toEqual({ oldName: "old", newName: "new" });
    expect(renameSelectedKnowledge(["old", "other"], listener.mock.calls[0][0].detail)).toEqual(["new", "other"]);
  } finally { window.removeEventListener(KNOWLEDGE_RENAMED, listener); }
});
