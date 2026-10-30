import { createContext, useContext, useState } from "react";
import type { ChatMessage } from "./types";

const ToolEntryContext = createContext<ReadonlySet<string> | null>(null);

/** Existing rows settle on tab entry; only subsequently arriving tools animate. */
export function ToolEntryProvider({ active, sessionKey, messages, children }: {
  active: boolean;
  sessionKey?: string | null;
  messages: ChatMessage[];
  children: React.ReactNode;
}): React.JSX.Element {
  const [entry, setEntry] = useState(() => ({ active, sessionKey, ids: new Set(messages.map((message) => message.id)) }));
  let current = entry;
  if (entry.active !== active || entry.sessionKey !== sessionKey || (!entry.ids.size && messages.length > 0)) {
    const refresh = entry.sessionKey !== sessionKey || active || !entry.ids.size;
    const unchanged = entry.ids.size === messages.length && messages.every((message) => entry.ids.has(message.id));
    current = { active, sessionKey, ids: refresh && !unchanged ? new Set(messages.map((message) => message.id)) : entry.ids };
    setEntry(current);
  }
  return <ToolEntryContext.Provider value={current.ids}>{children}</ToolEntryContext.Provider>;
}

export function useInstantToolEntry(id: string | undefined): [boolean, () => void] {
  const entry = useContext(ToolEntryContext);
  const [manualEntry, setManualEntry] = useState<ReadonlySet<string> | null>(null);
  return [!!id && !!entry?.has(id) && manualEntry !== entry, () => setManualEntry(entry)];
}
