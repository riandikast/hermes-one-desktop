import { readDefaultKnowledge, writeDefaultKnowledge } from "../../components/settings/defaultKnowledge";

export const KNOWLEDGE_RENAMED = "hermes-knowledge-renamed";
export interface KnowledgeRename { oldName: string; newName: string }

export function renameSelectedKnowledge(names: string[], { oldName, newName }: KnowledgeRename): string[] {
  return [...new Set(names.map((name) => name === oldName ? newName : name))];
}

/** Migrate unopened sessions too; open chats receive the same identity change. */
export function renameKnowledgeSelections(oldName: string, newName: string): void {
  const change = { oldName, newName };
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith("hermes.session.knowledge.")) continue;
    try {
      const names: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      if (Array.isArray(names) && names.every((name) => typeof name === "string") && names.includes(oldName)) {
        localStorage.setItem(key, JSON.stringify(renameSelectedKnowledge(names, change)));
      }
    } catch { /* Leave malformed or unwritable entries untouched. */ }
  }
  const defaults = readDefaultKnowledge();
  if (defaults.includes(oldName)) writeDefaultKnowledge(renameSelectedKnowledge(defaults, change));
  window.dispatchEvent(new CustomEvent<KnowledgeRename>(KNOWLEDGE_RENAMED, { detail: change }));
}
