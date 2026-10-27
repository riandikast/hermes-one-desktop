// @vitest-environment node
import { expect, it } from "vitest";
import { reconcileAfterDbRefresh } from "./sessionHistory";
import type { ChatMessage } from "./types";

// @lat: [[chat-commands#Slash command execution#Completion text reconciliation]]
it.each(["assistant", undefined, "absent"] as const)(
  "reconciles %s completion bubbles with canonical history once",
  (kind) => {
    const current: ChatMessage[] = [
      { id: "u1", role: "user", content: "question" },
      {
        id: "live",
        role: "agent",
        ...(kind === "absent" ? {} : { kind }),
        content: "The answer is 42.",
        pending: false,
      },
    ];
    const db: ChatMessage[] = [
      { id: "db-1", role: "user", content: "question" },
      { id: "db-2", role: "agent", content: "The answer is 42." },
    ];
    const next = reconcileAfterDbRefresh(current, db);
    expect(next.filter((row) => row.role === "agent")).toHaveLength(1);
    expect(next.find((row) => row.id === "live")).toBeDefined();
  },
);

it("retains identical canonical answers in separate turns", () => {
  const db: ChatMessage[] = [
    { id: "db-1", kind: "user", role: "user", content: "first" },
    { id: "db-2", kind: "assistant", role: "agent", content: "Yes." },
    { id: "db-3", kind: "user", role: "user", content: "second" },
    { id: "db-4", kind: "assistant", role: "agent", content: "Yes." },
  ];
  expect(
    reconcileAfterDbRefresh(db, db).filter((row) => row.role === "agent"),
  ).toHaveLength(2);
});
